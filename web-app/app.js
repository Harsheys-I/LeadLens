import {APP_VERSION,DEFAULT_SETTINGS,DEFAULT_OUTPUT_FIELDS,SETTINGS_SEED,MAX_BATCH_SIZE,MAX_CONCURRENCY,normalizeSettings,normalizeInputFields,slugFieldId,parseWorkbook,auditBatch,downloadWorkbook,downloadReviewPack,splitLeadsByTelecaller,splitResultsByTelecaller,requestTelecallerReview,estimateRunSeconds,estimateReviewRunSeconds,estimateReviewPassSeconds,estimatePooledSeconds,estimateCombinedReviewSessionSeconds,validateApiKey} from "./audit.js?v=3.2.3";
import {putJob,getJob,getJobs,deleteJob,clearJobs,loadSettings,saveSettings,getApiKey,apiKeyIsRemembered,saveApiKey,forgetApiKey} from "./db.js?v=3.2.3";

const $=id=>document.getElementById(id);
const ids=["file-input","drop-zone","file-list","validation","start-audit","page-title","key-state","run-name","pause-run","download-result","progress-label","progress-percent","progress-bar","metric-leads","metric-excel-rows","metric-calls","metric-batch","metric-completed","metric-status","metric-input-tokens","metric-cached-tokens","metric-output-tokens","metric-duration","metric-eta","metric-cost","live-log","clear-console","history-list","clear-history","api-key","remember-key","toggle-key","save-key","forget-key","key-message","batch-size","concurrency","model","review-model","input-field-config","add-input-field","ai-field-config","rule-config","add-rule","output-field-config","yes-values","no-values","additional-instructions","input-price","cached-price","output-price","review-input-price","review-cached-price","review-output-price","save-settings","reset-settings","settings-message","toast","mobile-menu","active-job-switch","sort-field","sort-direction","app-version","export-settings","import-settings","import-settings-file","update-banner","update-banner-text","reload-app","key-modal","onboard-key","onboard-toggle","onboard-remember","onboard-message","onboard-save","onboard-skip","sidebar-version","sidebar-notes","review-drop-zone","review-file-input","review-drop-hint","review-file-list","review-validation","start-review","review-run-panel","review-aggregate","review-cards","review-download-panel","download-review-pdf","download-review-excel","review-open-console"];
const els=Object.fromEntries(ids.map(id=>[id,$(id)]));
const titles={new:"New audit",review:"TelleCaller Review",console:"Run console",history:"History",settings:"Settings"};
const ENGINE_VERSION="latest-day-v7";
const ACTIVE_JOB_KEY="leadlens.activeJobId";
const REVIEW_SESSION_KEY="leadlens.reviewSessionIds";
/** Max TeleCaller review jobs running at once (outer pool). Inner batch pool stays settings.concurrency per job. */
const REVIEW_JOB_CONCURRENCY=10;

let parsedFiles=[],currentJob=null,displayLogs=true;
let reviewFormat="combined";
let reviewParsedFiles=[];
let reviewSessionIds=[];
let reviewQueue=[];
let reviewQueueRunning=false;
let reviewActiveCount=0;
/** In-memory job objects for live Review UI (IndexedDB lags behind pendingBatches / clocks). */
const liveJobs=new Map();
const controllers=new Map();
const saveChains=new Map();
const loadedSettings=loadSettings(DEFAULT_SETTINGS);
const previousSettingsSeed=Number(loadedSettings.settingsSeed)||0;
let settings=normalizeSettings(loadedSettings);
if(previousSettingsSeed<SETTINGS_SEED)saveSettings(settings);

const deepCopy=value=>JSON.parse(JSON.stringify(value));
const number=value=>Number.isFinite(Number(value))?Number(value):0;
const timestamp=()=>new Date().toISOString();
const setActiveJobId=id=>{if(id)sessionStorage.setItem(ACTIVE_JOB_KEY,id);else sessionStorage.removeItem(ACTIVE_JOB_KEY);};
const getActiveJobId=()=>sessionStorage.getItem(ACTIVE_JOB_KEY)||"";
const saveReviewSessionIds=()=>sessionStorage.setItem(REVIEW_SESSION_KEY,JSON.stringify(reviewSessionIds));
const loadReviewSessionIds=()=>{
  try{const parsed=JSON.parse(sessionStorage.getItem(REVIEW_SESSION_KEY)||"[]");reviewSessionIds=Array.isArray(parsed)?parsed.filter(Boolean):[];}
  catch{reviewSessionIds=[];}
};

function showView(name){
  document.querySelectorAll(".view").forEach(view=>view.classList.toggle("active",view.id===`view-${name}`));
  document.querySelectorAll(".nav-item").forEach(button=>button.classList.toggle("active",button.dataset.view===name));
  els["page-title"].textContent=titles[name];
  document.querySelector(".shell").classList.remove("menu-open");
  if(name==="history")renderHistory();
  if(name==="settings")renderSettings();
  if(name==="console")refreshJobSwitcher();
  if(name==="review")renderReviewProgress();
}
function toast(message){els.toast.textContent=message;els.toast.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>els.toast.classList.remove("show"),3200);}
function updateKeyState(){const ready=Boolean(getApiKey());els["key-state"].textContent=ready?"API key ready":"API key not set";els["key-state"].classList.toggle("ready",ready);}
// Only hard-block a save for these; soft failures (network/quota/other) still save with a caution.
const BLOCK_KEY_REASONS=new Set(["empty","format","unauthorized","forbidden"]);
async function validateAndSaveKey(key,remember,messageEl,buttonEl){
  const trimmed=(key||"").trim();
  if(!trimmed){if(messageEl)messageEl.textContent="Enter a key.";return false;}
  if(buttonEl)buttonEl.disabled=true;
  if(messageEl)messageEl.textContent="Checking key with OpenAI (no tokens used)…";
  const result=await validateApiKey(trimmed);
  if(buttonEl)buttonEl.disabled=false;
  if(!result.ok&&BLOCK_KEY_REASONS.has(result.reason)){
    if(messageEl)messageEl.textContent=result.message;
    return false;
  }
  saveApiKey(trimmed,Boolean(remember));
  updateKeyState();
  if(messageEl){
    const where=remember?"Saved on this device.":"Saved for this session.";
    messageEl.textContent=result.ok?`${result.message} ${where}`:`${result.message} Saved anyway — ${where}`;
  }
  return true;
}
function openKeyModal(){
  if(!els["key-modal"])return;
  els["onboard-key"].value="";
  els["onboard-remember"].checked=false;
  els["onboard-message"].textContent="";
  els["onboard-key"].type="password";
  if(els["onboard-toggle"])els["onboard-toggle"].textContent="Show";
  els["key-modal"].classList.remove("hidden");
  setTimeout(()=>els["onboard-key"]?.focus(),60);
}
function closeKeyModal(){els["key-modal"]?.classList.add("hidden");}
function maybePromptForApiKey(){if(!getApiKey())openKeyModal();}
function timeText(iso){return new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(new Date(iso));}
function addLog(job,message,level="info"){
  job.logs=job.logs||[];
  job.logs.push({at:timestamp(),level,message});
  if(job.logs.length>1200)job.logs=job.logs.slice(-1200);
  if(currentJob?.id===job.id)renderLogs(job);
}
function renderLogs(job){
  if(!displayLogs){els["live-log"].innerHTML='<div class="empty-state">Log view cleared. New events will reappear.</div>';return;}
  const logs=job?.logs||[];
  els["live-log"].replaceChildren();
  if(!logs.length){els["live-log"].innerHTML='<div class="empty-state">Run activity will appear here.</div>';return;}
  for(const item of logs){
    const row=document.createElement("div"),time=document.createElement("span"),level=document.createElement("span"),message=document.createElement("span");
    row.className=`log-entry ${item.level}`;
    time.className="time";
    time.textContent=new Date(item.at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    level.className="level";
    level.textContent=item.level.toUpperCase();
    message.textContent=item.message;
    row.append(time,level,message);
    els["live-log"].append(row);
  }
  els["live-log"].scrollTop=els["live-log"].scrollHeight;
}
function elapsed(job){
  const live=(job.status==="running"||job.status==="reviewing")&&job.runStartedAt
    ?Date.now()-new Date(job.runStartedAt).valueOf()
    :0;
  return (job.elapsedMs||0)+live;
}
function durationText(ms){const seconds=Math.max(0,Math.floor(ms/1000)),minutes=Math.floor(seconds/60);return minutes?`${minutes}m ${seconds%60}s`:`${seconds}s`;}
function estimatedCost(job){
  const reviewUsage=job.reviewTokenUsage||{input:0,cached:0,output:0};
  const total=job.tokenUsage||{input:0,cached:0,output:0};
  // Review tokens are folded into tokenUsage after the second pass — split for dual rates.
  const auditUsage={
    input:Math.max(0,number(total.input)-number(reviewUsage.input)),
    cached:Math.max(0,number(total.cached)-number(reviewUsage.cached)),
    output:Math.max(0,number(total.output)-number(reviewUsage.output))
  };
  const auditRates=job.pricing||settings.pricing||{};
  const reviewRates=job.reviewPricing||settings.reviewPricing||auditRates;
  const cost=(usage,rates)=>Math.max(0,(number(usage.input)-number(usage.cached))*number(rates.input)/1e6+number(usage.cached)*number(rates.cached)/1e6+number(usage.output)*number(rates.output)/1e6);
  return cost(auditUsage,auditRates)+cost(reviewUsage,reviewRates);
}
function stopClock(job){
  if(job.runStartedAt){
    job.elapsedMs=(job.elapsedMs||0)+Date.now()-new Date(job.runStartedAt).valueOf();
    job.runStartedAt="";
  }
  if(!job.finishedAt)job.finishedAt=timestamp();
}

function uniqueLeadCount(job){
  if(Number.isFinite(Number(job.leadCount))&&Number(job.leadCount)>0)return Number(job.leadCount);
  const keys=new Set();
  for(const lead of job.leads||[]){
    if(lead.groupId)keys.add(lead.groupId);
    else keys.add(`${lead.staticValues?.project||""} | ${lead.staticValues?.mobile||""}`);
  }
  if(keys.size)return keys.size;
  for(const row of job.results||[])keys.add(`${row.project||""} | ${row.mobile||""}`);
  return keys.size||job.totalLeads||0;
}
/** Group call-rows by project+mobile so batch size means N leads (not N calls). */
function groupCallRowsByLead(callRows){
  const map=new Map();
  for(const row of callRows||[]){
    const key=row.groupId||`${row.staticValues?.project||""} | ${row.staticValues?.mobile||""}`||row.leadId;
    if(!map.has(key))map.set(key,[]);
    map.get(key).push(row);
  }
  return[...map.values()];
}
function leadBatchCount(job){
  const leadCount=uniqueLeadCount(job);
  const batchSize=Math.max(1,Number(job.settings?.batchSize)||1);
  return Math.ceil(leadCount/batchSize)||0;
}
/** Include out-of-order finished batches so the bar moves as soon as any API responds. */
function pendingResultCount(job){
  return Object.values(job.pendingBatches||{}).reduce((n,rows)=>n+(Array.isArray(rows)?rows.length:0),0);
}
function auditedDoneCount(job){
  return (job.results?.length||0)+pendingResultCount(job);
}
function jobEstimateSeconds(job){
  const s=job.settings||settings;
  if(job.mode==="telecaller-review-parent"){
    const audit=estimateRunSeconds(s,uniqueLeadCount(job),job.totalLeads);
    const n=Math.max(1,Number(job.expectedTelecallerCount)||job.childReviewIds?.length||1);
    const per=estimateReviewPassSeconds(Math.ceil((job.totalLeads||0)/n));
    return audit+estimatePooledSeconds(Array(n).fill(per),REVIEW_JOB_CONCURRENCY);
  }
  if(job.reviewOnly)return estimateReviewPassSeconds(job.totalLeads||job.results?.length||0);
  if(job.mode==="telecaller-review")return estimateReviewRunSeconds(s,uniqueLeadCount(job),job.totalLeads);
  return estimateRunSeconds(s,uniqueLeadCount(job),job.totalLeads);
}
function jobRemainingSeconds(job){
  if(["completed","failed"].includes(job.status))return 0;
  const s=job.settings||settings;
  const target=job.totalLeads||0;
  const done=auditedDoneCount(job);
  const totalEst=Math.max(1,jobEstimateSeconds(job));
  if(job.reviewOnly){
    const est=estimateReviewPassSeconds(target||job.results?.length||0);
    if(job.status==="queued"||job.status==="paused")return est;
    // Do not let ETA climb as wall clock grows — subtract elapsed, floor at 1s.
    return Math.max(1,Math.round(est-elapsed(job)/1000));
  }
  const reviewEst=job.mode==="telecaller-review"?estimateReviewPassSeconds(target):0;
  if(job.status==="reviewing"){
    return Math.max(1,Math.round(reviewEst-elapsed(job)/1000));
  }
  const auditEst=estimateRunSeconds(s,uniqueLeadCount(job),target);
  const frac=target?Math.min(1,Math.max(0,done/target)):0;
  // Progress-based remaining (stable). Avoid elapsed/done rate — early done=1 makes ETA explode and rise.
  let auditRem=auditEst*(1-frac);
  if(target&&done>=Math.max(3,Math.ceil(target*0.2))&&elapsed(job)>2500){
    const rateRem=((elapsed(job)/1000)/done)*Math.max(0,target-done);
    // Prefer the lower of static progress vs observed rate; never above static remaining.
    auditRem=Math.min(auditRem,rateRem);
  }
  let rem=auditRem+(job.mode==="telecaller-review"?reviewEst:0);
  if(job.mode==="telecaller-review-parent"){
    const n=Math.max(1,Number(job.expectedTelecallerCount)||job.childReviewIds?.length||1);
    const per=estimateReviewPassSeconds(Math.ceil((target||0)/n));
    rem=auditRem+estimatePooledSeconds(Array(n).fill(per),REVIEW_JOB_CONCURRENCY);
  }
  // Cap so a bad extrapolation cannot exceed the original session estimate.
  return Math.max(1,Math.round(Math.min(rem,totalEst*(1-frac*0.95))));
}
function sessionWallMs(jobs){
  let start=Infinity,end=0,anyLive=false;
  for(const job of jobs||[]){
    const startIso=job.startedAt||job.runStartedAt||job.createdAt;
    if(startIso)start=Math.min(start,new Date(startIso).valueOf());
    if(job.status==="running"||job.status==="reviewing"||job.status==="queued"){
      anyLive=true;
      end=Math.max(end,Date.now());
    }else{
      const finishIso=job.finishedAt||job.updatedAt;
      if(finishIso)end=Math.max(end,new Date(finishIso).valueOf());
    }
  }
  if(anyLive)end=Math.max(end,Date.now());
  if(!Number.isFinite(start)||end<=start)return 0;
  return end-start;
}
function estimateSessionRemainingSeconds(parentJobs,reviewJobs,allJobs){
  if(parentJobs.length&&!reviewJobs.length){
    return jobRemainingSeconds(parentJobs[0]);
  }
  if(parentJobs.length&&reviewJobs.length){
    const incomplete=reviewJobs.filter(job=>!(job.status==="completed"&&job.reviewText));
    if(!incomplete.length)return 0;
    return estimatePooledSeconds(incomplete.map(jobRemainingSeconds),REVIEW_JOB_CONCURRENCY);
  }
  const incomplete=(allJobs||[]).filter(job=>!["completed","failed"].includes(job.status));
  if(!incomplete.length)return 0;
  return estimatePooledSeconds(incomplete.map(jobRemainingSeconds),REVIEW_JOB_CONCURRENCY);
}
function renderProgress(job){
  if(!job)return;
  currentJob=job;
  setActiveJobId(job.id);
  const totalAudited=job.totalLeads||0,done=auditedDoneCount(job),pct=totalAudited?Math.round(Math.min(done,totalAudited)/totalAudited*100):0;
  const batches=leadBatchCount(job),usage=job.tokenUsage||{};
  const concurrency=job.settings?.concurrency||1;
  const billable=Math.max(0,number(usage.input)-number(usage.cached));
  const pendingLeft=Object.keys(job.pendingBatches||{}).length;
  els["run-name"].textContent=job.fileName||"No active audit";
  els["progress-label"].textContent=job.status==="completed"
    ?(job.mode==="telecaller-review"?"Review complete":job.mode==="telecaller-review-parent"?"Combined audit complete — reviews queued":"Audit complete")
    :job.status==="reviewing"
    ?`Writing TeleCaller review with ${job.settings?.reviewModel||settings.reviewModel||"gpt-5-nano"}…`
    :job.status==="running"
    ?(job.reviewOnly
      ?`Preparing TeleCaller review…`
      :`Keeping ${concurrency} batch request${concurrency>1?"s":""} in flight${pendingLeft?` · ${pendingLeft} batch(es) waiting to checkpoint`:""}…`)
    :job.status==="paused"?"Audit paused — ready to resume":job.status==="failed"?"Audit stopped — saved work is safe":"Waiting for a file";
  els["progress-percent"].textContent=`${pct}%`;
  els["progress-bar"].style.width=`${pct}%`;
  els["metric-leads"].textContent=uniqueLeadCount(job)||"—";
  if(els["metric-excel-rows"])els["metric-excel-rows"].textContent=job.rowCount?Number(job.rowCount).toLocaleString():"—";
  if(els["metric-calls"])els["metric-calls"].textContent=job.callCount!=null?Number(job.callCount).toLocaleString():(job.rowCount?Number(job.rowCount).toLocaleString():"—");
  els["metric-batch"].textContent=batches?`${Math.min((job.nextBatch||0)+1,batches)} / ${batches}`:"—";
  els["metric-completed"].textContent=totalAudited?`${done} / ${totalAudited}`:"—";
  els["metric-status"].textContent=job.status?job.status[0].toUpperCase()+job.status.slice(1):"Idle";
  els["metric-input-tokens"].textContent=`${number(usage.input).toLocaleString()} (${billable.toLocaleString()} billable)`;
  els["metric-cached-tokens"].textContent=number(usage.cached).toLocaleString();
  els["metric-output-tokens"].textContent=number(usage.output).toLocaleString();
  els["metric-duration"].textContent=durationText(elapsed(job));
  if(els["metric-eta"]){
    const rem=jobRemainingSeconds(job);
    const est=jobEstimateSeconds(job);
    els["metric-eta"].textContent=rem?`~${durationText(rem*1000)} left`:(est?`~${durationText(est*1000)}`:"—");
  }
  els["metric-cost"].textContent=estimatedCost(job).toFixed(4);
  els["pause-run"].disabled=!(["running","reviewing","paused","failed"].includes(job.status));
  els["pause-run"].textContent=job.status==="running"||job.status==="reviewing"?"Pause":"Resume";
  els["download-result"].disabled=job.status!=="completed";
  renderLogs(job);
  refreshJobSwitcher();
  if(job.mode==="telecaller-review"||job.mode==="telecaller-review-parent")scheduleReviewProgress();
}

async function refreshJobSwitcher(){
  const switcher=els["active-job-switch"];
  if(!switcher)return;
  const jobs=await getJobs();
  const ranked=jobs
    .filter(job=>["running","reviewing","paused","failed","queued","completed"].includes(job.status)&&job.engineVersion===ENGINE_VERSION)
    .sort((a,b)=>{
      const rank=job=>({failed:0,running:1,reviewing:1,paused:2,queued:3,completed:4}[job.status]??5);
      const d=rank(a)-rank(b);
      if(d)return d;
      return String(b.updatedAt||"").localeCompare(String(a.updatedAt||""));
    })
    .slice(0,40);
  switcher.replaceChildren();
  if(ranked.length<=1){switcher.classList.add("hidden");return;}
  switcher.classList.remove("hidden");
  const label=document.createElement("span");
  label.textContent="Active run";
  const select=document.createElement("select");
  select.setAttribute("aria-label","Switch active audit");
  for(const job of ranked){
    const option=document.createElement("option");
    option.value=job.id;
    const who=job.telecallerName||job.fileName||"run";
    const kind=job.mode==="telecaller-review-parent"?"Combined audit":job.mode==="telecaller-review"?(job.reviewOnly?"Review":"Review"):"Audit";
    option.textContent=`${kind} · ${who} (${job.status}${job.status==="failed"&&job.error?`: ${String(job.error).slice(0,48)}`:""})`;
    option.selected=job.id===(currentJob?.id||getActiveJobId());
    select.append(option);
  }
  select.onchange=async()=>{const job=await getJob(select.value);if(job){displayLogs=true;renderProgress(job);}};
  switcher.append(label,select);
}

function withJobSave(jobId,action){
  const previous=saveChains.get(jobId)||Promise.resolve();
  const next=previous.catch(()=>{}).then(action);
  saveChains.set(jobId,next);
  return next.finally(()=>{if(saveChains.get(jobId)===next)saveChains.delete(jobId);});
}

const pendingPersistTimers=new Map();
function schedulePendingPersist(job){
  const prior=pendingPersistTimers.get(job.id);
  if(prior)clearTimeout(prior);
  pendingPersistTimers.set(job.id,setTimeout(()=>{
    pendingPersistTimers.delete(job.id);
    withJobSave(job.id,async()=>{
      job.updatedAt=timestamp();
      await putJob(job);
    }).catch(error=>{
      addLog(job,`Could not save pending checkpoint: ${error.message}`,"error");
      toast("Checkpoint save failed — free disk space or resume after reload.");
      if(currentJob?.id===job.id)renderProgress(job);
    });
  },1500));
}
function clearPendingPersist(jobId){
  const prior=pendingPersistTimers.get(jobId);
  if(prior)clearTimeout(prior);
  pendingPersistTimers.delete(jobId);
}

function throttleProgress(job){
  if(job?.mode==="telecaller-review"||job?.mode==="telecaller-review-parent")scheduleReviewProgress();
  if(currentJob?.id!==job.id)return;
  if(throttleProgress._timer)return;
  throttleProgress._timer=setTimeout(()=>{
    throttleProgress._timer=null;
    if(currentJob?.id===job.id)renderProgress(currentJob);
  },200);
}

/**
 * Record a finished batch. Checkpoints only advance in order (1,2,3…).
 * Out-of-order API finishes stay in memory — we do NOT IndexedDB-write on every
 * out-of-order completion (that was blocking the contiguous flush behind ~20 heavy saves).
 */
async function commitBatch(job,index,rows){
  // Park API results immediately so the progress bar moves even when this batch
  // is ahead of nextBatch and waiting for in-order checkpoint flush.
  job.pendingBatches=job.pendingBatches||{};
  if(rows&&job.pendingBatches[String(index)]===undefined){
    job.pendingBatches[String(index)]=rows;
    throttleProgress(job);
  }
  await withJobSave(job.id,async()=>{
    job.pendingBatches=job.pendingBatches||{};
    if(rows)job.pendingBatches[String(index)]=rows;
    let merged=0;
    const from=job.nextBatch;
    while(job.pendingBatches[String(job.nextBatch)]){
      job.results.push(...job.pendingBatches[String(job.nextBatch)]);
      delete job.pendingBatches[String(job.nextBatch)];
      job.nextBatch+=1;
      merged++;
    }
    if(merged){
      clearPendingPersist(job.id);
      job.updatedAt=timestamp();
      await putJob(job);
      const pendingLeft=Object.keys(job.pendingBatches).length;
      addLog(job,merged===1
        ?`Checkpoint batch ${from+1}. ${auditedDoneCount(job)}/${job.totalLeads} audited (${job.results.length} saved)${pendingLeft?` · ${pendingLeft} finished API batch(es) waiting for order`:""}.`
        :`Checkpoint batches ${from+1}–${job.nextBatch}. ${auditedDoneCount(job)}/${job.totalLeads} audited (${job.results.length} saved)${pendingLeft?` · ${pendingLeft} finished API batch(es) waiting for order`:""}.`);
      throttleProgress(job);
    }else{
      const waitingFor=(job.nextBatch||0)+1;
      addLog(job,`Batch ${index+1} API done (${rows?.length||0} audited) — progress updated; checkpoint waits for batch ${waitingFor}.`);
      schedulePendingPersist(job);
      throttleProgress(job);
    }
  });
}

async function flushPendingBatches(job){
  clearPendingPersist(job.id);
  await withJobSave(job.id,async()=>{
    job.pendingBatches=job.pendingBatches||{};
    let merged=0;
    const from=job.nextBatch;
    while(job.pendingBatches[String(job.nextBatch)]){
      job.results.push(...job.pendingBatches[String(job.nextBatch)]);
      delete job.pendingBatches[String(job.nextBatch)];
      job.nextBatch+=1;
      merged++;
    }
    job.updatedAt=timestamp();
    await putJob(job);
    if(merged)addLog(job,`Flushed checkpoints ${from+1}–${job.nextBatch}. ${job.results.length}/${job.totalLeads} call rows saved (${uniqueLeadCount(job)} leads).`);
  });
}

async function runJob(job,{navigate=true}={}){
  if(controllers.has(job.id)){toast("That audit is already running.");return;}
  const key=getApiKey();
  if(!key){showView("settings");toast("Add an OpenAI API key first.");return;}
  if(!/^sk-[A-Za-z0-9_-]{20,}$/.test(key)){showView("settings");toast("That does not look like an OpenAI API key.");return;}

  const isReview=job.mode==="telecaller-review";
  const isParent=job.mode==="telecaller-review-parent";
  const reviewOnly=Boolean(job.reviewOnly);
  const shouldNavigate=navigate&&!isReview&&!isParent;
  const controller=new AbortController();
  controllers.set(job.id,controller);
  liveJobs.set(job.id,job);
  job.status="running";
  job.error="";
  job.startedAt=job.startedAt||timestamp();
  job.runStartedAt=timestamp();
  job.finishedAt="";
  job.tokenUsage=job.tokenUsage||{input:0,cached:0,output:0};
  job.reviewTokenUsage=job.reviewTokenUsage||{input:0,cached:0,output:0};
  job.elapsedMs=job.elapsedMs||0;
  job.pendingBatches=job.pendingBatches||{};
  job.results=Array.isArray(job.results)?job.results:[];
  job.leads=Array.isArray(job.leads)?job.leads:[];
  displayLogs=true;
  const concurrency=Math.min(MAX_CONCURRENCY,Math.max(1,Number(job.settings.concurrency)||1));
  if(reviewOnly){
    addLog(job,`Review-only pass: ${job.telecallerName||job.fileName} · ${job.results.length} audited rows · model ${job.settings.reviewModel||settings.reviewModel||"gpt-5-nano"} · app ${APP_VERSION}.`);
  }else{
    addLog(job,`Run started: live pool of ${concurrency} (next batch fires the instant one frees a slot), batch size ${job.settings.batchSize} leads, model ${job.settings.model}${isReview||isParent?`, review model ${job.settings.reviewModel||settings.reviewModel}`:""}, app ${APP_VERSION}. Checkpoints stay in order — later batches may finish API first and wait.`);
  }
  await putJob(job);
  // Reviews: only paint Run Console when this job is already selected (parallel workers must not steal).
  // Audits/parents: allow switch when no active controller on the current console job.
  if(currentJob?.id===job.id||((!isReview||isParent)&&(!currentJob||!controllers.has(currentJob.id))))renderProgress(job);
  if(shouldNavigate)showView("console");
  if(isReview||isParent)scheduleReviewProgress();

  const batchSize=Math.max(1,Number(job.settings.batchSize)||1);
  const leadGroups=reviewOnly?[]:groupCallRowsByLead(job.leads);
  const totalBatches=Math.ceil(leadGroups.length/batchSize);
  const pending=job.pendingBatches||{};
  // Full remaining work pre-queued; workers pull instantly when a slot frees.
  const queue=[];
  if(!reviewOnly){
    for(let index=0;index<totalBatches;index++){
      if(index<job.nextBatch)continue;
      if(pending[String(index)])continue;
      queue.push(index);
    }
  }

  await flushPendingBatches(job);

  const persistUsage=usage=>{
    job.tokenUsage.input+=usage.input;
    job.tokenUsage.cached+=usage.cached;
    job.tokenUsage.output+=usage.output;
    throttleProgress(job);
  };

  let fatalError=null;
  const checkpointTasks=[];
  let launched=0;
  const quietLogs=concurrency>=4;

  const workers=reviewOnly?[]:Array.from({length:Math.min(concurrency,Math.max(queue.length,1))},async()=>{
    while(!fatalError&&!controller.signal.aborted){
      const index=queue.shift();
      if(index===undefined)return;
      const leadSlice=leadGroups.slice(index*batchSize,(index+1)*batchSize);
      const batch=leadSlice.flat();
      launched++;
      if(!quietLogs||launched<=concurrency||launched%concurrency===1||index===totalBatches-1){
        addLog(job,`Dispatch batch ${index+1}/${totalBatches} (${leadSlice.length} leads · ${batch.length} call${batch.length===1?"":"s"}) · queue left ${queue.length} · pool ${concurrency}.`);
      }
      throttleProgress(job);
      try{
        const rows=await auditBatch(
          key,
          job.settings,
          batch,
          controller.signal,
          quietLogs?(message,level)=>{if(level==="error"||level==="warn")addLog(job,message,level);}:((message,level)=>addLog(job,message,level)),
          persistUsage
        );
        // Checkpoint in background — do NOT await before starting the next API call.
        checkpointTasks.push(commitBatch(job,index,rows));
      }catch(error){
        if(error.name==="AbortError"){
          // Keep the original API/root failure; sibling AbortErrors must not flip status to "paused".
          if(!(fatalError&&fatalError.name!=="AbortError"))fatalError=error;
          queue.length=0;
          return;
        }
        fatalError=error;
        queue.length=0;
        controller.abort();
      }
    }
  });

  try{
    await Promise.all(workers);
    // Drain all background checkpoints before status flip.
    await Promise.allSettled(checkpointTasks);
    await flushPendingBatches(job);
    if(fatalError)throw fatalError;
    if(!reviewOnly&&job.nextBatch<totalBatches)throw new Error("Audit stopped before all batches finished. Resume to continue.");

    if(isReview){
      if(!(job.reviewStatus==="completed"&&job.reviewText)){
        if(!job.results.length)throw new Error("No audit results available for TeleCaller review.");
        job.status="reviewing";
        job.updatedAt=timestamp();
        addLog(job,`${reviewOnly?"Starting":"Audit finished — starting"} TeleCaller review with ${job.settings.reviewModel||settings.reviewModel||"gpt-5-nano"}…`);
        await putJob(job);
        if(currentJob?.id===job.id)renderProgress(job);
        scheduleReviewProgress();
        const review=await requestTelecallerReview(key,job.settings,job,controller.signal,(message,level)=>addLog(job,message,level));
        job.reviewText=review.reviewText;
        job.reviewReport=review.reviewReport||null;
        job.reviewStatus="completed";
        job.reviewModel=review.model;
        job.reviewTokenUsage={
          input:number(job.reviewTokenUsage?.input)+number(review.tokenUsage.input),
          cached:number(job.reviewTokenUsage?.cached)+number(review.tokenUsage.cached),
          output:number(job.reviewTokenUsage?.output)+number(review.tokenUsage.output)
        };
        // Fold into tokenUsage for console totals; estimatedCost splits audit vs reviewPricing.
        job.tokenUsage.input+=review.tokenUsage.input;
        job.tokenUsage.cached+=review.tokenUsage.cached;
        job.tokenUsage.output+=review.tokenUsage.output;
        addLog(job,"TeleCaller review written.","success");
      }else{
        addLog(job,"TeleCaller review already saved — skipping second pass.");
      }
    }

    if(isParent){
      addLog(job,"Combined audit complete — splitting results by TeleCaller for parallel reviews…","success");
      await spawnCombinedReviewChildren(job);
    }

    job.status="completed";
    job.pendingBatches={};
    stopClock(job);
    job.updatedAt=timestamp();
    const billable=Math.max(0,number(job.tokenUsage.input)-number(job.tokenUsage.cached));
    const label=isParent?"Combined audit":isReview?(reviewOnly?"Review":"Review"):"Audit";
    addLog(job,`${label} complete in ${durationText(job.elapsedMs)}. Cost est. ${estimatedCost(job).toFixed(4)}. Cached ${number(job.tokenUsage.cached).toLocaleString()} · billable input ${billable.toLocaleString()} · output ${number(job.tokenUsage.output).toLocaleString()}.`,"success");
    await putJob(job);
    if(currentJob?.id===job.id)renderProgress(job);
    if(isReview||isParent)scheduleReviewProgress();
    toast(`${job.fileName}: ${isParent?"audit":isReview?"review":"audit"} complete.`);
  }catch(error){
    await Promise.allSettled(checkpointTasks);
    await flushPendingBatches(job).catch(()=>{});
    stopClock(job);
    if(error.name==="AbortError"){
      job.status="paused";
      addLog(job,"Audit paused. Completed + pending batch checkpoints are saved on this device.","warn");
    }else{
      job.status="failed";
      job.error=error.message||String(error);
      if(isReview&&job.results?.length&&!job.reviewText)job.reviewStatus="failed";
      addLog(job,`FAILED: ${job.error}`,"error");
      if(job.telecallerName)addLog(job,`TeleCaller “${job.telecallerName}” review did not finish. Open this run in the job switcher for the full log.`,"error");
    }
    job.updatedAt=timestamp();
    await putJob(job);
    if(currentJob?.id===job.id)renderProgress(job);
    if(isReview||isParent)scheduleReviewProgress();
  }finally{
    clearPendingPersist(job.id);
    controllers.delete(job.id);
    liveJobs.set(job.id,job);
  }
}

function renderFileList(){
  const list=els["file-list"];
  list.replaceChildren();
  if(!parsedFiles.length){list.classList.add("hidden");els["start-audit"].disabled=true;return;}
  list.classList.remove("hidden");
  for(const [index,file] of parsedFiles.entries()){
    const card=document.createElement("div");
    card.className="file-card";
    const left=document.createElement("div");
    const icon=document.createElement("span");
    icon.className="file-icon";
    icon.textContent="X";
    const copy=document.createElement("div");
    const title=document.createElement("strong");
    title.textContent=file.fileName;
    const meta=document.createElement("p");
    meta.textContent=`${(file.fileSize/1048576).toFixed(1)} MB · ${file.sheetName} · ${(file.leadCount??0).toLocaleString()} leads · ${(file.callCount??file.rowCount??0).toLocaleString()} calls · ${(file.latestDayCalls??file.leads.length).toLocaleString()} audited · ${file.rowCount.toLocaleString()} Excel rows`;
    copy.append(title,meta);
    left.append(icon,copy);
    const remove=document.createElement("button");
    remove.className="text-button";
    remove.textContent="Remove";
    remove.onclick=()=>{parsedFiles.splice(index,1);renderFileList();updateValidationSummary();};
    card.append(left,remove);
    list.append(card);
  }
  els["start-audit"].disabled=false;
}

function updateValidationSummary(){
  const box=els.validation;
  box.replaceChildren();
  if(!parsedFiles.length){box.className="validation hidden";return;}
  const leads=parsedFiles.reduce((sum,file)=>sum+(file.leadCount||0),0);
  const calls=parsedFiles.reduce((sum,file)=>sum+(file.callCount||file.rowCount||0),0);
  const latest=parsedFiles.reduce((sum,file)=>sum+(file.latestDayCalls||file.leads?.length||0),0);
  const estSeconds=parsedFiles.reduce((sum,file)=>sum+estimateRunSeconds(settings,file.leadCount||0,file.latestDayCalls||file.leads?.length||0),0);
  const summary=document.createElement("div");
  const prefix=parsedFiles.length>1?`${parsedFiles.length} files · `:"";
  summary.textContent=`${prefix}${leads.toLocaleString()} leads · ${calls.toLocaleString()} calls · ${latest.toLocaleString()} audited · ~${durationText(estSeconds*1000)} estimated`;
  box.append(summary);
  // Compare uploaded columns against the enabled Settings fields.
  const missing=new Set(),unknown=new Set();
  for(const file of parsedFiles){
    for(const label of file.missingColumns||[])missing.add(label);
    for(const header of file.unknownHeaders||[])unknown.add(header);
  }
  if(missing.size||unknown.size){
    box.className="validation warn";
    const note=document.createElement("div");
    note.className="validation-note";
    const parts=[];
    if(missing.size)parts.push(`Missing from the file for your enabled Settings columns: ${[...missing].join(", ")}.`);
    if(unknown.size)parts.push(`In the file but not mapped to any Settings column: ${[...unknown].join(", ")}.`);
    note.textContent=`Column check — ${parts.join(" ")} Adjust aliases in Settings if headers differ.`;
    box.append(note);
  }else{
    box.className="validation";
  }
}

async function handleFiles(fileList){
  const files=[...fileList||[]].filter(file=>/\.(xlsx|xls|xlsm)$/i.test(file.name));
  if(!files.length){toast("Choose Excel workbook(s).");return;}
  els.validation.className="validation";
  els.validation.classList.remove("hidden");
  els.validation.textContent=`Reading ${files.length} workbook${files.length>1?"s":""}…`;
  const next=[];
  const errors=[];
  for(const file of files){
    try{
      const parsed=parseWorkbook(await file.arrayBuffer(),settings);
      next.push({...parsed,fileName:file.name,fileSize:file.size});
    }catch(error){
      errors.push(`${file.name}: ${error.message}`);
    }
  }
  if(!next.length){
    els.validation.className="validation error";
    els.validation.textContent=errors.join(" ");
    els["start-audit"].disabled=true;
    return;
  }
  parsedFiles=next;
  renderFileList();
  updateValidationSummary();
  if(errors.length)toast(`${errors.length} file(s) skipped.`);
}

async function startNew(){
  if(!parsedFiles.length)return;
  const jobs=[];
  for(const file of parsedFiles){
    const job={
      id:crypto.randomUUID(),
      engineVersion:ENGINE_VERSION,
      appVersion:APP_VERSION,
      fileName:file.fileName,
      sheetName:file.sheetName,
      createdAt:timestamp(),
      updatedAt:timestamp(),
      status:"queued",
      totalLeads:file.leads.length,
      leadCount:file.leadCount||0,
      callCount:file.callCount||0,
      latestDayCalls:file.latestDayCalls||file.leads.length,
      rowCount:file.rowCount||0,
      nextBatch:0,
      pendingBatches:{},
      leads:file.leads,
      results:[],
      logs:[],
      tokenUsage:{input:0,cached:0,output:0},
      elapsedMs:0,
      pricing:deepCopy(settings.pricing),
      reviewPricing:deepCopy(settings.reviewPricing),
      settings:deepCopy(settings)
    };
    await putJob(job);
    jobs.push(job);
  }
  parsedFiles=[];
  renderFileList();
  updateValidationSummary();
  els["file-input"].value="";
  currentJob=jobs[0];
  renderProgress(jobs[0]);
  showView("console");
  // Run files one after another so concurrency stays within the per-job limit
  // (parallel files would multiply OpenAI requests and trip rate limits).
  for(const job of jobs)await runJob(job);
}

function preferredTelecallerName(file){
  const fromData=(file.leads||[]).map(lead=>String(lead.staticValues?.telecaller||"").trim()).find(Boolean);
  if(fromData)return fromData;
  const base=String(file.fileName||"").replace(/\.(xlsx|xls|xlsm)$/i,"").trim();
  return base||"Unknown";
}

function createCombinedParentJob(file){
  const splits=file.splitPreview||splitLeadsByTelecaller(file.leads||[]);
  return{
    id:crypto.randomUUID(),
    engineVersion:ENGINE_VERSION,
    appVersion:APP_VERSION,
    mode:"telecaller-review-parent",
    fileName:file.fileName,
    parentFileName:file.fileName,
    sheetName:file.sheetName||"",
    telecallerName:"Combined audit",
    createdAt:timestamp(),
    updatedAt:timestamp(),
    status:"queued",
    totalLeads:file.leads.length,
    leadCount:file.leadCount||0,
    callCount:file.callCount||file.leads.length,
    latestDayCalls:file.latestDayCalls||file.leads.length,
    rowCount:file.rowCount||0,
    expectedTelecallerCount:splits.length||0,
    nextBatch:0,
    pendingBatches:{},
    leads:file.leads,
    results:[],
    logs:[],
    tokenUsage:{input:0,cached:0,output:0},
    reviewTokenUsage:{input:0,cached:0,output:0},
    childReviewIds:[],
    elapsedMs:0,
    pricing:deepCopy(settings.pricing),
    reviewPricing:deepCopy(settings.reviewPricing),
    settings:deepCopy(settings)
  };
}

/** Separate-file unit: audit then review for one workbook / telecaller. */
function createReviewJob({fileName,parentFileName,sheetName,telecallerName,leads,leadCount,callCount,rowCount,latestDayCalls}){
  return{
    id:crypto.randomUUID(),
    engineVersion:ENGINE_VERSION,
    appVersion:APP_VERSION,
    mode:"telecaller-review",
    reviewOnly:false,
    fileName,
    parentFileName:parentFileName||fileName,
    sheetName:sheetName||"",
    telecallerName:telecallerName||"Unknown",
    createdAt:timestamp(),
    updatedAt:timestamp(),
    status:"queued",
    totalLeads:leads.length,
    leadCount:leadCount||0,
    callCount:callCount||leads.length,
    latestDayCalls:latestDayCalls||leads.length,
    rowCount:rowCount||leads.length,
    nextBatch:0,
    pendingBatches:{},
    leads,
    results:[],
    logs:[],
    tokenUsage:{input:0,cached:0,output:0},
    reviewTokenUsage:{input:0,cached:0,output:0},
    reviewText:"",
    reviewReport:null,
    reviewStatus:"pending",
    elapsedMs:0,
    pricing:deepCopy(settings.pricing),
    reviewPricing:deepCopy(settings.reviewPricing),
    settings:deepCopy(settings)
  };
}

/** Post-audit child: review pass only — never re-audits. */
function createReviewOnlyJob({parentJobId,parentFileName,sheetName,telecallerName,results,leads,leadCount,callCount}){
  const rows=Array.isArray(results)?results:[];
  return{
    id:crypto.randomUUID(),
    engineVersion:ENGINE_VERSION,
    appVersion:APP_VERSION,
    mode:"telecaller-review",
    reviewOnly:true,
    parentJobId:parentJobId||"",
    fileName:`${parentFileName||"Review"} · ${telecallerName||"Unknown"}`,
    parentFileName:parentFileName||"",
    sheetName:sheetName||"",
    telecallerName:telecallerName||"Unknown",
    createdAt:timestamp(),
    updatedAt:timestamp(),
    status:"queued",
    totalLeads:rows.length,
    leadCount:leadCount||0,
    callCount:callCount||rows.length,
    latestDayCalls:rows.length,
    rowCount:rows.length,
    nextBatch:0,
    pendingBatches:{},
    leads:Array.isArray(leads)?leads:[],
    results:rows,
    logs:[],
    tokenUsage:{input:0,cached:0,output:0},
    reviewTokenUsage:{input:0,cached:0,output:0},
    reviewText:"",
    reviewReport:null,
    reviewStatus:"pending",
    elapsedMs:0,
    pricing:deepCopy(settings.pricing),
    reviewPricing:deepCopy(settings.reviewPricing),
    settings:deepCopy(settings)
  };
}

/**
 * After Combined parent audit: split results by telecaller, enqueue review-only children (max 10 parallel via drain).
 */
async function spawnCombinedReviewChildren(parentJob){
  if(Array.isArray(parentJob.childReviewIds)&&parentJob.childReviewIds.length){
    addLog(parentJob,`Review children already spawned (${parentJob.childReviewIds.length}) — re-queuing incomplete.`);
    for(const id of parentJob.childReviewIds){
      const child=liveJobs.get(id)||await getJob(id);
      if(child&&!(child.reviewStatus==="completed"&&child.reviewText)&&!controllers.has(child.id)){
        liveJobs.set(child.id,child);
        if(!reviewQueue.some(item=>item.id===child.id))reviewQueue.push(child);
        if(!reviewSessionIds.includes(child.id))reviewSessionIds.push(child.id);
      }
    }
    saveReviewSessionIds();
    scheduleReviewProgress();
    drainReviewQueue();
    return;
  }
  const splits=splitResultsByTelecaller(parentJob.results||[]);
  if(!splits.length)throw new Error("Combined audit produced no TeleCaller groups to review.");
  const leadSplits=splitLeadsByTelecaller(parentJob.leads||[]);
  const leadsByName=new Map(leadSplits.map(item=>[item.telecallerName.toLowerCase(),item.leads]));
  const children=[];
  for(const split of splits){
    const leads=leadsByName.get(String(split.telecallerName||"").toLowerCase())||[];
    const child=createReviewOnlyJob({
      parentJobId:parentJob.id,
      parentFileName:parentJob.parentFileName||parentJob.fileName,
      sheetName:parentJob.sheetName,
      telecallerName:split.telecallerName,
      results:split.results,
      leads,
      leadCount:split.leadCount,
      callCount:split.callCount
    });
    await putJob(child);
    liveJobs.set(child.id,child);
    children.push(child);
    if(!reviewSessionIds.includes(child.id))reviewSessionIds.push(child.id);
  }
  parentJob.childReviewIds=children.map(child=>child.id);
  parentJob.updatedAt=timestamp();
  await putJob(parentJob);
  saveReviewSessionIds();
  reviewQueue.push(...children);
  addLog(parentJob,`Queued ${children.length} TeleCaller review${children.length===1?"":"s"} (up to ${REVIEW_JOB_CONCURRENCY} in parallel).`);
  scheduleReviewProgress();
  drainReviewQueue();
}

function setReviewFormat(format){
  reviewFormat=format==="separate"?"separate":"combined";
  document.querySelectorAll("[data-review-format]").forEach(button=>{
    button.classList.toggle("active",button.dataset.reviewFormat===reviewFormat);
  });
  if(els["review-drop-hint"]){
    els["review-drop-hint"].textContent=reviewFormat==="combined"
      ?"Combined team export · audited once, then parallel TeleCaller reviews · XLSX, XLS or XLSM"
      :"One workbook per TeleCaller · add more while the queue runs · XLSX, XLS or XLSM";
  }
  if(els["review-file-input"])els["review-file-input"].multiple=reviewFormat==="separate";
  // Combined mode keeps a single file; switching clears the other format's staging list.
  if(reviewFormat==="combined"&&reviewParsedFiles.length>1)reviewParsedFiles=reviewParsedFiles.slice(0,1);
  renderReviewFileList();
  updateReviewValidation();
}

function getReviewPacking(){
  const checked=document.querySelector('input[name="review-packing"]:checked');
  return checked?.value==="separate"?"separate":"combined";
}

function scheduleReviewProgress(){
  if(scheduleReviewProgress._timer)return;
  scheduleReviewProgress._timer=setTimeout(()=>{
    scheduleReviewProgress._timer=null;
    renderReviewProgress();
  },150);
}

function renderReviewFileList(){
  const list=els["review-file-list"];
  if(!list)return;
  list.replaceChildren();
  if(!reviewParsedFiles.length){
    list.classList.add("hidden");
    if(els["start-review"]&&!reviewQueueRunning)els["start-review"].disabled=true;
    return;
  }
  list.classList.remove("hidden");
  for(const [index,file] of reviewParsedFiles.entries()){
    const card=document.createElement("div");
    card.className="file-card";
    const left=document.createElement("div");
    const icon=document.createElement("span");
    icon.className="file-icon";
    icon.textContent="X";
    const copy=document.createElement("div");
    const title=document.createElement("strong");
    title.textContent=file.fileName;
    const meta=document.createElement("p");
    if(file.splitPreview?.length){
      meta.textContent=`${file.splitPreview.length} TeleCaller${file.splitPreview.length===1?"":"s"} · ${(file.leadCount??0).toLocaleString()} leads · ${(file.callCount??file.leads?.length??0).toLocaleString()} calls`;
    }else{
      meta.textContent=`${preferredTelecallerName(file)} · ${(file.leadCount??0).toLocaleString()} leads · ${(file.callCount??file.leads?.length??0).toLocaleString()} calls`;
    }
    copy.append(title,meta);
    left.append(icon,copy);
    const remove=document.createElement("button");
    remove.className="text-button";
    remove.textContent="Remove";
    remove.onclick=()=>{reviewParsedFiles.splice(index,1);renderReviewFileList();updateReviewValidation();};
    card.append(left,remove);
    list.append(card);
  }
  if(els["start-review"])els["start-review"].disabled=false;
}

function updateReviewValidation(){
  const box=els["review-validation"];
  if(!box)return;
  box.replaceChildren();
  if(!reviewParsedFiles.length){box.className="validation hidden";return;}
  const notes=[];
  let leads=0,calls=0,est=0,unknownBuckets=0,telecallerMissing=false;
  if(reviewFormat==="combined"){
    const file=reviewParsedFiles[0];
    leads=file.leadCount||0;
    calls=file.callCount||file.leads?.length||0;
    const splits=file.splitPreview||splitLeadsByTelecaller(file.leads||[]);
    file.splitPreview=splits;
    if(!splits.length)telecallerMissing=true;
    unknownBuckets+=splits.filter(item=>item.unknown).length;
    if((file.missingColumns||[]).some(label=>/telecaller/i.test(label)))telecallerMissing=true;
    est=estimateCombinedReviewSessionSeconds(
      settings,
      file.leadCount||0,
      file.latestDayCalls||file.leads?.length||0,
      splits.map(item=>item.callCount||item.leads?.length||0),
      REVIEW_JOB_CONCURRENCY
    );
  }else{
    const jobSecs=[];
    for(const file of reviewParsedFiles){
      leads+=file.leadCount||0;
      calls+=file.callCount||file.leads?.length||0;
      jobSecs.push(estimateReviewRunSeconds(settings,file.leadCount||0,file.latestDayCalls||file.leads?.length||0));
    }
    est=estimatePooledSeconds(jobSecs,REVIEW_JOB_CONCURRENCY);
  }
  const summary=document.createElement("div");
  const prefix=reviewParsedFiles.length>1?`${reviewParsedFiles.length} files · `:"";
  const poolNote=reviewFormat==="combined"
    ?" (1 audit + up to 10 parallel reviews)"
    :" (up to 10 jobs in parallel)";
  summary.textContent=`${prefix}${leads.toLocaleString()} leads · ${calls.toLocaleString()} calls · ~${durationText(est*1000)} estimated${poolNote}`;
  box.append(summary);
  if(reviewFormat==="combined"&&telecallerMissing)notes.push("Telecaller Name column is required for Combined Excel. Map aliases in Settings if the header differs.");
  if(unknownBuckets)notes.push(`${unknownBuckets} TeleCaller bucket(s) have blank names and will run as Unknown.`);
  const missing=new Set(),unknown=new Set();
  for(const file of reviewParsedFiles){
    for(const label of file.missingColumns||[])missing.add(label);
    for(const header of file.unknownHeaders||[])unknown.add(header);
  }
  if(missing.size)notes.push(`Missing enabled Settings columns: ${[...missing].join(", ")}.`);
  if(unknown.size)notes.push(`Unmapped headers: ${[...unknown].join(", ")}.`);
  if(notes.length){
    box.className="validation warn";
    for(const text of notes){
      const note=document.createElement("div");
      note.className="validation-note";
      note.textContent=text;
      box.append(note);
    }
  }else{
    box.className="validation";
  }
}

async function handleReviewFiles(fileList,{append=false}={}){
  const files=[...fileList||[]].filter(file=>/\.(xlsx|xls|xlsm)$/i.test(file.name));
  if(!files.length){toast("Choose Excel workbook(s).");return;}
  const box=els["review-validation"];
  box.className="validation";
  box.classList.remove("hidden");
  box.textContent=`Reading ${files.length} workbook${files.length>1?"s":""}…`;
  const next=[];
  const errors=[];
  for(const file of files){
    try{
      const parsed=parseWorkbook(await file.arrayBuffer(),settings);
      const entry={...parsed,fileName:file.name,fileSize:file.size};
      if(reviewFormat==="combined")entry.splitPreview=splitLeadsByTelecaller(parsed.leads||[]);
      next.push(entry);
    }catch(error){
      errors.push(`${file.name}: ${error.message}`);
    }
  }
  if(!next.length){
    box.className="validation error";
    box.textContent=errors.join(" ");
    if(!append)els["start-review"].disabled=true;
    return;
  }
  if(reviewFormat==="combined"){
    reviewParsedFiles=[next[0]];
    if(next.length>1)toast("Combined mode uses the first file only.");
  }else if(append||reviewQueueRunning||reviewParsedFiles.length){
    reviewParsedFiles=[...reviewParsedFiles,...next];
  }else{
    reviewParsedFiles=next;
  }
  renderReviewFileList();
  updateReviewValidation();
  if(errors.length)toast(`${errors.length} file(s) skipped.`);

  // Separate mode: enqueue additional jobs while the queue is live.
  if(reviewFormat==="separate"&&reviewQueueRunning&&next.length){
    await enqueueSeparateReviewFiles(next);
    // Keep any files that were staged before this drop out of the auto-enqueue set.
    reviewParsedFiles=reviewParsedFiles.filter(file=>!next.includes(file));
    renderReviewFileList();
    updateReviewValidation();
    if(els["review-file-input"])els["review-file-input"].value="";
  }
}

async function enqueueSeparateReviewFiles(files){
  const jobs=[];
  for(const file of files){
    const telecallerName=preferredTelecallerName(file);
    const job=createReviewJob({
      fileName:file.fileName,
      parentFileName:file.fileName,
      sheetName:file.sheetName,
      telecallerName,
      leads:file.leads,
      leadCount:file.leadCount||0,
      callCount:file.callCount||file.leads.length,
      rowCount:file.rowCount||0,
      latestDayCalls:file.latestDayCalls||file.leads.length
    });
    await putJob(job);
    liveJobs.set(job.id,job);
    jobs.push(job);
    if(!reviewSessionIds.includes(job.id))reviewSessionIds.push(job.id);
  }
  saveReviewSessionIds();
  reviewQueue.push(...jobs);
  scheduleReviewProgress();
  drainReviewQueue();
}

async function startReview(){
  if(reviewFormat==="combined"){
    if(!reviewParsedFiles.length)return;
    const file=reviewParsedFiles[0];
    const splits=file.splitPreview||splitLeadsByTelecaller(file.leads||[]);
    if(!splits.length){toast("No TeleCaller groups found.");return;}
    const hasTelecallerColumn=!(file.missingColumns||[]).some(label=>/telecaller/i.test(label));
    // Soft-block only when every name is Unknown AND the column was missing.
    if(!hasTelecallerColumn&&splits.every(item=>item.unknown)){
      toast("Combined Excel needs a Telecaller Name column.");
      return;
    }
    reviewSessionIds=[];
    reviewQueue=[];
    for(const id of [...liveJobs.keys()])liveJobs.delete(id);
    const parent=createCombinedParentJob(file);
    await putJob(parent);
    liveJobs.set(parent.id,parent);
    reviewSessionIds.push(parent.id);
    saveReviewSessionIds();
    reviewParsedFiles=[];
    renderReviewFileList();
    updateReviewValidation();
    if(els["review-file-input"])els["review-file-input"].value="";
    els["review-run-panel"]?.classList.remove("hidden");
    currentJob=parent;
    renderProgress(parent);
    scheduleReviewProgress();
    // Audit entire file once; children spawn after audit (parallel reviews only).
    reviewQueue.push(parent);
    drainReviewQueue();
    return;
  }

  // Separate files
  if(!reviewParsedFiles.length&&!reviewQueueRunning)return;
  if(reviewParsedFiles.length){
    if(!reviewQueueRunning){
      reviewSessionIds=[];
      reviewQueue=[];
      for(const id of [...liveJobs.keys()])liveJobs.delete(id);
    }
    await enqueueSeparateReviewFiles(reviewParsedFiles);
    reviewParsedFiles=[];
    renderReviewFileList();
    updateReviewValidation();
    if(els["review-file-input"])els["review-file-input"].value="";
  }
  els["review-run-panel"]?.classList.remove("hidden");
  scheduleReviewProgress();
}

/**
 * Outer worker pool: up to REVIEW_JOB_CONCURRENCY TeleCaller jobs in parallel.
 * Each job keeps its own runJob / AbortController / IndexedDB checkpoints.
 * Pause in Run Console aborts only currentJob (per-job), not the whole queue.
 */
function drainReviewQueue(){
  if(els["start-review"]&&reviewFormat==="separate"&&(reviewQueue.length||reviewActiveCount)){
    els["start-review"].textContent="Add to queue →";
  }
  if(reviewQueue.length||reviewActiveCount)reviewQueueRunning=true;

  const innerConcurrency=Math.min(MAX_CONCURRENCY,Math.max(1,Number(settings.concurrency)||1));
  const launching=Math.min(REVIEW_JOB_CONCURRENCY-reviewActiveCount,reviewQueue.length);
  if(launching>0&&!drainReviewQueue._rateWarned&&(reviewActiveCount+launching)>=REVIEW_JOB_CONCURRENCY&&innerConcurrency>1){
    console.warn(`LeadLens: up to ${REVIEW_JOB_CONCURRENCY} TeleCaller jobs × ${innerConcurrency} batch concurrency may hit OpenAI rate limits.`);
    drainReviewQueue._rateWarned=true;
  }

  while(reviewActiveCount<REVIEW_JOB_CONCURRENCY&&reviewQueue.length){
    const queued=reviewQueue.shift();
    if(!queued)break;
    // Sync claim so the first launched job owns the console before other workers start.
    if(!currentJob)currentJob=queued;
    reviewActiveCount++;
    reviewQueueRunning=true;
    (async()=>{
      try{
        // Fresh IndexedDB copy per worker — never share mutable job state across workers.
        const fresh=await getJob(queued.id)||queued;
        liveJobs.set(fresh.id,fresh);
        if(currentJob?.id===queued.id)currentJob=fresh;
        await runJob(fresh,{navigate:false});
        // Parent Combined audit stays as currentJob — mirror child failures onto the parent log
        // so Run Console still shows why a TeleCaller failed without hunting the switcher.
        const finished=liveJobs.get(fresh.id)||await getJob(fresh.id)||fresh;
        if(finished.status==="failed"){
          const reason=finished.error||"Unknown error";
          const who=finished.telecallerName||finished.fileName||"TeleCaller";
          if(finished.parentJobId){
            const parent=liveJobs.get(finished.parentJobId)||await getJob(finished.parentJobId);
            if(parent){
              addLog(parent,`TeleCaller review FAILED · ${who}: ${reason}`,"error");
              parent.updatedAt=timestamp();
              await putJob(parent);
              liveJobs.set(parent.id,parent);
              if(currentJob?.id===parent.id){displayLogs=true;renderProgress(parent);}
            }
          }
          toast(`Review failed · ${who}`);
        }
      }finally{
        reviewActiveCount--;
        scheduleReviewProgress();
        if(reviewQueue.length){
          drainReviewQueue();
        }else if(reviewActiveCount===0){
          reviewQueueRunning=false;
          drainReviewQueue._rateWarned=false;
          if(els["start-review"])els["start-review"].textContent="Start review →";
          scheduleReviewProgress();
        }
      }
    })();
  }
}

async function getReviewSessionJobs(){
  if(!reviewSessionIds.length)loadReviewSessionIds();
  const jobs=[];
  for(const id of reviewSessionIds){
    const live=liveJobs.get(id);
    if(live){jobs.push(live);continue;}
    const job=await getJob(id);
    if(job){
      liveJobs.set(job.id,job);
      jobs.push(job);
    }
  }
  return jobs;
}

async function renderReviewProgress(){
  const panel=els["review-run-panel"];
  const cards=els["review-cards"];
  const aggregate=els["review-aggregate"];
  const downloads=els["review-download-panel"];
  if(!panel||!cards)return;
  const jobs=await getReviewSessionJobs();
  if(!jobs.length){
    if(!reviewQueueRunning)panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");
  cards.replaceChildren();
  const parentJobs=jobs.filter(job=>job.mode==="telecaller-review-parent");
  const reviewJobs=jobs.filter(job=>job.mode==="telecaller-review");
  // During Combined parent audit: show the parent card. After split: TeleCaller review cards only.
  const cardJobs=reviewJobs.length?reviewJobs:parentJobs.length?parentJobs:jobs;
  let totalLeads=0,totalCalls=0,totalDone=0,totalTarget=0,totalCost=0;
  let completed=0;
  if(parentJobs.length){
    for(const parent of parentJobs){
      totalLeads+=uniqueLeadCount(parent)||0;
      totalCalls+=Number(parent.callCount)||0;
      totalDone+=auditedDoneCount(parent);
      totalTarget+=parent.totalLeads||0;
      totalCost+=estimatedCost(parent);
    }
    for(const job of reviewJobs){
      totalCost+=estimatedCost(job);
      if(job.status==="completed"&&job.reviewText)completed++;
    }
  }else{
    for(const job of reviewJobs.length?reviewJobs:jobs){
      totalLeads+=uniqueLeadCount(job)||0;
      totalCalls+=Number(job.callCount)||0;
      totalDone+=auditedDoneCount(job);
      totalTarget+=job.totalLeads||0;
      totalCost+=estimatedCost(job);
      if(job.status==="completed")completed++;
    }
  }

  const sessionDone=jobs.every(job=>["completed","failed"].includes(job.status))&&!reviewQueueRunning
    &&(!reviewJobs.length||reviewJobs.every(job=>job.status==="completed"||job.status==="failed"));
  const wallMs=sessionWallMs(jobs);
  const remainingSec=sessionDone?0:estimateSessionRemainingSeconds(parentJobs,reviewJobs,jobs);

  for(const job of cardJobs){
    const done=auditedDoneCount(job);
    const target=job.totalLeads||0;
    const pct=job.reviewOnly
      ?(job.status==="completed"?100:job.status==="reviewing"?70:job.status==="running"?40:job.status==="failed"?100:job.reviewText?100:5)
      :(target?Math.round(Math.min(done,target)/target*100):job.status==="completed"?100:job.status==="reviewing"?99:0);
    const remSec=jobRemainingSeconds(job);
    const jobElapsed=elapsed(job);

    const card=document.createElement("article");
    card.className=`review-card${job.mode==="telecaller-review-parent"?" combined-audit":""}${job.status==="failed"?" is-failed":""}`;
    card.tabIndex=0;
    card.setAttribute("role","button");
    card.title="Open Run console logs for this TeleCaller";
    const openConsole=()=>{displayLogs=true;renderProgress(job);showView("console");};
    card.onclick=openConsole;
    card.onkeydown=event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();openConsole();}};
    const head=document.createElement("div");
    head.className="review-card-head";
    const title=document.createElement("strong");
    title.textContent=job.mode==="telecaller-review-parent"
      ?`Combined audit · ${job.fileName||""}`
      :(job.telecallerName||job.fileName);
    const status=document.createElement("span");
    status.className=`status ${job.status}`;
    status.textContent=job.mode==="telecaller-review-parent"&&job.status==="completed"
      ?"audit done"
      :(job.status==="reviewing"?"reviewing":job.reviewOnly&&job.status==="running"?"reviewing":job.status);
    head.append(title,status);
    const track=document.createElement("div");
    track.className="progress-track";
    const bar=document.createElement("div");
    bar.className="progress-bar";
    bar.style.width=`${pct}%`;
    track.append(bar);
    const metrics=document.createElement("div");
    metrics.className="review-card-metrics";
    const timeLabel=job.status==="completed"||job.status==="failed"?"Time":"Elapsed";
    const timeValue=durationText((job.status==="completed"||job.status==="failed")?(job.elapsedMs||jobElapsed):jobElapsed);
    const etaLabel=job.status==="completed"?"Done":job.status==="failed"?"Failed":"ETA left";
    const etaValue=job.status==="completed"||job.status==="failed"?"—":(remSec?`~${durationText(remSec*1000)}`:"—");
    const cells=[
      ["Leads",String(uniqueLeadCount(job)||"—")],
      ["Calls",job.callCount!=null?Number(job.callCount).toLocaleString():"—"],
      [job.reviewOnly?"Rows":"Audited",target?`${done} / ${target}`:"—"],
      [timeLabel,timeValue],
      [etaLabel,`${etaValue} · ${estimatedCost(job).toFixed(4)}`]
    ];
    for(const [label,value] of cells){
      const cell=document.createElement("div");
      const span=document.createElement("span");
      span.textContent=label;
      const strong=document.createElement("strong");
      strong.textContent=value;
      cell.append(span,strong);
      metrics.append(cell);
    }
    card.append(head,track,metrics);
    if(job.status==="failed"&&job.error){
      const err=document.createElement("p");
      err.className="review-card-error";
      err.textContent=job.error;
      card.append(err);
      const retryRow=document.createElement("div");
      retryRow.className="review-card-actions";
      const retry=document.createElement("button");
      retry.type="button";
      retry.className="secondary-button";
      retry.textContent="Retry review";
      retry.onclick=async event=>{
        event.stopPropagation();
        if(controllers.has(job.id)){toast("That review is already running.");return;}
        reviewQueue.unshift(job);
        toast(`Re-queued ${job.telecallerName||job.fileName}`);
        drainReviewQueue();
        scheduleReviewProgress();
      };
      const view=document.createElement("button");
      view.type="button";
      view.className="text-button";
      view.textContent="View logs";
      view.onclick=event=>{event.stopPropagation();openConsole();};
      retryRow.append(retry,view);
      card.append(retryRow);
    }
    cards.append(card);
  }

  if(aggregate){
    aggregate.classList.remove("hidden");
    aggregate.replaceChildren();
    const teleTotal=reviewJobs.length
      ||parentJobs[0]?.expectedTelecallerCount
      ||parentJobs[0]?.childReviewIds?.length
      ||jobs.length;
    const teleDone=reviewJobs.length
      ?reviewJobs.filter(job=>job.status==="completed"&&job.reviewText).length
      :completed;
    const teleFailed=reviewJobs.filter(job=>job.status==="failed").length;
    const timeLabel=sessionDone?"Total Time Taken":"ETA left / Cost";
    const timeValue=sessionDone
      ?durationText(wallMs)
      :`~${durationText(remainingSec*1000)} · ${totalCost.toFixed(4)}`;
    const items=[
      ["TeleCallers",`${teleDone} / ${teleTotal}${teleFailed?` · ${teleFailed} failed`:""}`],
      ["Leads",totalLeads.toLocaleString()],
      ["Audited",totalTarget?`${totalDone} / ${totalTarget}`:"—"],
      [timeLabel,timeValue]
    ];
    if(sessionDone){
      items.push(["Cost",totalCost.toFixed(4)]);
    }else if(wallMs>0){
      items.push(["Elapsed",durationText(wallMs)]);
    }
    for(const [label,value] of items){
      const cell=document.createElement("div");
      const span=document.createElement("span");
      span.textContent=label;
      const strong=document.createElement("strong");
      strong.textContent=value;
      if(label==="Total Time Taken")strong.className="total-time-taken";
      cell.append(span,strong);
      aggregate.append(cell);
    }
  }

  if(downloads){
    const ready=jobs.filter(job=>job.mode==="telecaller-review"&&job.status==="completed"&&job.reviewText);
    const allDone=sessionDone;
    if(ready.length&&allDone){
      downloads.classList.remove("hidden");
      els["download-review-pdf"].disabled=false;
      els["download-review-excel"].disabled=false;
    }else if(ready.length){
      downloads.classList.remove("hidden");
      els["download-review-pdf"].disabled=false;
      els["download-review-excel"].disabled=false;
    }else{
      downloads.classList.add("hidden");
      els["download-review-pdf"].disabled=true;
      els["download-review-excel"].disabled=true;
    }
  }
}

async function downloadReviewArtifact(artifact){
  try{
    const jobs=await getReviewSessionJobs();
    // Exclude combined parent audit — children hold per-telecaller reviewText + result subsets.
    const ready=jobs.filter(job=>job.mode==="telecaller-review"&&job.status==="completed"&&(job.reviewText||job.results?.length));
    if(!ready.length){toast("No completed reviews yet.");return;}
    const live=collectSettings();
    settings=live;
    saveSettings(settings);
    await downloadReviewPack(ready,live,{packing:getReviewPacking(),artifact});
    toast(artifact==="pdf"?"Performance report PDF downloaded.":"Audit Excel downloaded.");
  }catch(error){toast(error.message);}
}

function download(job){
  try{
    const live=collectSettings();
    settings=live;
    saveSettings(settings);
    downloadWorkbook(job,live);
    toast(`Downloaded · sorted by ${live.sort.field} (${live.sort.direction})`);
  }catch(error){toast(error.message);}
}

async function renderHistory(){
  const jobs=await getJobs();
  els["history-list"].replaceChildren();
  if(!jobs.length){els["history-list"].innerHTML='<div class="empty-card">No audits yet.</div>';return;}
  for(const job of jobs){
    const legacy=job.engineVersion!==ENGINE_VERSION;
    const card=document.createElement("article"),info=document.createElement("div"),title=document.createElement("strong"),status=document.createElement("span"),meta=document.createElement("div"),actions=document.createElement("div");
    card.className="history-item";
    title.textContent=job.fileName;
    status.className=`status ${legacy?"legacy":job.status}`;
    status.textContent=legacy?"legacy — rerun":job.status;
    meta.className="history-meta";
    meta.textContent=legacy
      ?`${timeText(job.createdAt)} · previous engine result — upload the file and run it again for v2 rules.`
      :`${timeText(job.createdAt)} · ${job.mode==="telecaller-review"?`Review · ${job.telecallerName||"TeleCaller"} · `:job.mode==="telecaller-review-parent"?`Combined audit · `:""}${uniqueLeadCount(job)} leads · ${job.callCount??job.rowCount??"—"} calls · ${auditedDoneCount(job)}/${job.totalLeads} audited · ${durationText(job.elapsedMs||0)} · cost ${estimatedCost(job).toFixed(4)} · cached ${number(job.tokenUsage?.cached).toLocaleString()}`;
    info.append(title,document.createTextNode(" "),status,meta);
    actions.className="history-actions";
    const view=document.createElement("button");
    view.className="secondary-button";
    view.textContent="View run";
    view.onclick=()=>{displayLogs=true;renderProgress(job);showView("console");};
    actions.append(view);
    if(job.status==="completed"&&!legacy){
      if(job.mode==="telecaller-review"){
        const reviewBtn=document.createElement("button");
        reviewBtn.className="primary-button";
        reviewBtn.textContent="Download report";
        reviewBtn.onclick=async()=>{
          try{
            const live=collectSettings();
            settings=live;saveSettings(settings);
            await downloadReviewPack([job],live,{packing:"separate",artifact:"both"});
            toast("Performance report PDF + Excel downloaded.");
          }catch(error){toast(error.message);}
        };
        actions.append(reviewBtn);
      }else{
        const button=document.createElement("button");
        button.className="primary-button";
        button.textContent="Download";
        button.onclick=()=>download(job);
        actions.append(button);
      }
    }else if(!legacy){
      const resume=document.createElement("button");
      resume.className="primary-button";
      resume.textContent=controllers.has(job.id)?"Running…":"Resume";
      resume.disabled=controllers.has(job.id);
      resume.onclick=async()=>runJob(await getJob(job.id));
      actions.append(resume);
    }
    const remove=document.createElement("button");
    remove.className="text-button";
    remove.textContent="Delete";
    remove.onclick=async()=>{
      if(controllers.has(job.id)){toast("Pause the run before deleting.");return;}
      if(confirm("Delete this audit, checkpoint and local logs?")){
        await deleteJob(job.id);
        if(currentJob?.id===job.id){currentJob=null;setActiveJobId("");}
        renderHistory();
      }
    };
    actions.append(remove);
    card.append(info,actions);
    els["history-list"].append(card);
  }
}

function configRow(className){const row=document.createElement("div");row.className=className;return row;}
function input(type,value,aria){const element=document.createElement("input");element.type=type;element.value=value??"";if(aria)element.setAttribute("aria-label",aria);return element;}
const SYSTEM_OUTPUT_IDS=new Set(DEFAULT_OUTPUT_FIELDS.map(field=>field.id));
function syncCustomOutputField(field,{remove=false}={}){
  if(!field?.id||SYSTEM_OUTPUT_IDS.has(field.id)||field.id==="update")return;
  const list=settings.outputFields.slice();
  const index=list.findIndex(item=>item.id===field.id);
  if(remove){
    if(index>=0)list.splice(index,1);
  }else if(index<0){
    list.push({id:field.id,label:field.label||field.id,enabled:true});
  }else{
    list[index]={...list[index],label:field.label||list[index].label};
  }
  settings.outputFields=list;
}
function moveInputField(index,delta){
  settings=collectSettings();
  const target=index+delta;
  if(target<0||target>=settings.inputFields.length)return;
  const copy=settings.inputFields.slice();
  const [row]=copy.splice(index,1);
  copy.splice(target,0,row);
  settings.inputFields=normalizeInputFields(copy,false);
  renderInputFields();
}
function renderInputFields(){
  els["input-field-config"].replaceChildren();
  for(let index=0;index<settings.inputFields.length;index++){
    const field=settings.inputFields[index];
    const row=configRow("config-row mapping-row input-field-row");
    const toggle=input("checkbox","",`${field.label} enabled`);
    const label=input("text",field.label,`${field.label} display name`);
    const aliases=input("text",field.aliases,`${field.label} aliases`);
    const actions=document.createElement("div");
    const up=document.createElement("button");
    const down=document.createElement("button");
    const remove=document.createElement("button");
    row.dataset.inputRow=field.id;
    if(field.required)row.dataset.required="1";
    toggle.checked=field.required||field.enabled!==false;
    toggle.disabled=field.required;
    toggle.dataset.inputEnabled=field.id;
    label.dataset.inputLabel=field.id;
    aliases.dataset.aliasId=field.id;
    label.placeholder="Column name";
    aliases.placeholder="Accepted Excel headers, comma-separated";
    actions.className="field-row-actions";
    up.type=down.type=remove.type="button";
    up.className=down.className="secondary-button icon-tiny";
    remove.className="text-button";
    up.textContent="↑";
    down.textContent="↓";
    remove.textContent="Remove";
    up.title="Move up";
    down.title="Move down";
    up.disabled=index===0;
    down.disabled=index===settings.inputFields.length-1;
    up.onclick=()=>moveInputField(index,-1);
    down.onclick=()=>moveInputField(index,1);
    remove.disabled=field.required;
    remove.onclick=()=>{
      if(field.required)return;
      settings=collectSettings();
      syncCustomOutputField(field,{remove:true});
      settings.inputFields=normalizeInputFields(settings.inputFields.filter(item=>item.id!==field.id),false);
      renderInputFields();
      renderOutputFields();
      renderSortFields();
    };
    actions.append(up,down,remove);
    row.append(toggle,label,aliases,actions);
    els["input-field-config"].append(row);
  }
}
function renderAiFields(){
  els["ai-field-config"].replaceChildren();
  for(const field of settings.aiFields){
    const row=configRow("config-row ai-row"),send=input("checkbox","",`Send ${field.label} to AI`),name=document.createElement("span"),history=input("checkbox","",`Send all ${field.label} history to AI`),historyLabel=document.createElement("label");
    send.checked=field.enabled!==false;
    send.dataset.aiId=field.id;
    name.textContent=field.label;
    history.checked=Boolean(field.history);
    history.dataset.historyId=field.id;
    historyLabel.className="history-toggle";
    historyLabel.append(history,document.createTextNode("All history"));
    row.append(send,name,historyLabel);
    els["ai-field-config"].append(row);
  }
}
function ruleOptions(current){
  const options=[
    "Lead Status + Comments",
    ...settings.aiFields.map(field=>field.label),
    "Comment quality",
    "Buying intent",
    "AI Observation",
    "AI Recommendation"
  ];
  if(current&&!options.includes(current))options.push(current);
  return [...new Set(options)];
}
function renderRules(){
  els["rule-config"].replaceChildren();
  for(let index=0;index<settings.rules.length;index++){
    const rule=settings.rules[index],row=configRow("rule-row"),field=document.createElement("select"),instruction=document.createElement("textarea"),errors=input("text",rule.errors,"Possible error types"),remove=document.createElement("button");
    field.dataset.ruleField=index;
    instruction.dataset.ruleInstruction=index;
    errors.dataset.ruleErrors=index;
    for(const label of ruleOptions(rule.field)){
      const option=document.createElement("option");
      option.value=label;
      option.textContent=label;
      option.selected=label===rule.field;
      field.append(option);
    }
    instruction.value=rule.instruction||"";
    instruction.rows=3;
    instruction.placeholder="What should the AI validate?";
    errors.placeholder="Error types separated by |";
    remove.type="button";
    remove.className="text-button";
    remove.textContent="Remove";
    remove.onclick=()=>{settings=collectSettings();settings.rules.splice(index,1);renderRules();};
    row.append(field,instruction,errors,remove);
    els["rule-config"].append(row);
  }
}
function renderOutputFields(){
  els["output-field-config"].replaceChildren();
  for(const field of settings.outputFields){
    const row=configRow("config-row output-row"),toggle=input("checkbox","",`Include ${field.label} in download`),name=document.createElement("span");
    toggle.checked=field.enabled!==false;
    toggle.dataset.outputId=field.id;
    name.textContent=field.label;
    row.append(toggle,name);
    els["output-field-config"].append(row);
  }
}
function renderSortFields(){
  const select=els["sort-field"];
  if(!select)return;
  const current=settings.sort?.field||"project";
  select.replaceChildren();
  for(const field of settings.outputFields){
    const option=document.createElement("option");
    option.value=field.id;
    option.textContent=field.label;
    option.selected=field.id===current;
    select.append(option);
  }
  els["sort-direction"].value=settings.sort?.direction==="desc"?"desc":"asc";
}
function renderSettings(){
  settings=normalizeSettings(settings);
  els["batch-size"].value=settings.batchSize;
  els.concurrency.value=settings.concurrency;
  els.model.value=settings.model;
  if(els["review-model"])els["review-model"].value=settings.reviewModel||"gpt-5-nano";
  els["yes-values"].value=settings.yesValues;
  els["no-values"].value=settings.noValues;
  els["additional-instructions"].value=settings.additionalInstructions;
  els["input-price"].value=settings.pricing.input;
  els["cached-price"].value=settings.pricing.cached;
  els["output-price"].value=settings.pricing.output;
  if(els["review-input-price"])els["review-input-price"].value=settings.reviewPricing?.input??0;
  if(els["review-cached-price"])els["review-cached-price"].value=settings.reviewPricing?.cached??0;
  if(els["review-output-price"])els["review-output-price"].value=settings.reviewPricing?.output??0;
  els["api-key"].value=getApiKey();
  els["remember-key"].checked=apiKeyIsRemembered();
  if(els["app-version"])els["app-version"].textContent=APP_VERSION;
  renderInputFields();
  renderAiFields();
  renderRules();
  renderOutputFields();
  renderSortFields();
  updateKeyState();
}
function collectSettings(){
  const next=normalizeSettings(settings);
  next.batchSize=Number(els["batch-size"].value);
  next.concurrency=Number(els.concurrency.value);
  next.model=els.model.value.trim();
  if(els["review-model"])next.reviewModel=els["review-model"].value.trim();
  next.yesValues=els["yes-values"].value.trim();
  next.noValues=els["no-values"].value.trim();
  next.additionalInstructions=els["additional-instructions"].value.trim();
  next.pricing={input:number(els["input-price"].value),cached:number(els["cached-price"].value),output:number(els["output-price"].value)};
  next.reviewPricing={
    input:number(els["review-input-price"]?.value),
    cached:number(els["review-cached-price"]?.value),
    output:number(els["review-output-price"]?.value)
  };
  next.sort={field:els["sort-field"]?.value||"callDate",direction:els["sort-direction"]?.value==="desc"?"desc":"asc"};
  next.inputFields=normalizeInputFields([...document.querySelectorAll("[data-input-row]")].map(row=>{
    const id=row.dataset.inputRow;
    const label=document.querySelector(`[data-input-label="${id}"]`)?.value.trim()||id;
    return{
      id,
      label,
      aliases:document.querySelector(`[data-alias-id="${id}"]`)?.value.trim()||label,
      required:row.dataset.required==="1",
      enabled:row.dataset.required==="1"||Boolean(document.querySelector(`[data-input-enabled="${id}"]`)?.checked)
    };
  }),false);
  next.aiFields=next.aiFields.map(field=>({...field,enabled:Boolean(document.querySelector(`[data-ai-id="${field.id}"]`)?.checked),history:Boolean(document.querySelector(`[data-history-id="${field.id}"]`)?.checked)}));
  next.outputFields=next.outputFields.map(field=>({...field,enabled:Boolean(document.querySelector(`[data-output-id="${field.id}"]`)?.checked)}));
  for(const field of next.inputFields){
    if(SYSTEM_OUTPUT_IDS.has(field.id)||field.id==="update")continue;
    const output=next.outputFields.find(item=>item.id===field.id);
    if(output)output.label=field.label;
    else next.outputFields.push({id:field.id,label:field.label,enabled:true});
  }  next.rules=[...document.querySelectorAll("[data-rule-field]")].map(field=>{
    const index=field.dataset.ruleField;
    return{field:field.value,instruction:document.querySelector(`[data-rule-instruction="${index}"]`)?.value.trim()||"",errors:document.querySelector(`[data-rule-errors="${index}"]`)?.value.trim()||""};
  });
  return normalizeSettings(next);
}

function exportSettings(){
  const payload={
    format:"leadlens-settings",
    version:APP_VERSION,
    exportedAt:timestamp(),
    settings:collectSettings()
  };
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const link=document.createElement("a");
  link.href=url;
  link.download=`leadlens-settings-${APP_VERSION}.json`;
  link.click();
  URL.revokeObjectURL(url);
  els["settings-message"].textContent="Settings exported (API key is not included).";
}

async function importSettingsFile(file){
  if(!file)return;
  try{
    const parsed=JSON.parse(await file.text());
    const incoming=parsed.settings||parsed;
    settings=normalizeSettings(incoming);
    saveSettings(settings);
    renderSettings();
    els["settings-message"].textContent=`Settings imported from JSON${parsed.version?` (file v${parsed.version})`:""}.`;
    toast("Settings imported.");
  }catch(error){
    els["settings-message"].textContent=`Import failed: ${error.message}`;
  }finally{
    els["import-settings-file"].value="";
  }
}

async function restoreFromStorage(){
  const jobs=await getJobs();
  let changed=false;
  for(const job of jobs){
    if(job.status==="running"||job.status==="reviewing"){
      stopClock(job);
      job.status="paused";
      job.updatedAt=timestamp();
      addLog(job,"Browser reloaded during this run. Progress was restored from local storage — resume to continue.","warn");
      await putJob(job);
      changed=true;
    }
  }
  const refreshed=changed?await getJobs():jobs;
  const preferredId=getActiveJobId();
  const preferred=refreshed.find(job=>job.id===preferredId)||refreshed.find(job=>["paused","failed","queued"].includes(job.status))||refreshed.find(job=>job.status==="completed")||refreshed[0];
  if(preferred){
    renderProgress(preferred);
    if(["paused","failed"].includes(preferred.status))toast("Restored saved audit progress. Resume when ready.");
  }
  if(reviewSessionIds.length){
    els["review-run-panel"]?.classList.remove("hidden");
    scheduleReviewProgress();
  }
}

function showUpdateBanner(latest){
  if(!els["update-banner"])return;
  els["update-banner"].classList.remove("hidden");
  const box=els["update-banner-text"];
  box.replaceChildren();
  const appendKbd=label=>{const k=document.createElement("kbd");k.textContent=label;box.append(k);};
  box.append("LeadLens ");
  const vNew=document.createElement("strong");vNew.textContent=`v${latest}`;box.append(vNew);
  box.append(" is available (you are on ");
  const vCur=document.createElement("strong");vCur.textContent=`v${APP_VERSION}`;box.append(vCur);
  box.append("). Hard-reload to update: Windows/Linux ");
  appendKbd("Ctrl");box.append("+");appendKbd("Shift");box.append("+");appendKbd("R");
  box.append(" · Mac ");
  appendKbd("Cmd");box.append("+");appendKbd("Shift");box.append("+");appendKbd("R");
  box.append(". Or use the button.");
}
function renderSidebarRelease(version=APP_VERSION,notes=""){
  if(els["sidebar-version"])els["sidebar-version"].textContent=`v${version}`;
  if(els["sidebar-notes"]&&notes)els["sidebar-notes"].textContent=notes;
}
/** True when candidate is a higher semver than current (major.minor.patch). */
function isNewerVersion(candidate,current){
  const parse=v=>{
    const m=String(v||"").trim().match(/^(\d+)\.(\d+)\.(\d+)/);
    return m?[Number(m[1]),Number(m[2]),Number(m[3])]:null;
  };
  const a=parse(candidate),b=parse(current);
  if(!a||!b)return false;
  for(let i=0;i<3;i++){
    if(a[i]>b[i])return true;
    if(a[i]<b[i])return false;
  }
  return false;
}
async function checkForUpdate(){
  if(els["app-version"])els["app-version"].textContent=APP_VERSION;
  renderSidebarRelease(APP_VERSION);
  try{
    const response=await fetch(`./version.json?t=${Date.now()}`,{cache:"no-store"});
    if(!response.ok)return;
    const data=await response.json();
    const latest=String(data.version||"").trim();
    const notes=String(data.notes||"").trim();
    const newer=isNewerVersion(latest,APP_VERSION);
    const same=latest===APP_VERSION;
    // Sidebar always reflects the running build. Only adopt remote notes when remote >= current.
    if(newer||same)renderSidebarRelease(APP_VERSION,notes);
    else renderSidebarRelease(APP_VERSION);
    if(newer)showUpdateBanner(latest);
    else if(els["update-banner"])els["update-banner"].classList.add("hidden");
  }catch{/* offline or first local open */}
}

document.querySelectorAll(".nav-item").forEach(button=>button.addEventListener("click",()=>showView(button.dataset.view)));
document.getElementById("settings-form")?.addEventListener("submit",event=>event.preventDefault());
els["mobile-menu"].onclick=()=>document.querySelector(".shell").classList.toggle("menu-open");
els["drop-zone"].onclick=()=>els["file-input"].click();
els["drop-zone"].onkeydown=event=>{if(["Enter"," "].includes(event.key))els["file-input"].click();};
els["file-input"].onchange=event=>handleFiles(event.target.files);
for(const event of ["dragenter","dragover"])els["drop-zone"].addEventListener(event,e=>{e.preventDefault();els["drop-zone"].classList.add("dragover");});
for(const event of ["dragleave","drop"])els["drop-zone"].addEventListener(event,e=>{e.preventDefault();els["drop-zone"].classList.remove("dragover");});
els["drop-zone"].addEventListener("drop",event=>handleFiles(event.dataTransfer.files));
els["start-audit"].onclick=startNew;
els["pause-run"].onclick=async()=>{
  if(!currentJob)return;
  if(currentJob.status==="running"||currentJob.status==="reviewing")controllers.get(currentJob.id)?.abort();
  else await runJob(await getJob(currentJob.id),{navigate:currentJob.mode!=="telecaller-review"&&currentJob.mode!=="telecaller-review-parent"});
};
els["download-result"].onclick=()=>currentJob&&download(currentJob);
els["clear-console"].onclick=()=>{displayLogs=false;renderLogs(currentJob);};

document.querySelectorAll("[data-review-format]").forEach(button=>{
  button.addEventListener("click",()=>setReviewFormat(button.dataset.reviewFormat));
});
if(els["review-drop-zone"]){
  els["review-drop-zone"].onclick=()=>els["review-file-input"].click();
  els["review-drop-zone"].onkeydown=event=>{if(["Enter"," "].includes(event.key))els["review-file-input"].click();};
  for(const event of ["dragenter","dragover"])els["review-drop-zone"].addEventListener(event,e=>{e.preventDefault();els["review-drop-zone"].classList.add("dragover");});
  for(const event of ["dragleave","drop"])els["review-drop-zone"].addEventListener(event,e=>{e.preventDefault();els["review-drop-zone"].classList.remove("dragover");});
  els["review-drop-zone"].addEventListener("drop",event=>handleReviewFiles(event.dataTransfer.files,{append:reviewFormat==="separate"&&reviewQueueRunning}));
}
if(els["review-file-input"])els["review-file-input"].onchange=event=>handleReviewFiles(event.target.files,{append:reviewFormat==="separate"&&reviewQueueRunning});
if(els["start-review"])els["start-review"].onclick=startReview;
if(els["download-review-pdf"])els["download-review-pdf"].onclick=()=>downloadReviewArtifact("pdf");
if(els["download-review-excel"])els["download-review-excel"].onclick=()=>downloadReviewArtifact("excel");
if(els["review-open-console"])els["review-open-console"].onclick=()=>{
  if(currentJob){displayLogs=true;renderProgress(currentJob);}
  showView("console");
};

els["clear-history"].onclick=async()=>{
  if(controllers.size){toast("Pause all running audits before clearing history.");return;}
  if(confirm("Delete all locally stored audits, checkpoints, token history and logs?")){
    await clearJobs();
    currentJob=null;
    setActiveJobId("");
    renderHistory();
    toast("Local history cleared.");
  }
};
els["toggle-key"].onclick=()=>{const hidden=els["api-key"].type==="password";els["api-key"].type=hidden?"text":"password";els["toggle-key"].textContent=hidden?"Hide":"Show";};
els["save-key"].onclick=()=>validateAndSaveKey(els["api-key"].value,els["remember-key"].checked,els["key-message"],els["save-key"]);
els["forget-key"].onclick=()=>{forgetApiKey();els["api-key"].value="";els["remember-key"].checked=false;els["key-message"].textContent="Key removed.";updateKeyState();};
els["onboard-toggle"]?.addEventListener("click",()=>{const hidden=els["onboard-key"].type==="password";els["onboard-key"].type=hidden?"text":"password";els["onboard-toggle"].textContent=hidden?"Hide":"Show";});
els["onboard-save"]?.addEventListener("click",async()=>{
  const saved=await validateAndSaveKey(els["onboard-key"].value,els["onboard-remember"].checked,els["onboard-message"],els["onboard-save"]);
  if(saved){closeKeyModal();toast("OpenAI key saved.");}
});
els["onboard-key"]?.addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();els["onboard-save"].click();}});
els["onboard-skip"]?.addEventListener("click",()=>{closeKeyModal();toast("You can add your API key any time in Settings.");});
els["add-rule"].onclick=()=>{settings=collectSettings();settings.rules.push({field:"Comments",instruction:"",errors:""});renderRules();};
els["add-input-field"].onclick=()=>{
  settings=collectSettings();
  const used=new Set(settings.inputFields.map(field=>field.id));
  const label=`Custom field ${settings.inputFields.length+1}`;
  const field={id:slugFieldId(label,used),label,aliases:label,required:false,enabled:true};
  settings.inputFields=normalizeInputFields([...settings.inputFields,field],false);
  syncCustomOutputField(field);
  renderInputFields();
  renderOutputFields();
  renderSortFields();
};
els["save-settings"].onclick=()=>{
  // Validate the raw inputs first — collectSettings() clamps to the limits, which
  // would otherwise hide out-of-range values from the checks below.
  const rawBatch=Number(els["batch-size"].value);
  const rawConcurrency=Number(els.concurrency.value);
  if(!Number.isInteger(rawBatch)||rawBatch<1||rawBatch>MAX_BATCH_SIZE){els["settings-message"].textContent=`Batch size must be 1–${MAX_BATCH_SIZE}.`;return;}
  if(!Number.isInteger(rawConcurrency)||rawConcurrency<1||rawConcurrency>MAX_CONCURRENCY){els["settings-message"].textContent=`Parallel batches must be 1–${MAX_CONCURRENCY}.`;return;}
  const next=collectSettings();
  if(!next.model){els["settings-message"].textContent="Enter a model name.";return;}
  if(!next.reviewModel){els["settings-message"].textContent="Enter a review model name.";return;}
  if(!next.outputFields.some(field=>field.enabled)){els["settings-message"].textContent="Select at least one output Excel field.";return;}
  settings=next;
  saveSettings(settings);
  els["settings-message"].textContent="Settings saved. Downloads always use the Sort By / Order shown here.";
  renderSettings();
};
els["reset-settings"].onclick=()=>{settings=normalizeSettings(DEFAULT_SETTINGS);saveSettings(settings);renderSettings();els["settings-message"].textContent="Defaults restored.";};
els["export-settings"].onclick=exportSettings;
els["import-settings"].onclick=()=>els["import-settings-file"].click();
els["import-settings-file"].onchange=event=>importSettingsFile(event.target.files?.[0]);
function persistSortFromForm(){
  settings=collectSettings();
  saveSettings(settings);
  els["settings-message"].textContent=`Sort set to ${els["sort-field"].selectedOptions[0]?.textContent||settings.sort.field} · ${settings.sort.direction==="desc"?"descending":"ascending"}. Re-download the Excel to apply.`;
}
els["sort-field"].onchange=persistSortFromForm;
els["sort-direction"].onchange=persistSortFromForm;
els["reload-app"]?.addEventListener("click",async()=>{
  try{
    if("serviceWorker" in navigator){
      const regs=await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(reg=>reg.unregister()));
    }
    if(window.caches){
      const keys=await caches.keys();
      await Promise.all(keys.filter(key=>key.startsWith("leadlens-")).map(key=>caches.delete(key)));
    }
  }catch{/* continue to forced navigation */}
  // Bust HTML + module cache; plain reload often reuses stale app.js/audit.js.
  const url=new URL(location.href);
  url.searchParams.set("v",APP_VERSION);
  url.searchParams.set("_",String(Date.now()));
  location.replace(url.toString());
});

window.addEventListener("beforeunload",event=>{
  if(!controllers.size)return;
  event.preventDefault();
  event.returnValue="";
});

renderSettings();
renderHistory();
loadReviewSessionIds();
setReviewFormat("combined");
restoreFromStorage();
checkForUpdate();
maybePromptForApiKey();
setInterval(()=>{
  if(currentJob?.status==="running"||currentJob?.status==="reviewing")renderProgress(currentJob);
  if(reviewSessionIds.length)scheduleReviewProgress();
},1000);
setInterval(checkForUpdate,5*60*1000);
// Do not re-register a service worker — it only caused sticky "update" banners.
if("serviceWorker" in navigator){
  navigator.serviceWorker.getRegistrations().then(regs=>Promise.all(regs.map(reg=>reg.unregister()))).catch(()=>{});
}

import {APP_VERSION,DEFAULT_SETTINGS,DEFAULT_OUTPUT_FIELDS,SETTINGS_SEED,MAX_BATCH_SIZE,MAX_CONCURRENCY,normalizeSettings,normalizeInputFields,slugFieldId,parseWorkbook,parseAuditedWorkbook,auditBatch,downloadWorkbook,downloadReviewPack,splitLeadsByTelecaller,splitResultsByTelecaller,validateApiKey,HIGH_SEVERITY_ERRORS} from "./audit.js?v=3.6.0";
import {putJob,getJob,getJobs,deleteJob,clearJobs,loadSettings,saveSettings,getApiKey,apiKeyIsRemembered,saveApiKey,forgetApiKey} from "./db.js?v=3.6.0";
import {renderReviewDashboard,destroyReviewDashboard} from "./dashboard-view.js?v=3.6.0";

const $=id=>document.getElementById(id);
const ids=["file-input","drop-zone","file-list","validation","start-audit","page-title","key-state","run-name","pause-run","download-result","progress-label","progress-percent","progress-bar","metric-leads","metric-excel-rows","metric-calls","metric-batch","metric-completed","metric-status","metric-input-tokens","metric-cached-tokens","metric-output-tokens","metric-duration","metric-cost","live-log","clear-console","history-list","clear-history","api-key","remember-key","toggle-key","save-key","forget-key","key-message","batch-size","concurrency","model","input-field-config","add-input-field","ai-field-config","rule-config","add-rule","output-field-config","yes-values","no-values","additional-instructions","input-price","cached-price","output-price","save-settings","reset-settings","settings-message","toast","mobile-menu","active-job-switch","sort-field","sort-direction","app-version","export-settings","import-settings","import-settings-file","update-banner","update-banner-text","reload-app","key-modal","onboard-key","onboard-toggle","onboard-remember","onboard-message","onboard-save","onboard-skip","sidebar-version","sidebar-notes","review-drop-zone","review-file-input","review-drop-hint","review-file-list","review-validation","start-review","review-run-panel","review-aggregate","review-cards","review-dashboard-panel","review-dashboard-mount","download-review-excel","review-open-console","audit-run-panel","audit-aggregate","audit-cards","audit-download-panel","download-audit-excel","audit-open-console"];
const els=Object.fromEntries(ids.map(id=>[id,$(id)]));
const titles={new:"New audit",review:"TelleCaller Review",console:"Run console",history:"History",settings:"Settings"};
const ENGINE_VERSION="latest-day-v7";
const ACTIVE_JOB_KEY="leadlens.activeJobId";
const REVIEW_SESSION_KEY="leadlens.reviewSessionIds";
const AUDIT_SESSION_KEY="leadlens.auditSessionIds";
/** Max TeleCaller review jobs running at once (outer pool). Inner batch pool stays settings.concurrency per job. */
const REVIEW_JOB_CONCURRENCY=10;

let parsedFiles=[],currentJob=null,displayLogs=true;
let reviewFormat="raw";
let reviewParsedFiles=[];
let reviewSessionIds=[];
let auditSessionIds=[];
let reviewQueue=[];
let reviewQueueRunning=false;
let reviewActiveCount=0;
let auditSessionRunning=false;
/** Fingerprint of ready review jobs last painted into the in-app dashboard. */
let lastReviewDashboardKey="";
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
const saveAuditSessionIds=()=>sessionStorage.setItem(AUDIT_SESSION_KEY,JSON.stringify(auditSessionIds));
const loadAuditSessionIds=()=>{
  try{const parsed=JSON.parse(sessionStorage.getItem(AUDIT_SESSION_KEY)||"[]");auditSessionIds=Array.isArray(parsed)?parsed.filter(Boolean):[];}
  catch{auditSessionIds=[];}
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
  if(name==="new")renderAuditProgress();
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
    ?(job.mode==="telecaller-review"?"TeleCaller report ready":job.mode==="telecaller-review-parent"?(job.sourceFormat==="audit"?"Excel Audit complete — dashboard ready":"Excel RAW audit complete — dashboard ready"):"Audit complete")
    :job.status==="reviewing"
    ?"Building TeleCaller report…"
    :job.status==="running"
    ?`Keeping ${concurrency} batch request${concurrency>1?"s":""} in flight${pendingLeft?` · ${pendingLeft} batch(es) waiting to checkpoint`:""}…`
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
  els["metric-cost"].textContent=estimatedCost(job).toFixed(4);
  els["pause-run"].disabled=!(["running","reviewing","paused","failed"].includes(job.status));
  els["pause-run"].textContent=job.status==="running"||job.status==="reviewing"?"Pause":"Resume";
  els["download-result"].disabled=job.status!=="completed";
  els["download-result"].textContent=(job.mode==="telecaller-review"||job.mode==="telecaller-review-parent")
    ?"Download audit Excel"
    :"Download Excel";
  renderLogs(job);
  refreshJobSwitcher();
  if(job.mode==="telecaller-review"||job.mode==="telecaller-review-parent")scheduleReviewProgress();
  else if(auditSessionIds.includes(job.id))scheduleAuditProgress();
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
    const kind=job.mode==="telecaller-review-parent"?(job.sourceFormat==="audit"?"Excel Audit":"Excel RAW"):job.mode==="telecaller-review"?"TeleCaller report":"Audit";
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
  else if(job&&auditSessionIds.includes(job.id))scheduleAuditProgress();
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

async function runJob(job,{navigate=false}={}){
  if(controllers.has(job.id)){toast("That audit is already running.");return;}
  const key=getApiKey();
  if(!key){showView("settings");toast("Add an OpenAI API key first.");return;}
  if(!/^sk-[A-Za-z0-9_-]{20,}$/.test(key)){showView("settings");toast("That does not look like an OpenAI API key.");return;}

  const isReview=job.mode==="telecaller-review";
  const isParent=job.mode==="telecaller-review-parent";
  const reviewOnly=Boolean(job.reviewOnly);
  const shouldNavigate=navigate&&!isReview&&!isParent;
  const isNewAuditSession=auditSessionIds.includes(job.id);
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
    addLog(job,`TeleCaller report: ${job.telecallerName||job.fileName} · ${job.results.length} audited rows · in-app dashboard from audit metrics · app ${APP_VERSION}.`);
  }else{
    addLog(job,`Run started: live pool of ${concurrency} (next batch fires the instant one frees a slot), batch size ${job.settings.batchSize} leads, model ${job.settings.model}, app ${APP_VERSION}. Checkpoints stay in order — later batches may finish API first and wait.`);
  }
  await putJob(job);
  // Reviews: only paint Run Console when this job is already selected (parallel workers must not steal).
  // Audits/parents: allow switch when no active controller on the current console job.
  if(currentJob?.id===job.id||((!isReview||isParent)&&(!currentJob||!controllers.has(currentJob.id))))renderProgress(job);
  if(shouldNavigate)showView("console");
  if(isReview||isParent)scheduleReviewProgress();
  if(isNewAuditSession)scheduleAuditProgress();

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
      job.reviewStatus="skipped";
      addLog(job,"Audit complete — TeleCaller dashboard will use audit metrics.","success");
    }

    if(isParent){
      addLog(job,"Excel RAW audit complete — splitting by TeleCaller for in-app dashboard…","success");
      await spawnCombinedReviewChildren(job);
    }

    job.status="completed";
    job.pendingBatches={};
    stopClock(job);
    job.updatedAt=timestamp();
    const billable=Math.max(0,number(job.tokenUsage.input)-number(job.tokenUsage.cached));
    const label=isParent?(job.sourceFormat==="audit"?"Excel Audit":"Excel RAW"):isReview?"TeleCaller report":"Audit";
    addLog(job,`${label} complete in ${durationText(job.elapsedMs)}. Cost est. ${estimatedCost(job).toFixed(4)}. Cached ${number(job.tokenUsage.cached).toLocaleString()} · billable input ${billable.toLocaleString()} · output ${number(job.tokenUsage.output).toLocaleString()}.`,"success");
    await putJob(job);
    if(currentJob?.id===job.id)renderProgress(job);
    if(isReview||isParent)scheduleReviewProgress();
    if(isNewAuditSession)scheduleAuditProgress();
    toast(`${job.fileName}: ${isParent||isReview?"report":"audit"} complete.`);
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
      if(isReview)job.reviewStatus="failed";
      addLog(job,`FAILED: ${job.error}`,"error");
      if(job.telecallerName)addLog(job,`TeleCaller “${job.telecallerName}” did not finish. Open this run in the job switcher for the full log.`,"error");
    }
    job.updatedAt=timestamp();
    await putJob(job);
    if(currentJob?.id===job.id)renderProgress(job);
    if(isReview||isParent)scheduleReviewProgress();
    if(isNewAuditSession)scheduleAuditProgress();
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
  const summary=document.createElement("div");
  const prefix=parsedFiles.length>1?`${parsedFiles.length} files · `:"";
  summary.textContent=`${prefix}${leads.toLocaleString()} leads · ${calls.toLocaleString()} calls · ${latest.toLocaleString()} audited`;
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
  const key=getApiKey();
  if(!key){showView("settings");toast("Add an OpenAI API key first.");return;}
  const jobs=[];
  auditSessionIds=[];
  for(const file of parsedFiles){
    const job={
      id:crypto.randomUUID(),
      engineVersion:ENGINE_VERSION,
      appVersion:APP_VERSION,
      mode:"audit",
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
    liveJobs.set(job.id,job);
    jobs.push(job);
    auditSessionIds.push(job.id);
  }
  saveAuditSessionIds();
  parsedFiles=[];
  renderFileList();
  updateValidationSummary();
  els["file-input"].value="";
  currentJob=jobs[0];
  setActiveJobId(jobs[0].id);
  renderProgress(jobs[0]);
  els["audit-run-panel"]?.classList.remove("hidden");
  auditSessionRunning=true;
  scheduleAuditProgress();
  // Stay on New audit — do not auto-open Run console.
  // Run files one after another so concurrency stays within the per-job limit.
  try{
    for(const job of jobs)await runJob(job,{navigate:false});
  }finally{
    auditSessionRunning=false;
    scheduleAuditProgress();
  }
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
    telecallerName:"Excel RAW",
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
 * After Combined parent audit: split results by telecaller into completed report jobs (in-app dashboard from audit metrics — no AI review queue).
 */
async function spawnCombinedReviewChildren(parentJob){
  if(Array.isArray(parentJob.childReviewIds)&&parentJob.childReviewIds.length){
    addLog(parentJob,`TeleCaller report splits already exist (${parentJob.childReviewIds.length}) — refreshing.`);
    for(const id of parentJob.childReviewIds){
      const child=liveJobs.get(id)||await getJob(id);
      if(child?.results?.length){
        child.status="completed";
        child.reviewStatus="skipped";
        child.finishedAt=child.finishedAt||timestamp();
        child.updatedAt=timestamp();
        await putJob(child);
        liveJobs.set(child.id,child);
        if(!reviewSessionIds.includes(child.id))reviewSessionIds.push(child.id);
      }
    }
    saveReviewSessionIds();
    scheduleReviewProgress();
    return;
  }
  const splits=splitResultsByTelecaller(parentJob.results||[]);
  if(!splits.length)throw new Error("No TeleCaller groups found for the dashboard.");
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
    child.status="completed";
    child.reviewStatus="skipped";
    child.finishedAt=timestamp();
    child.updatedAt=timestamp();
    await putJob(child);
    liveJobs.set(child.id,child);
    children.push(child);
    if(!reviewSessionIds.includes(child.id))reviewSessionIds.push(child.id);
  }
  parentJob.childReviewIds=children.map(child=>child.id);
  parentJob.updatedAt=timestamp();
  await putJob(parentJob);
  saveReviewSessionIds();
  addLog(parentJob,`Split into ${children.length} TeleCaller dashboard${children.length===1?"":"s"} (audit metrics only — no AI review pass).`,"success");
  scheduleReviewProgress();
  toast(`${children.length} TeleCaller report${children.length===1?"":"s"} ready for the in-app dashboard.`);
}

function setReviewFormat(format){
  reviewFormat=format==="audit"?"audit":"raw";
  document.querySelectorAll("[data-review-format]").forEach(button=>{
    button.classList.toggle("active",button.dataset.reviewFormat===reviewFormat);
  });
  if(els["review-drop-hint"]){
    els["review-drop-hint"].textContent=reviewFormat==="raw"
      ?"CRM / RAW export · auto-detect TeleCallers · audit whole file · then in-app dashboard · XLSX, XLS or XLSM"
      :"Already-audited LeadLens Excel · skip AI · split by TeleCaller · in-app dashboard · XLSX, XLS or XLSM";
  }
  if(els["review-file-input"])els["review-file-input"].multiple=false;
  // Switching formats clears the other mode's staged file.
  reviewParsedFiles=[];
  renderReviewFileList();
  updateReviewValidation();
}

function scheduleReviewProgress(){
  if(scheduleReviewProgress._timer)return;
  scheduleReviewProgress._timer=setTimeout(()=>{
    scheduleReviewProgress._timer=null;
    renderReviewProgress();
  },150);
}

function scheduleAuditProgress(){
  if(scheduleAuditProgress._timer)return;
  scheduleAuditProgress._timer=setTimeout(()=>{
    scheduleAuditProgress._timer=null;
    renderAuditProgress();
  },150);
}

async function getAuditSessionJobs(){
  if(!auditSessionIds.length)loadAuditSessionIds();
  const jobs=[];
  for(const id of auditSessionIds){
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

async function renderAuditProgress(){
  const panel=els["audit-run-panel"];
  const cards=els["audit-cards"];
  const aggregate=els["audit-aggregate"];
  const downloads=els["audit-download-panel"];
  if(!panel||!cards)return;
  const jobs=await getAuditSessionJobs();
  if(!jobs.length){
    if(!auditSessionRunning)panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");
  cards.replaceChildren();
  let totalLeads=0,totalCalls=0,totalDone=0,totalTarget=0,totalCost=0,completed=0,failed=0;
  for(const job of jobs){
    totalLeads+=uniqueLeadCount(job)||0;
    totalCalls+=Number(job.callCount)||0;
    totalDone+=auditedDoneCount(job);
    totalTarget+=job.totalLeads||0;
    totalCost+=estimatedCost(job);
    if(job.status==="completed")completed++;
    if(job.status==="failed")failed++;
  }
  const sessionDone=jobs.every(job=>["completed","failed"].includes(job.status))&&!auditSessionRunning;
  const wallMs=sessionWallMs(jobs);

  for(const job of jobs){
    const done=auditedDoneCount(job);
    const target=job.totalLeads||0;
    const pct=target?Math.round(Math.min(done,target)/target*100):job.status==="completed"?100:0;
    const jobElapsed=elapsed(job);
    const card=document.createElement("article");
    card.className=`review-card${job.status==="failed"?" is-failed":""}`;
    card.tabIndex=0;
    card.setAttribute("role","button");
    card.title="Open Run console logs for this file";
    const openConsole=()=>{displayLogs=true;renderProgress(job);showView("console");};
    card.onclick=openConsole;
    card.onkeydown=event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();openConsole();}};
    const head=document.createElement("div");
    head.className="review-card-head";
    const title=document.createElement("strong");
    title.textContent=job.fileName||"Audit";
    const status=document.createElement("span");
    status.className=`status ${job.status}`;
    status.textContent=job.status;
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
    for(const [label,value] of [
      ["Leads",String(uniqueLeadCount(job)||"—")],
      ["Calls",job.callCount!=null?Number(job.callCount).toLocaleString():"—"],
      ["Audited",target?`${done} / ${target}`:"—"],
      [timeLabel,timeValue],
      ["Cost",estimatedCost(job).toFixed(4)]
    ]){
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
      retry.textContent="Retry";
      retry.onclick=async event=>{
        event.stopPropagation();
        if(controllers.has(job.id)){toast("That audit is already running.");return;}
        auditSessionRunning=true;
        try{await runJob(job,{navigate:false});}
        finally{auditSessionRunning=false;scheduleAuditProgress();}
      };
      const view=document.createElement("button");
      view.type="button";
      view.className="text-button";
      view.textContent="View logs";
      view.onclick=event=>{event.stopPropagation();openConsole();};
      retryRow.append(retry,view);
      card.append(retryRow);
    }
    if(job.status==="completed"&&job.results?.length){
      const actions=document.createElement("div");
      actions.className="review-card-actions";
      const dl=document.createElement("button");
      dl.type="button";
      dl.className="primary-button";
      dl.textContent="Download Excel";
      dl.onclick=event=>{event.stopPropagation();download(job);};
      actions.append(dl);
      card.append(actions);
    }
    cards.append(card);
  }

  if(aggregate){
    aggregate.classList.remove("hidden");
    aggregate.replaceChildren();
    for(const [label,value] of [
      ["Files",`${completed} / ${jobs.length}${failed?` · ${failed} failed`:""}`],
      ["Leads",totalLeads.toLocaleString()],
      ["Audited",totalTarget?`${totalDone} / ${totalTarget}`:"—"],
      [sessionDone?"Total Time Taken":"Elapsed",wallMs?durationText(wallMs):"—"],
      ["Cost",totalCost.toFixed(4)]
    ]){
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
    const ready=jobs.filter(job=>job.status==="completed"&&job.results?.length);
    if(ready.length){
      downloads.classList.remove("hidden");
      if(els["download-audit-excel"])els["download-audit-excel"].disabled=false;
    }else{
      downloads.classList.add("hidden");
      if(els["download-audit-excel"])els["download-audit-excel"].disabled=true;
    }
  }
}

async function downloadAuditSessionExcel(){
  try{
    const jobs=await getAuditSessionJobs();
    const ready=jobs.filter(job=>job.status==="completed"&&job.results?.length);
    if(!ready.length){toast("No completed audits yet.");return;}
    const live=collectSettings();
    settings=live;
    saveSettings(settings);
    for(const job of ready)download(job);
    toast(ready.length===1?"Audit Excel downloaded.":`${ready.length} audit Excel files downloaded.`);
  }catch(error){toast(error.message);}
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
      const rows=file.results?.length||file.callCount||file.leads?.length||0;
      meta.textContent=`${file.splitPreview.length} TeleCaller${file.splitPreview.length===1?"":"s"} detected · ${(file.leadCount??0).toLocaleString()} leads · ${Number(rows).toLocaleString()} rows`;
    }else if(file.results?.length){
      meta.textContent=`${(file.results.length).toLocaleString()} audited rows · ${(file.leadCount??0).toLocaleString()} leads`;
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
  const file=reviewParsedFiles[0];
  let leads=file.leadCount||0;
  let calls=file.results?.length||file.callCount||file.leads?.length||0;
  let unknownBuckets=0,telecallerMissing=false;
  const splits=file.splitPreview
    ||(file.results?.length?splitResultsByTelecaller(file.results):splitLeadsByTelecaller(file.leads||[]));
  file.splitPreview=splits;
  if(!splits.length)telecallerMissing=true;
  unknownBuckets+=splits.filter(item=>item.unknown).length;
  if((file.missingColumns||[]).some(label=>/telecaller/i.test(label)))telecallerMissing=true;
  const summary=document.createElement("div");
  const multi=splits.length>1;
  const poolNote=reviewFormat==="raw"
    ?(multi
      ?` · ${splits.length} TeleCallers detected · audit whole file, then in-app dashboard`
      :` · single TeleCaller · audit whole file, then in-app dashboard`)
    :(multi
      ?` · ${splits.length} TeleCallers · skip AI · in-app dashboard`
      :` · skip AI · in-app dashboard`);
  summary.textContent=`${leads.toLocaleString()} leads · ${Number(calls).toLocaleString()} rows${poolNote}`;
  box.append(summary);
  if(telecallerMissing)notes.push("Telecaller Name column is required to split reports. Map aliases in Settings if the header differs.");
  if(unknownBuckets)notes.push(`${unknownBuckets} TeleCaller bucket(s) have blank names and will run as Unknown.`);
  if(reviewFormat==="raw"&&file.looksAudited)notes.push("This file looks already audited. Switch to Excel Audit to skip the AI pass, or continue RAW to re-audit.");
  if(reviewFormat==="audit"&&(file.missingColumns||[]).length){
    notes.push(`Optional audit columns missing: ${(file.missingColumns||[]).join(", ")}. Dashboard still builds from whatever scores/errors are present.`);
  }
  const missing=new Set(),unknown=new Set();
  for(const label of file.missingColumns||[]){
    if(reviewFormat==="raw")missing.add(label);
  }
  for(const header of file.unknownHeaders||[])unknown.add(header);
  if(reviewFormat==="raw"&&missing.size)notes.push(`Missing enabled Settings columns: ${[...missing].join(", ")}.`);
  if(unknown.size&&reviewFormat==="raw")notes.push(`Unmapped headers: ${[...unknown].join(", ")}.`);
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

async function handleReviewFiles(fileList){
  const files=[...fileList||[]].filter(file=>/\.(xlsx|xls|xlsm)$/i.test(file.name));
  if(!files.length){toast("Choose an Excel workbook.");return;}
  const box=els["review-validation"];
  box.className="validation";
  box.classList.remove("hidden");
  box.textContent=`Reading ${files[0].name}…`;
  const errors=[];
  let entry=null;
  try{
    const file=files[0];
    if(reviewFormat==="audit"){
      const parsed=parseAuditedWorkbook(await file.arrayBuffer(),settings);
      entry={...parsed,fileName:file.name,fileSize:file.size,sourceFormat:"audit"};
    }else{
      const parsed=parseWorkbook(await file.arrayBuffer(),settings);
      entry={
        ...parsed,
        fileName:file.name,
        fileSize:file.size,
        sourceFormat:"raw",
        splitPreview:splitLeadsByTelecaller(parsed.leads||[])
      };
    }
  }catch(error){
    errors.push(error.message);
  }
  if(!entry){
    box.className="validation error";
    box.textContent=errors.join(" ")||"Could not read workbook.";
    els["start-review"].disabled=true;
    return;
  }
  if(files.length>1)toast("Only the first file is used — Excel RAW / Excel Audit take one workbook at a time.");
  reviewParsedFiles=[entry];
  renderReviewFileList();
  updateReviewValidation();
}

async function startReview(){
  if(!reviewParsedFiles.length)return;
  const file=reviewParsedFiles[0];

  if(reviewFormat==="audit"){
    if(!file.results?.length){toast("No audited rows found in this Excel.");return;}
    const splits=file.splitPreview||splitResultsByTelecaller(file.results);
    if(!splits.length){toast("No TeleCaller groups found.");return;}
    reviewSessionIds=[];
    reviewQueue=[];
    for(const id of [...liveJobs.keys()])liveJobs.delete(id);
    const parent={
      id:crypto.randomUUID(),
      engineVersion:ENGINE_VERSION,
      appVersion:APP_VERSION,
      mode:"telecaller-review-parent",
      sourceFormat:"audit",
      skipAudit:true,
      fileName:file.fileName,
      parentFileName:file.fileName,
      sheetName:file.sheetName||"",
      telecallerName:"Excel Audit",
      createdAt:timestamp(),
      updatedAt:timestamp(),
      status:"running",
      totalLeads:file.results.length,
      leadCount:file.leadCount||0,
      callCount:file.callCount||file.results.length,
      latestDayCalls:file.results.length,
      rowCount:file.rowCount||file.results.length,
      expectedTelecallerCount:splits.length||0,
      nextBatch:0,
      pendingBatches:{},
      leads:[],
      results:file.results,
      logs:[],
      tokenUsage:{input:0,cached:0,output:0},
      reviewTokenUsage:{input:0,cached:0,output:0},
      childReviewIds:[],
      elapsedMs:0,
      startedAt:timestamp(),
      runStartedAt:timestamp(),
      pricing:deepCopy(settings.pricing),
      reviewPricing:deepCopy(settings.reviewPricing),
      settings:deepCopy(settings)
    };
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
    addLog(parent,`Excel Audit: ${file.results.length} audited rows · ${splits.length} TeleCaller group${splits.length===1?"":"s"} · skipping AI · opening in-app dashboard.`,"success");
    try{
      await spawnCombinedReviewChildren(parent);
      parent.status="completed";
      stopClock(parent);
      parent.finishedAt=timestamp();
      parent.updatedAt=timestamp();
      addLog(parent,`Excel Audit complete — ${parent.childReviewIds?.length||0} TeleCaller dashboard(s) ready.`,"success");
      await putJob(parent);
      if(currentJob?.id===parent.id)renderProgress(parent);
      scheduleReviewProgress();
      toast("TeleCaller dashboard ready.");
    }catch(error){
      parent.status="failed";
      parent.error=error.message||String(error);
      stopClock(parent);
      parent.updatedAt=timestamp();
      addLog(parent,`FAILED: ${parent.error}`,"error");
      await putJob(parent);
      if(currentJob?.id===parent.id)renderProgress(parent);
      scheduleReviewProgress();
      toast(parent.error);
    }
    return;
  }

  // Excel RAW — audit entire workbook, then split dashboards
  if(!file.leads?.length){toast("No leads found to audit.");return;}
  const splits=file.splitPreview||splitLeadsByTelecaller(file.leads||[]);
  if(!splits.length){toast("No TeleCaller groups found.");return;}
  const hasTelecallerColumn=!(file.missingColumns||[]).some(label=>/telecaller/i.test(label));
  if(!hasTelecallerColumn&&splits.every(item=>item.unknown)){
    toast("Excel RAW needs a Telecaller Name column to split reports.");
    return;
  }
  const key=getApiKey();
  if(!key){showView("settings");toast("Add an OpenAI API key first (Excel RAW runs an audit).");return;}
  reviewSessionIds=[];
  reviewQueue=[];
  for(const id of [...liveJobs.keys()])liveJobs.delete(id);
  const parent=createCombinedParentJob(file);
  parent.sourceFormat="raw";
  parent.expectedTelecallerCount=splits.length||0;
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
  addLog(parent,`Excel RAW: ${splits.length} TeleCaller${splits.length===1?"":"s"} detected · auditing entire file (${file.leads.length} rows) before dashboard split.`,"success");
  scheduleReviewProgress();
  reviewQueue.push(parent);
  drainReviewQueue();
}

/**
 * Outer worker pool: up to REVIEW_JOB_CONCURRENCY TeleCaller jobs in parallel.
 * Each job keeps its own runJob / AbortController / IndexedDB checkpoints.
 * Pause in Run Console aborts only currentJob (per-job), not the whole queue.
 */
function drainReviewQueue(){
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
  if(!panel||!cards)return;
  const jobs=await getReviewSessionJobs();
  if(!jobs.length){
    if(!reviewQueueRunning)panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");
  // Per-TeleCaller / Excel RAW cards removed — aggregate + download panel only.
  cards.replaceChildren();
  cards.classList.add("hidden");
  const parentJobs=jobs.filter(job=>job.mode==="telecaller-review-parent");
  const reviewJobs=jobs.filter(job=>job.mode==="telecaller-review");
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
      if(job.status==="completed")completed++;
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

  if(aggregate){
    aggregate.classList.remove("hidden");
    aggregate.replaceChildren();
    const teleTotal=reviewJobs.length
      ||parentJobs[0]?.expectedTelecallerCount
      ||parentJobs[0]?.childReviewIds?.length
      ||jobs.length;
    const teleDone=reviewJobs.length
      ?reviewJobs.filter(job=>job.status==="completed").length
      :completed;
    const teleFailed=reviewJobs.filter(job=>job.status==="failed").length;
    const items=[
      ["TeleCallers",`${teleDone} / ${teleTotal}${teleFailed?` · ${teleFailed} failed`:""}`],
      ["Leads",totalLeads.toLocaleString()],
      ["Audited",totalTarget?`${totalDone} / ${totalTarget}`:"—"],
      [sessionDone?"Total Time Taken":"Elapsed",wallMs?durationText(wallMs):"—"],
      ["Cost",totalCost.toFixed(4)]
    ];
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

  const dashboardPanel=els["review-dashboard-panel"];
  if(dashboardPanel){
    const ready=await getReadyReviewDownloadJobs();
    if(ready.length){
      dashboardPanel.classList.remove("hidden");
      if(els["download-review-excel"])els["download-review-excel"].disabled=false;
      const key=ready.map(job=>`${job.id}:${job.results?.length||0}:${job.status}`).join("|");
      if(key!==lastReviewDashboardKey){
        lastReviewDashboardKey=key;
        try{
          renderReviewDashboard(els["review-dashboard-mount"],ready,{highSeverityErrors:HIGH_SEVERITY_ERRORS});
        }catch(error){
          toast(error.message||"Could not render dashboard.");
        }
      }
    }else{
      lastReviewDashboardKey="";
      destroyReviewDashboard();
      if(els["review-dashboard-mount"])els["review-dashboard-mount"].replaceChildren();
      dashboardPanel.classList.add("hidden");
      if(els["download-review-excel"])els["download-review-excel"].disabled=true;
    }
  }
}

/** Resolve completed TeleCaller review jobs for dashboard/audit Excel download (Excel RAW + Excel Audit). */
async function getReadyReviewDownloadJobs(){
  const jobs=await getReviewSessionJobs();
  let ready=jobs.filter(job=>job.mode==="telecaller-review"&&job.status==="completed"&&job.results?.length);
  if(ready.length)return ready;
  // Children may be missing from session ids — recover from parent childReviewIds or parent results.
  const parents=jobs.filter(job=>job.mode==="telecaller-review-parent"&&job.status==="completed");
  for(const parent of parents){
    for(const id of parent.childReviewIds||[]){
      const child=liveJobs.get(id)||await getJob(id);
      if(child?.mode==="telecaller-review"&&child.status==="completed"&&child.results?.length){
        if(!ready.some(row=>row.id===child.id))ready.push(child);
        if(!reviewSessionIds.includes(child.id))reviewSessionIds.push(child.id);
      }
    }
  }
  if(ready.length){
    saveReviewSessionIds();
    return ready;
  }
  for(const parent of parents){
    if(parent.results?.length){
      // Combined parent holds full audited rows — valid dashboard source for "All in one".
      ready.push(parent);
    }
  }
  return ready;
}

async function downloadReviewArtifact(artifact="excel"){
  try{
    const ready=await getReadyReviewDownloadJobs();
    if(!ready.length){toast("No completed reviews yet.");return;}
    const live=collectSettings();
    settings=live;
    saveSettings(settings);
    // Review Mode only offers plain audit Excel; the interactive dashboard is in-app.
    await downloadReviewPack(ready,live,{packing:"combined",artifact:"excel"});
    toast("Audit Excel downloaded.");
  }catch(error){toast(error.message);}
}

async function download(job){
  try{
    const live=collectSettings();
    settings=live;
    saveSettings(settings);
    if(job.mode==="telecaller-review"){
      await downloadReviewPack([job],live,{packing:"separate",artifact:"excel"});
      toast("Audit Excel downloaded.");
      return;
    }
    if(job.mode==="telecaller-review-parent"){
      let list=[];
      for(const id of job.childReviewIds||[]){
        const child=liveJobs.get(id)||await getJob(id);
        if(child?.results?.length)list.push(child);
      }
      if(!list.length&&job.results?.length)list=[job];
      if(!list.length)throw new Error("No TeleCaller audit data ready yet.");
      await downloadReviewPack(list,live,{packing:"combined",artifact:"excel"});
      toast("Audit Excel downloaded.");
      return;
    }
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
      :`${timeText(job.createdAt)} · ${job.mode==="telecaller-review"?`Review · ${job.telecallerName||"TeleCaller"} · `:job.mode==="telecaller-review-parent"?`${job.sourceFormat==="audit"?"Excel Audit":"Excel RAW"} · `:""}${uniqueLeadCount(job)} leads · ${job.callCount??job.rowCount??"—"} calls · ${auditedDoneCount(job)}/${job.totalLeads} audited · ${durationText(job.elapsedMs||0)} · cost ${estimatedCost(job).toFixed(4)} · cached ${number(job.tokenUsage?.cached).toLocaleString()}`;
    info.append(title,document.createTextNode(" "),status,meta);
    actions.className="history-actions";
    const view=document.createElement("button");
    view.className="secondary-button";
    view.textContent="View run";
    view.onclick=()=>{displayLogs=true;renderProgress(job);showView("console");};
    actions.append(view);
    if(job.status==="completed"&&!legacy){
      if(job.mode==="telecaller-review"||job.mode==="telecaller-review-parent"){
        const reviewBtn=document.createElement("button");
        reviewBtn.className="primary-button";
        reviewBtn.textContent="Download audit Excel";
        reviewBtn.onclick=()=>download(job);
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
  els["yes-values"].value=settings.yesValues;
  els["no-values"].value=settings.noValues;
  els["additional-instructions"].value=settings.additionalInstructions;
  els["input-price"].value=settings.pricing.input;
  els["cached-price"].value=settings.pricing.cached;
  els["output-price"].value=settings.pricing.output;
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
  next.yesValues=els["yes-values"].value.trim();
  next.noValues=els["no-values"].value.trim();
  next.additionalInstructions=els["additional-instructions"].value.trim();
  next.pricing={input:number(els["input-price"].value),cached:number(els["cached-price"].value),output:number(els["output-price"].value)};
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
  if(auditSessionIds.length){
    els["audit-run-panel"]?.classList.remove("hidden");
    scheduleAuditProgress();
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
  else await runJob(await getJob(currentJob.id),{navigate:false});
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
  els["review-drop-zone"].addEventListener("drop",event=>handleReviewFiles(event.dataTransfer.files));
}
if(els["review-file-input"])els["review-file-input"].onchange=event=>handleReviewFiles(event.target.files);
if(els["start-review"])els["start-review"].onclick=startReview;
if(els["download-review-excel"])els["download-review-excel"].onclick=()=>downloadReviewArtifact("excel");
if(els["review-open-console"])els["review-open-console"].onclick=()=>{
  if(currentJob){displayLogs=true;renderProgress(currentJob);}
  showView("console");
};
if(els["audit-open-console"])els["audit-open-console"].onclick=()=>{
  if(currentJob){displayLogs=true;renderProgress(currentJob);}
  showView("console");
};
if(els["download-audit-excel"])els["download-audit-excel"].onclick=()=>downloadAuditSessionExcel();

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
loadAuditSessionIds();
setReviewFormat("raw");
restoreFromStorage();
checkForUpdate();
maybePromptForApiKey();
setInterval(()=>{
  if(currentJob?.status==="running"||currentJob?.status==="reviewing")renderProgress(currentJob);
  if(reviewSessionIds.length)scheduleReviewProgress();
  if(auditSessionIds.length)scheduleAuditProgress();
},1000);
setInterval(checkForUpdate,5*60*1000);
// Do not re-register a service worker — it only caused sticky "update" banners.
if("serviceWorker" in navigator){
  navigator.serviceWorker.getRegistrations().then(regs=>Promise.all(regs.map(reg=>reg.unregister()))).catch(()=>{});
}

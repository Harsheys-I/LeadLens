import {APP_VERSION,DEFAULT_SETTINGS,DEFAULT_OUTPUT_FIELDS,SETTINGS_SEED,MAX_BATCH_SIZE,MAX_CONCURRENCY,normalizeSettings,normalizeInputFields,slugFieldId,parseWorkbook,parseAuditedWorkbook,auditBatch,downloadWorkbook,downloadReviewPack,downloadReviewPdf,splitLeadsByTelecaller,splitResultsByTelecaller,validateApiKey,HIGH_SEVERITY_ERRORS,SERVER_API_KEY} from "./audit.js?v=5.2.33";
import {getJob,getJobs,loadSettings,saveSettings,getApiKey,apiKeyIsRemembered,saveApiKey,forgetApiKey,setStorageUserId,storageKey} from "./db.js?v=5.2.19";
import {renderReviewDashboard,destroyReviewDashboard} from "./dashboard-view.js?v=5.2.33";
import {requireAuth,logout,hasPermission,getUser,changePassword,updateProfile} from "./auth.js?v=5.2.19";
import {DashboardApi,SettingsApi} from "./api-client.js?v=5.2.33";
import {mountNotifications} from "./notifications-ui.js?v=5.2.33";
import {persistJob,removeJobSynced,clearJobsSynced,pullJobsFromServer} from "./jobs-sync.js?v=5.2.19";
import {mountPerfReportUpload,mountPerfPublishedDashboard,refreshPerfPublished} from "./perf-dashboard.js?v=5.2.38";

const $=id=>document.getElementById(id);
const ids=["page-title","key-state","run-name","pause-run","download-result","progress-label","progress-percent","progress-bar","metric-leads","metric-excel-rows","metric-calls","metric-batch","metric-completed","metric-status","metric-input-tokens","metric-cached-tokens","metric-output-tokens","metric-duration","metric-cost","live-log","clear-console","history-list","clear-history","api-key","remember-key","toggle-key","save-key","forget-key","key-message","batch-size","concurrency","model","input-field-config","add-input-field","ai-field-config","output-field-config","yes-values","no-values","input-price","cached-price","output-price","save-settings","reset-settings","settings-message","toast","mobile-menu","active-job-switch","sort-field","sort-direction","app-version","export-settings","import-settings","import-settings-file","update-banner","update-banner-text","reload-app","key-modal","onboard-key","onboard-toggle","onboard-remember","onboard-message","onboard-save","onboard-skip","sidebar-version","sidebar-notes","review-drop-zone","review-file-input","review-drop-hint","review-file-list","review-validation","start-review","review-run-panel","review-aggregate","review-cards","review-dashboard-panel","review-dashboard-mount","download-review-excel","review-open-console","review-precounts","review-live-progress","review-progress-label","review-progress-percent","review-progress-bar","review-post-actions","create-review-dashboard","export-dashboard-pdf","upload-dashboard-btn","upload-dashboard-modal","upload-telecaller-list","upload-dash-message","upload-dash-confirm","upload-dash-cancel","published-list","refresh-published","published-dashboard-panel","published-dash-title","published-dash-meta","published-dash-actions","published-dashboard-mount","shell-user-label","shell-logout","shell-account"];
const els=Object.fromEntries(ids.map(id=>[id,$(id)]));
const titles={review:"Bucket 1 Lead Audit",console:"Run console",published:"Dashboard",history:"History",settings:"Settings","perf-report":"TeleCalling Performance Report","perf-dashboard":"Performance Dashboard","perf-settings":"Performance Settings"};
/** When false, completed audits do not auto-render charts until Create Dashboard. */
let reviewDashboardRequested=false;
let lastReadyReviewJobs=[];
const ENGINE_VERSION="latest-day-v7";
/** Max TeleCaller review jobs running at once (outer pool). Inner batch pool stays settings.concurrency per job. */
const REVIEW_JOB_CONCURRENCY=10;

let currentJob=null,displayLogs=true;
let reviewFormat="raw";
let reviewParsedFiles=[];
let reviewSessionIds=[];
let reviewQueue=[];
let reviewQueueRunning=false;
let reviewActiveCount=0;
/** Fingerprint of ready review jobs last painted into the in-app dashboard. */
let lastReviewDashboardKey="";
/** In-memory job objects for live Review UI (IndexedDB lags behind pendingBatches / clocks). */
const liveJobs=new Map();
const controllers=new Map();
const saveChains=new Map();
let settings=normalizeSettings(DEFAULT_SETTINGS);
let serverKeyConfigured=false;

function canSeeComparativeKpis(){
  const user=getUser();
  if(!user)return false;
  return Boolean(user.is_super||hasPermission("dashboards.view_all"));
}

function canManagePublishedDashboards(){
  const user=getUser();
  if(!user)return false;
  return Boolean(user.is_super||hasPermission("dashboards.view_all")||hasPermission("admin.users"));
}

function effectiveApiKey(){
  const user=getUser();
  if(serverKeyConfigured&&!user?.is_super)return SERVER_API_KEY;
  const local=getApiKey();
  if(local)return local;
  if(serverKeyConfigured)return SERVER_API_KEY;
  return "";
}

function dashboardRenderOptions(jobsForPdf){
  return{
    highSeverityErrors:HIGH_SEVERITY_ERRORS,
    showComparativeKpis:canSeeComparativeKpis(),
    onExportPdf:()=>exportDashboardPdf(jobsForPdf)
  };
}

async function exportDashboardPdf(jobs){
  try{
    let list=(jobs||[]).filter(job=>job&&job.results?.length);
    if(!list.length){
      toast("No dashboard data to export");
      return;
    }
    if(list.length===1){
      const split=splitResultsByTelecaller(list[0].results);
      if(split.length>1)list=split;
    }
    toast("Building PDF…");
    const stamp=new Date().toISOString().slice(0,10);
    await downloadReviewPdf(list,`TeleCaller_Dashboard_${stamp}.pdf`);
    toast(list.length===1?"PDF downloaded":`PDF downloaded (${list.length} TeleCallers)`);
  }catch(err){
    toast(err.message||"PDF export failed");
  }
}

const deepCopy=value=>JSON.parse(JSON.stringify(value));
const number=value=>Number.isFinite(Number(value))?Number(value):0;
const timestamp=()=>new Date().toISOString();
const setActiveJobId=id=>{const key=storageKey("activeJobId");if(id)sessionStorage.setItem(key,id);else sessionStorage.removeItem(key);};
const getActiveJobId=()=>sessionStorage.getItem(storageKey("activeJobId"))||"";
const saveReviewSessionIds=()=>sessionStorage.setItem(storageKey("reviewSessionIds"),JSON.stringify(reviewSessionIds));
const loadReviewSessionIds=()=>{
  try{const parsed=JSON.parse(sessionStorage.getItem(storageKey("reviewSessionIds"))||"[]");reviewSessionIds=Array.isArray(parsed)?parsed.filter(Boolean):[];}
  catch{reviewSessionIds=[];}
};

function reloadUserSettings(){
  const loaded=loadSettings(DEFAULT_SETTINGS);
  const previousSettingsSeed=Number(loaded.settingsSeed)||0;
  settings=normalizeSettings(loaded);
  if(previousSettingsSeed<SETTINGS_SEED)saveSettings(settings);
}

async function loadServerSettingsAndKey(){
  try{
    const [audit, keyStatus]=await Promise.all([
      SettingsApi.getAudit().catch(()=>({settings:null})),
      SettingsApi.openaiKeyStatus().catch(err=>{
        console.warn("openai-key-status failed", err?.status, err?.message);
        return {configured:false};
      }),
    ]);
    serverKeyConfigured=Boolean(keyStatus && (keyStatus.configured===true || keyStatus.configured===1 || keyStatus.configured==="true"));
    if(serverKeyConfigured&&!getUser()?.is_super&&getApiKey()){
      forgetApiKey();
    }
    if(audit?.settings&&typeof audit.settings==="object"){
      settings=normalizeSettings({...DEFAULT_SETTINGS,...audit.settings});
      saveSettings(settings); // local mirror only
    }
  }catch{/* keep local fallback */}
  updateKeyState();
  syncApiKeySettingsUi();
}

async function persistSettingsEverywhere(next,{announce=true}={}){
  settings=normalizeSettings(next);
  saveSettings(settings);
  const user=getUser();
  if(user?.is_super||hasPermission("telecaller.settings")&&user?.is_super){
    try{
      await SettingsApi.saveAudit(settings);
      if(announce&&els["settings-message"])els["settings-message"].textContent="Saved for everyone.";
      return true;
    }catch(err){
      if(els["settings-message"])els["settings-message"].textContent=err.message||"Saved locally; server save failed.";
      return false;
    }
  }
  if(announce&&els["settings-message"])els["settings-message"].textContent="Settings applied for this session (server settings are Super User only).";
  return true;
}

function clearInMemoryJobs(){
  for(const c of controllers.values()){try{c.abort();}catch{/* ignore */}}
  controllers.clear();
  saveChains.clear();
  liveJobs.clear();
  currentJob=null;
  reviewSessionIds=[];
  reviewQueue=[];
  reviewQueueRunning=false;
  reviewActiveCount=0;
  lastReadyReviewJobs=[];
  lastReviewDashboardKey="";
  reviewDashboardRequested=false;
  reviewParsedFiles=[];
}

function setNavGroupExpanded(group,expanded){
  if(!group)return;
  group.classList.toggle("is-collapsed",!expanded);
  group.querySelectorAll(".nav-toggle").forEach(btn=>{
    btn.setAttribute("aria-expanded",expanded?"true":"false");
    const label=btn.getAttribute("aria-label")||"";
    btn.setAttribute("aria-label",expanded
      ?label.replace(/^Expand\b/,"Collapse")
      :label.replace(/^Collapse\b/,"Expand"));
  });
}

function expandNavGroupForView(name){
  const btn=document.querySelector(`.nav-item[data-view="${name}"]`);
  if(!btn?.classList.contains("nav-item-child"))return;
  const group=btn?.closest(".nav-group");
  if(group)setNavGroupExpanded(group,true);
}

function showView(name){
  const btn=document.querySelector(`.nav-item[data-view="${name}"]`);
  if(btn?.dataset.perm&&!hasPermission(btn.dataset.perm)){
    toast("You do not have permission for this screen.");
    return;
  }
  document.querySelectorAll(".view").forEach(view=>view.classList.toggle("active",view.id===`view-${name}`));
  document.querySelectorAll(".nav-item").forEach(button=>button.classList.toggle("active",button.dataset.view===name));
  if(els["page-title"])els["page-title"].textContent=titles[name]||titles.review;
  expandNavGroupForView(name);
  document.querySelector(".shell")?.classList.remove("menu-open");
  const activeRail=document.querySelector(".view.active .dashboard-filters-rail:not(.is-collapsed)");
  document.body.classList.toggle("dashboard-filters-open",Boolean(activeRail));
  if(name==="history")renderHistory();
  if(name==="settings")renderSettings();
  if(name==="console")refreshJobSwitcher();
  if(name==="review")renderReviewProgress();
  if(name==="published")refreshPublishedDashboards();
  if(name==="perf-dashboard")refreshPerfPublished();
}
function toast(message){els.toast.textContent=message;els.toast.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>els.toast.classList.remove("show"),3200);}
function updateKeyState(){
  const ready=Boolean(effectiveApiKey());
  let label="API key not set";
  if(getApiKey())label="API key ready";
  else if(serverKeyConfigured)label="Server API key ready";
  els["key-state"].textContent=label;
  els["key-state"].classList.toggle("ready",ready);
}
function syncApiKeySettingsUi(){
  const isSuper=Boolean(getUser()?.is_super);
  const saveBtn=els["save-key"];
  const forgetBtn=els["forget-key"];
  const keyInput=els["api-key"];
  const remember=els["remember-key"];
  const rememberLabel=remember?.closest("label");
  const hint=document.getElementById("api-key-server-hint");
  if(hint){
    if(serverKeyConfigured&&!isSuper){
      hint.textContent="Server API key is configured. Audits use the server proxy — you do not need to paste a key.";
    }else if(serverKeyConfigured&&isSuper){
      hint.textContent="Server API key is saved (encrypted). Paste a new key and click Save to server to replace it.";
    }else if(!isSuper){
      hint.textContent="No server API key yet. Ask a Super User to save one in Settings.";
    }else{
      hint.textContent="Paste your OpenAI key and click Save to server so every audit user can run without pasting a key.";
    }
    hint.classList.remove("hidden");
  }
  if(saveBtn){
    saveBtn.textContent=isSuper?"Save to server":"Save on this device";
    saveBtn.classList.toggle("hidden",!isSuper&&serverKeyConfigured);
  }
  if(keyInput){
    keyInput.placeholder=isSuper?"sk-…":(serverKeyConfigured?"Using server key":"sk-… (optional local fallback)");
    keyInput.disabled=!isSuper&&serverKeyConfigured;
    if(!isSuper&&serverKeyConfigured)keyInput.value="";
  }
  if(rememberLabel)rememberLabel.classList.toggle("hidden",!isSuper&&serverKeyConfigured);
  if(forgetBtn){
    const hasLocal=Boolean(getApiKey());
    forgetBtn.textContent=isSuper&&serverKeyConfigured?"Clear server key":(hasLocal?"Forget local key":"Forget key");
    forgetBtn.classList.toggle("hidden",!isSuper&&serverKeyConfigured&&!hasLocal);
  }
}
// Only hard-block a save for these; soft failures (network/quota/other) still save with a caution.
const BLOCK_KEY_REASONS=new Set(["empty","format","unauthorized","forbidden"]);
async function validateAndSaveKey(key,remember,messageEl,buttonEl,{toServer=false}={}){
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
  if(toServer){
    try{
      await SettingsApi.saveOpenaiKey(trimmed);
      serverKeyConfigured=true;
      forgetApiKey();
      if(els["api-key"])els["api-key"].value="";
      updateKeyState();
      syncApiKeySettingsUi();
      if(messageEl)messageEl.textContent=(result.ok?result.message+" ":"")+ "Saved encrypted on the server for everyone.";
      return true;
    }catch(err){
      if(messageEl)messageEl.textContent=err.message||"Could not save server key";
      return false;
    }
  }
  saveApiKey(trimmed,Boolean(remember));
  updateKeyState();
  syncApiKeySettingsUi();
  if(messageEl){
    const where=remember?"Saved on this device.":"Saved for this session.";
    messageEl.textContent=result.ok?`${result.message} ${where}`:`${result.message} Saved anyway — ${where}`;
  }
  return true;
}
function openKeyModal(){
  if(!els["key-modal"])return;
  // Non-super: never ask to paste a personal key when server key exists.
  if(!getUser()?.is_super){
    if(serverKeyConfigured)return;
    if(els["key-modal-title"])els["key-modal-title"].textContent="OpenAI key not configured";
    const copy=els["key-modal"].querySelector(".key-modal-copy");
    if(copy)copy.textContent="Ask a Super User to save the OpenAI API key in Settings. Audits use the server key — you should not paste one here.";
    els["onboard-key"]?.closest("label")?.classList.add("hidden");
    els["onboard-remember"]?.closest("label")?.classList.add("hidden");
    if(els["onboard-save"])els["onboard-save"].classList.add("hidden");
    if(els["onboard-skip"])els["onboard-skip"].textContent="OK";
    if(els["onboard-message"])els["onboard-message"].textContent="";
    els["key-modal"].classList.remove("hidden");
    return;
  }
  if(serverKeyConfigured)return;
  if(els["key-modal-title"])els["key-modal-title"].textContent="Connect your OpenAI API key";
  const copy=els["key-modal"].querySelector(".key-modal-copy");
  if(copy)copy.textContent="Save the key to the server (encrypted). Admin and other audit users will use it via the server proxy — they never need to paste a key.";
  els["onboard-key"]?.closest("label")?.classList.remove("hidden");
  els["onboard-remember"]?.closest("label")?.classList.add("hidden");
  if(els["onboard-save"]){
    els["onboard-save"].classList.remove("hidden");
    els["onboard-save"].textContent="Validate & save to server";
  }
  if(els["onboard-skip"])els["onboard-skip"].textContent="I'll add it later";
  els["onboard-key"].value="";
  if(els["onboard-remember"])els["onboard-remember"].checked=false;
  els["onboard-message"].textContent="";
  els["onboard-key"].type="password";
  if(els["onboard-toggle"])els["onboard-toggle"].textContent="Show";
  els["key-modal"].classList.remove("hidden");
  setTimeout(()=>els["onboard-key"]?.focus(),60);
}
function closeKeyModal(){els["key-modal"]?.classList.add("hidden");}
function maybePromptForApiKey(){if(!effectiveApiKey())openKeyModal();}
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
      await persistJob(job);
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
      await persistJob(job);
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
    await persistJob(job);
    if(merged)addLog(job,`Flushed checkpoints ${from+1}–${job.nextBatch}. ${job.results.length}/${job.totalLeads} call rows saved (${uniqueLeadCount(job)} leads).`);
  });
}

async function runJob(job,{navigate=false}={}){
  if(controllers.has(job.id)){toast("That audit is already running.");return;}
  const key=effectiveApiKey();
  if(!key){showView("settings");toast("Add an OpenAI API key first.");return;}
  if(key!==SERVER_API_KEY&&!/^sk-[A-Za-z0-9_-]{20,}$/.test(key)){showView("settings");toast("That does not look like an OpenAI API key.");return;}

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
    addLog(job,`TeleCaller report: ${job.telecallerName||job.fileName} · ${job.results.length} audited rows · in-app dashboard from audit metrics · app ${APP_VERSION}.`);
  }else{
    addLog(job,`Run started: live pool of ${concurrency} (next batch fires the instant one frees a slot), batch size ${job.settings.batchSize} leads, model ${job.settings.model}, app ${APP_VERSION}. Checkpoints stay in order — later batches may finish API first and wait.`);
  }
  await persistJob(job);
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
    await persistJob(job);
    if(currentJob?.id===job.id)renderProgress(job);
    if(isReview||isParent)scheduleReviewProgress();
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
    await persistJob(job);
    if(currentJob?.id===job.id)renderProgress(job);
    if(isReview||isParent)scheduleReviewProgress();
  }finally{
    clearPendingPersist(job.id);
    controllers.delete(job.id);
    liveJobs.set(job.id,job);
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
        await persistJob(child);
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
    await persistJob(child);
    liveJobs.set(child.id,child);
    children.push(child);
    if(!reviewSessionIds.includes(child.id))reviewSessionIds.push(child.id);
  }
  parentJob.childReviewIds=children.map(child=>child.id);
  parentJob.updatedAt=timestamp();
  await persistJob(parentJob);
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

function renderReviewFileList(){
  const list=els["review-file-list"];
  if(!list)return;
  list.replaceChildren();
  if(!reviewParsedFiles.length){
    list.classList.add("hidden");
    if(els["start-review"]&&!reviewQueueRunning)els["start-review"].disabled=true;
    renderReviewPrecounts();
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
  renderReviewPrecounts();
}

function renderReviewPrecounts(){
  const box=els["review-precounts"];
  if(!box)return;
  if(!reviewParsedFiles.length){box.className="review-precounts hidden";box.replaceChildren();return;}
  const file=reviewParsedFiles[0];
  const leads=file.leadCount||0;
  const calls=file.results?.length||file.callCount||file.leads?.length||0;
  const audits=file.results?.length||leads;
  box.className="review-precounts";
  box.replaceChildren();
  for(const [label,value] of [["Leads",leads],["Calls",calls],["Audits",audits]]){
    const cell=document.createElement("div");
    cell.innerHTML=`<span>${label}</span><strong>${Number(value).toLocaleString()}</strong>`;
    box.append(cell);
  }
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
  reviewDashboardRequested=false;
  lastReadyReviewJobs=[];
  lastReviewDashboardKey="";
  destroyReviewDashboard();
  if(els["review-dashboard-mount"])els["review-dashboard-mount"].replaceChildren();
  els["review-dashboard-panel"]?.classList.add("hidden");
  els["review-post-actions"]?.classList.add("hidden");
  if(els["create-review-dashboard"])els["create-review-dashboard"].disabled=true;
  if(els["export-dashboard-pdf"])els["export-dashboard-pdf"].disabled=true;
  if(els["upload-dashboard-btn"])els["upload-dashboard-btn"].disabled=true;

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
    await persistJob(parent);
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
      await persistJob(parent);
      if(currentJob?.id===parent.id)renderProgress(parent);
      scheduleReviewProgress();
      toast("TeleCaller dashboard ready.");
    }catch(error){
      parent.status="failed";
      parent.error=error.message||String(error);
      stopClock(parent);
      parent.updatedAt=timestamp();
      addLog(parent,`FAILED: ${parent.error}`,"error");
      await persistJob(parent);
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
  const key=effectiveApiKey();
  if(!key){showView("settings");toast("Add an OpenAI API key first (Excel RAW runs an audit).");return;}
  reviewSessionIds=[];
  reviewQueue=[];
  for(const id of [...liveJobs.keys()])liveJobs.delete(id);
  const parent=createCombinedParentJob(file);
  parent.sourceFormat="raw";
  parent.expectedTelecallerCount=splits.length||0;
  await persistJob(parent);
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
              await persistJob(parent);
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
          if(els["start-review"])els["start-review"].textContent="Start Audit →";
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
    const pct=totalTarget?Math.round(Math.min(totalDone,totalTarget)/totalTarget*100):0;
    const items=[
      ["Leads finished",totalLeads.toLocaleString()],
      ["Audits finished",totalTarget?`${totalDone} / ${totalTarget}`:"—"],
      ["TeleCallers",`${teleDone} / ${teleTotal}${teleFailed?` · ${teleFailed} failed`:""}`],
      [sessionDone?"Time taken":"Time taken",wallMs?durationText(wallMs):"—"],
      ["Cost",`₹ ${totalCost.toFixed(4)}`]
    ];
    for(const [label,value] of items){
      const cell=document.createElement("div");
      const span=document.createElement("span");
      span.textContent=label;
      const strong=document.createElement("strong");
      strong.textContent=value;
      if(label==="Time taken"&&sessionDone)strong.className="total-time-taken";
      cell.append(span,strong);
      aggregate.append(cell);
    }
    const live=els["review-live-progress"];
    if(live){
      live.classList.remove("hidden");
      if(els["review-progress-label"])els["review-progress-label"].textContent=sessionDone?"Audit complete":"Auditing…";
      if(els["review-progress-percent"])els["review-progress-percent"].textContent=`${pct}%`;
      if(els["review-progress-bar"])els["review-progress-bar"].style.width=`${pct}%`;
    }
  }

  const ready=await getReadyReviewDownloadJobs();
  lastReadyReviewJobs=ready;
  const post=els["review-post-actions"];
  if(post){
    if(ready.length){
      post.classList.remove("hidden");
      if(els["download-review-excel"])els["download-review-excel"].disabled=false;
      if(els["create-review-dashboard"])els["create-review-dashboard"].disabled=false;
    }else{
      post.classList.add("hidden");
      if(els["download-review-excel"])els["download-review-excel"].disabled=true;
      if(els["create-review-dashboard"])els["create-review-dashboard"].disabled=true;
    }
  }

  const dashboardPanel=els["review-dashboard-panel"];
  if(dashboardPanel){
    if(reviewDashboardRequested&&ready.length){
      dashboardPanel.classList.remove("hidden");
      if(els["upload-dashboard-btn"]){
        els["upload-dashboard-btn"].disabled=!hasPermission("telecaller.upload_dashboard");
      }
      if(els["export-dashboard-pdf"])els["export-dashboard-pdf"].disabled=false;
      const key=ready.map(job=>`${job.id}:${job.results?.length||0}:${job.status}`).join("|");
      if(key!==lastReviewDashboardKey){
        lastReviewDashboardKey=key;
        try{
          renderReviewDashboard(els["review-dashboard-mount"],ready,dashboardRenderOptions(ready));
        }catch(error){
          toast(error.message||"Could not render dashboard.");
        }
      }
    }else if(!reviewDashboardRequested){
      lastReviewDashboardKey="";
      destroyReviewDashboard();
      if(els["review-dashboard-mount"])els["review-dashboard-mount"].replaceChildren();
      dashboardPanel.classList.add("hidden");
      if(els["export-dashboard-pdf"])els["export-dashboard-pdf"].disabled=true;
      if(els["upload-dashboard-btn"])els["upload-dashboard-btn"].disabled=true;
    }else{
      lastReviewDashboardKey="";
      destroyReviewDashboard();
      if(els["review-dashboard-mount"])els["review-dashboard-mount"].replaceChildren();
      dashboardPanel.classList.add("hidden");
      if(els["export-dashboard-pdf"])els["export-dashboard-pdf"].disabled=true;
      if(els["upload-dashboard-btn"])els["upload-dashboard-btn"].disabled=true;
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
  try{await pullJobsFromServer();}catch{/* offline */}
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
    const ownerBit=job.ownerName?` · by ${job.ownerName}`:"";
    meta.textContent=legacy
      ?`${timeText(job.createdAt)} · previous engine result — upload the file and run it again for v2 rules.${ownerBit}`
      :`${timeText(job.createdAt)} · ${job.mode==="telecaller-review"?`Review · ${job.telecallerName||"TeleCaller"} · `:job.mode==="telecaller-review-parent"?`${job.sourceFormat==="audit"?"Excel Audit":"Excel RAW"} · `:""}${uniqueLeadCount(job)} leads · ${job.callCount??job.rowCount??"—"} calls · ${auditedDoneCount(job)}/${job.totalLeads} audited · ${durationText(job.elapsedMs||0)} · cost ${estimatedCost(job).toFixed(4)} · cached ${number(job.tokenUsage?.cached).toLocaleString()}${ownerBit}`;
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
      if(confirm("Delete this audit from shared team history and this browser?")){
        await removeJobSynced(job.id);
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
  els["input-price"].value=settings.pricing.input;
  els["cached-price"].value=settings.pricing.cached;
  els["output-price"].value=settings.pricing.output;
  els["api-key"].value=getApiKey();
  els["remember-key"].checked=apiKeyIsRemembered();
  if(els["app-version"])els["app-version"].textContent=APP_VERSION;
  renderInputFields();
  renderAiFields();
  renderOutputFields();
  renderSortFields();
  updateKeyState();
  syncApiKeySettingsUi();
}
function collectSettings(){
  const next=normalizeSettings(settings);
  next.batchSize=Number(els["batch-size"].value);
  next.concurrency=Number(els.concurrency.value);
  next.model=els.model.value.trim();
  next.yesValues=els["yes-values"].value.trim();
  next.noValues=els["no-values"].value.trim();
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
  }
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
      await persistJob(job);
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
    const response=await fetch(`../version.json?t=${Date.now()}`,{cache:"no-store"});
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

function readSidebarCollapsedPref(){
  try{return localStorage.getItem(storageKey("sidebarCollapsed"))==="1";}
  catch{return false;}
}

function writeSidebarCollapsedPref(collapsed){
  try{localStorage.setItem(storageKey("sidebarCollapsed"),collapsed?"1":"0");}
  catch{/* ignore */}
}

function applySidebarCollapsed(collapsed,{persist=true}={}){
  const shell=document.querySelector(".shell");
  if(!shell)return;
  shell.classList.toggle("sidebar-collapsed",Boolean(collapsed));
  const btn=els["mobile-menu"];
  if(btn){
    btn.setAttribute("aria-expanded",collapsed?"false":"true");
    btn.setAttribute("aria-label",collapsed?"Show left panel":"Hide left panel");
    btn.title=collapsed?"Show left panel":"Hide left panel";
  }
  if(persist)writeSidebarCollapsedPref(Boolean(collapsed));
  requestAnimationFrame(()=>window.dispatchEvent(new Event("resize")));
}

document.querySelectorAll(".nav-toggle").forEach(button=>button.addEventListener("click",()=>{
  const group=button.closest(".nav-group");
  if(!group)return;
  setNavGroupExpanded(group,group.classList.contains("is-collapsed"));
}));
document.querySelectorAll(".nav-item").forEach(button=>button.addEventListener("click",()=>{
  const isParent=button.classList.contains("nav-item-parent")||button.hasAttribute("data-nav-toggle-group");
  if(isParent){
    const group=button.closest(".nav-group");
    if(group){
      // Navigable parents expand (stay open on re-click); pure toggle parents flip open/closed.
      if(button.dataset.view)setNavGroupExpanded(group,true);
      else setNavGroupExpanded(group,group.classList.contains("is-collapsed"));
    }
    if(!button.dataset.view)return;
  }
  if(button.dataset.view)showView(button.dataset.view);
}));
document.querySelector(".brand")?.addEventListener("click",event=>{
  // Brand goes to home hub (href="/"); only prevent default if we want in-module nav
});
document.getElementById("settings-form")?.addEventListener("submit",event=>event.preventDefault());
els["mobile-menu"]?.addEventListener("click",()=>{
  const shell=document.querySelector(".shell");
  if(!shell)return;
  const narrow=window.matchMedia("(max-width:850px)").matches;
  if(narrow){
    shell.classList.toggle("menu-open");
    return;
  }
  applySidebarCollapsed(!shell.classList.contains("sidebar-collapsed"));
});
els["shell-logout"]?.addEventListener("click",async()=>{
  await logout();
  clearInMemoryJobs();
  setStorageUserId(null);
  location.href="/";
});
els["shell-account"]?.addEventListener("click",()=>{
  const user=getUser();
  const modal=document.getElementById("account-modal");
  if(!user||!modal)return;
  document.getElementById("account-username").value=user.username||"";
  document.getElementById("account-display").value=user.display_name||"";
  document.getElementById("account-telecaller").value=user.telecaller_name||"— set by Admin only —";
  document.getElementById("account-pw-current").value="";
  document.getElementById("account-pw-new").value="";
  document.getElementById("account-pw-confirm").value="";
  document.getElementById("account-message").textContent="";
  modal.classList.remove("hidden");
});
document.getElementById("account-cancel")?.addEventListener("click",()=>{
  document.getElementById("account-modal")?.classList.add("hidden");
});
document.getElementById("account-save")?.addEventListener("click",async()=>{
  const msg=document.getElementById("account-message");
  if(!msg)return;
  msg.textContent="Saving…";
  try{
    const user=await updateProfile({
      username:document.getElementById("account-username").value.trim(),
      display_name:document.getElementById("account-display").value.trim(),
    });
    const pwCur=document.getElementById("account-pw-current").value;
    const pwNew=document.getElementById("account-pw-new").value;
    if(pwCur||pwNew){
      if(pwNew!==document.getElementById("account-pw-confirm").value){msg.textContent="New passwords do not match.";return;}
      await changePassword(pwCur,pwNew);
    }
    if(els["shell-user-label"])els["shell-user-label"].textContent=user.display_name||user.username;
    msg.textContent="Account updated.";
    toast("Account saved");
    setTimeout(()=>document.getElementById("account-modal")?.classList.add("hidden"),400);
  }catch(err){
    msg.textContent=err.message||"Could not update account";
  }
});
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
if(els["create-review-dashboard"])els["create-review-dashboard"].onclick=()=>{
  reviewDashboardRequested=true;
  lastReviewDashboardKey="";
  renderReviewProgress();
  toast("Dashboard created below.");
};
if(els["upload-dashboard-btn"])els["upload-dashboard-btn"].onclick=openUploadDashboardModal;
if(els["export-dashboard-pdf"])els["export-dashboard-pdf"].onclick=()=>exportDashboardPdf(lastReadyReviewJobs);
if(els["upload-dash-cancel"])els["upload-dash-cancel"].onclick=closeUploadDashboardModal;
if(els["upload-dash-confirm"])els["upload-dash-confirm"].onclick=confirmUploadDashboard;
if(els["refresh-published"])els["refresh-published"].onclick=()=>refreshPublishedDashboards();
if(els["review-open-console"])els["review-open-console"].onclick=()=>{
  if(!hasPermission("telecaller.run_console")){toast("Run console is not enabled for your role.");return;}
  if(currentJob){displayLogs=true;renderProgress(currentJob);}
  showView("console");
};

els["clear-history"]?.addEventListener("click",async()=>{
  if(controllers.size){toast("Pause all running audits before clearing history.");return;}
  if(confirm("Delete all shared team history and local audits, checkpoints, token history and logs?")){
    await clearJobsSynced();
    currentJob=null;
    setActiveJobId("");
    renderHistory();
    toast("Shared history cleared.");
  }
});
els["toggle-key"]?.addEventListener("click",()=>{const hidden=els["api-key"].type==="password";els["api-key"].type=hidden?"text":"password";els["toggle-key"].textContent=hidden?"Hide":"Show";});
els["save-key"]?.addEventListener("click",async()=>{
  const toServer=Boolean(getUser()?.is_super);
  await validateAndSaveKey(els["api-key"].value,els["remember-key"].checked,els["key-message"],els["save-key"],{toServer});
});
els["forget-key"]?.addEventListener("click",async()=>{
  forgetApiKey();
  els["api-key"].value="";
  els["remember-key"].checked=false;
  if(getUser()?.is_super&&serverKeyConfigured){
    try{
      await SettingsApi.clearOpenaiKey();
      serverKeyConfigured=false;
      els["key-message"].textContent="Server key cleared.";
    }catch(err){
      els["key-message"].textContent=err.message||"Could not clear server key";
    }
  }else{
    els["key-message"].textContent="Key removed.";
  }
  updateKeyState();
  syncApiKeySettingsUi();
});
els["onboard-toggle"]?.addEventListener("click",()=>{const hidden=els["onboard-key"].type==="password";els["onboard-key"].type=hidden?"text":"password";els["onboard-toggle"].textContent=hidden?"Hide":"Show";});
els["onboard-save"]?.addEventListener("click",async()=>{
  const toServer=Boolean(getUser()?.is_super);
  const saved=await validateAndSaveKey(els["onboard-key"].value,els["onboard-remember"].checked,els["onboard-message"],els["onboard-save"],{toServer});
  if(saved){closeKeyModal();toast(toServer?"Server OpenAI key saved for everyone.":"OpenAI key saved.");}
});
els["onboard-key"]?.addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();els["onboard-save"].click();}});
els["onboard-skip"]?.addEventListener("click",()=>{closeKeyModal();toast(getUser()?.is_super?"You can save the server key any time in Settings.":"Ask a Super User to configure the server API key.");});
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
els["save-settings"].onclick=async()=>{
  // Validate the raw inputs first — collectSettings() clamps to the limits, which
  // would otherwise hide out-of-range values from the checks below.
  const rawBatch=Number(els["batch-size"].value);
  const rawConcurrency=Number(els.concurrency.value);
  if(!Number.isInteger(rawBatch)||rawBatch<1||rawBatch>MAX_BATCH_SIZE){els["settings-message"].textContent=`Batch size must be 1–${MAX_BATCH_SIZE}.`;return;}
  if(!Number.isInteger(rawConcurrency)||rawConcurrency<1||rawConcurrency>MAX_CONCURRENCY){els["settings-message"].textContent=`Parallel batches must be 1–${MAX_CONCURRENCY}.`;return;}
  const next=collectSettings();
  if(!next.model){els["settings-message"].textContent="Enter a model name.";return;}
  if(!next.outputFields.some(field=>field.enabled)){els["settings-message"].textContent="Select at least one output Excel field.";return;}
  await persistSettingsEverywhere(next);
  renderSettings();
};
els["reset-settings"].onclick=async()=>{
  settings=normalizeSettings(DEFAULT_SETTINGS);
  await persistSettingsEverywhere(settings,{announce:false});
  renderSettings();
  els["settings-message"].textContent=getUser()?.is_super?"Defaults restored for everyone.":"Defaults restored locally.";
};
els["export-settings"].onclick=exportSettings;
els["import-settings"].onclick=()=>els["import-settings-file"].click();
els["import-settings-file"].onchange=event=>importSettingsFile(event.target.files?.[0]);
function persistSortFromForm(){
  settings=collectSettings();
  saveSettings(settings);
  els["settings-message"].textContent=`Sort set to ${els["sort-field"].selectedOptions[0]?.textContent||settings.sort.field} · ${settings.sort.direction==="desc"?"descending":"ascending"}. Re-download the Excel to apply.`;
}
els["sort-field"]?.addEventListener("change",persistSortFromForm);
els["sort-direction"]?.addEventListener("change",persistSortFromForm);
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

setReviewFormat("raw");

async function bootTeleCallerAudit(){
  const user=await requireAuth({loginPath:"/"});
  if(!user)return;
  if(!hasPermission("module.telecaller_audit")&&!user.is_super){
    location.href="/";
    return;
  }

  setStorageUserId(user.id);
  clearInMemoryJobs();
  reloadUserSettings();
  applySidebarCollapsed(readSidebarCollapsedPref(),{persist:false});
  await loadServerSettingsAndKey();
  loadReviewSessionIds();
  renderSettings();
  await renderHistory();

  if(els["shell-user-label"])els["shell-user-label"].textContent=user.display_name||user.username;

  document.querySelectorAll(".nav-item[data-perm]").forEach(btn=>{
    const perm=btn.dataset.perm;
    if(perm&&!hasPermission(perm))btn.classList.add("hidden");
  });
  document.querySelectorAll(".nav-group").forEach(group=>{
    const items=[...group.querySelectorAll(".nav-item")];
    const anyVisible=items.some(btn=>!btn.classList.contains("hidden"));
    group.classList.toggle("hidden",!anyVisible);
  });
  if(els["review-open-console"]&&!hasPermission("telecaller.run_console")){
    els["review-open-console"].classList.add("hidden");
  }

  const hashView=location.hash.slice(1);
  if(hashView==="published"&&hasPermission("telecaller.dashboard"))showView("published");
  else if(hashView==="perf-dashboard"&&hasPermission("telecaller.perf_dashboard"))showView("perf-dashboard");
  else if(hashView==="perf-report"&&hasPermission("telecaller.perf_report"))showView("perf-report");
  else if(hashView==="perf-settings"&&hasPermission("telecaller.perf_settings"))showView("perf-settings");
  else{
    const firstVisible=[...document.querySelectorAll(".nav-item[data-view]:not(.hidden)")][0];
    showView(firstVisible?.dataset.view||"review");
  }
  await restoreFromStorage();
  checkForUpdate();
  if(hasPermission("telecaller.bucket1")||hasPermission("telecaller.settings"))maybePromptForApiKey();
  mountPerfReportUpload({hasPermission,toast,showView});
  mountPerfPublishedDashboard({hasPermission,canViewAll:canSeeComparativeKpis});
  mountNotifications({
    variant:"chrome",
    onOpenAccessRequests:()=>{location.href="/admin/";},
    onDashboardUpdate:()=>{
      if(!hasPermission("telecaller.dashboard"))return;
      location.hash="#published";
      showView("published");
    },
    onPerfDashboardUpdate:()=>{
      if(!hasPermission("telecaller.perf_dashboard"))return;
      location.hash="#perf-dashboard";
      showView("perf-dashboard");
    },
  });
  window.addEventListener("hashchange",()=>{
    if(location.hash==="#published"&&hasPermission("telecaller.dashboard"))showView("published");
    if(location.hash==="#perf-dashboard"&&hasPermission("telecaller.perf_dashboard"))showView("perf-dashboard");
    if(location.hash==="#perf-report"&&hasPermission("telecaller.perf_report"))showView("perf-report");
    if(location.hash==="#perf-settings"&&hasPermission("telecaller.perf_settings"))showView("perf-settings");
  });
  setInterval(()=>{
    if(currentJob?.status==="running"||currentJob?.status==="reviewing")renderProgress(currentJob);
    if(reviewSessionIds.length)scheduleReviewProgress();
  },1000);
  setInterval(checkForUpdate,5*60*1000);
}

function telecallerNamesFromJobs(jobs){
  const names=new Set();
  for(const job of jobs||[]){
    for(const row of job.results||[]){
      const n=String(row.telecallerName||row.telecaller||"").trim();
      if(n)names.add(n);
    }
    if(job.telecallerName&&job.mode==="telecaller-review")names.add(job.telecallerName);
  }
  return [...names].sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:"base"}));
}

function openUploadDashboardModal(){
  if(!hasPermission("telecaller.upload_dashboard")){toast("Upload not permitted for your role.");return;}
  const modal=els["upload-dashboard-modal"];
  const list=els["upload-telecaller-list"];
  if(!modal||!list)return;
  const names=telecallerNamesFromJobs(lastReadyReviewJobs);
  list.replaceChildren();
  if(!names.length){
    list.innerHTML='<p class="muted">No TeleCaller names found in this run.</p>';
  }else{
    for(const name of names){
      const label=document.createElement("label");
      label.className="check-row";
      const input=document.createElement("input");
      input.type="checkbox";
      input.value=name;
      input.checked=true;
      const span=document.createElement("span");
      span.textContent=name;
      label.append(input,span);
      list.append(label);
    }
  }
  if(els["upload-dash-message"])els["upload-dash-message"].textContent="";
  modal.classList.remove("hidden");
}

function closeUploadDashboardModal(){
  els["upload-dashboard-modal"]?.classList.add("hidden");
}

async function confirmUploadDashboard(){
  const list=els["upload-telecaller-list"];
  const selected=[...list.querySelectorAll("input[type=checkbox]:checked")].map(i=>i.value);
  if(!selected.length){els["upload-dash-message"].textContent="Select at least one TeleCaller.";return;}
  const allResults=lastReadyReviewJobs.flatMap(j=>j.results||[]);
  const sourceFile=lastReadyReviewJobs[0]?.parentFileName||lastReadyReviewJobs[0]?.fileName||"";
  const dashboards=selected.map(name=>{
    const results=allResults.filter(row=>{
      const n=String(row.telecallerName||row.telecaller||"").trim();
      return n===name;
    });
    return {
      telecaller_name:name,
      title:`${name} · ${sourceFile||"audit"}`,
      results,
      source_file:sourceFile,
      lead_count:results.length
    };
  }).filter(d=>d.results.length);
  if(!dashboards.length){els["upload-dash-message"].textContent="No result rows for the selected TeleCallers.";return;}
  els["upload-dash-message"].textContent="Uploading…";
  try{
    const data=await DashboardApi.publish(dashboards);
    const published=data.published||[];
    const n=published.length;
    const cleared=Number(data.cleared??0)||published.filter(p=>Number(p.prior_deleted||0)>0||p.replaced).length;
    const msg=cleared
      ?`Cleared ${cleared} old board(s); published ${n} TeleCaller dashboard(s).`
      :`Published ${n} TeleCaller dashboard(s).`;
    els["upload-dash-message"].textContent=msg;
    toast(cleared
      ?(n===1?"Old dashboards cleared; new board uploaded":`Old dashboards cleared; uploaded ${n} boards`)
      :(n===1?"Dashboard uploaded":`Uploaded ${n} TeleCaller dashboards`));
    setTimeout(closeUploadDashboardModal,800);
    if(hasPermission("telecaller.dashboard")){
      location.hash="#published";
      showView("published");
      await refreshPublishedDashboards();
    }
  }catch(err){
    els["upload-dash-message"].textContent=err.message||"Upload failed";
  }
}

function canDeletePublishedDashboard(){
  return canManagePublishedDashboards();
}

/** Empty the manage list mount — per-TeleCaller Delete cards removed; Delete All lives in panel actions. */
function clearPublishedManageList(){
  const mount=els["published-list"];
  if(!mount)return;
  mount.replaceChildren();
  mount.classList.add("hidden");
}

async function deleteAllPublishedDashboards(){
  if(!canManagePublishedDashboards())return;
  if(!confirm("Delete all published dashboards? This cannot be undone."))return;
  try{
    await DashboardApi.removeAll();
    toast("All published dashboards deleted");
    await refreshPublishedDashboards();
  }catch(err){
    toast(err.message||"Could not delete dashboards");
  }
}

async function refreshPublishedDashboards(){
  const mount=els["published-list"];
  const panel=els["published-dashboard-panel"];
  if(!mount)return;
  if(!hasPermission("telecaller.dashboard")){
    mount.classList.remove("hidden");
    mount.innerHTML='<div class="empty-card">Dashboard access is not enabled for your role.</div>';
    panel?.classList.add("hidden");
    destroyReviewDashboard();
    return;
  }
  clearPublishedManageList();
  try{
    const data=await DashboardApi.combined();
    const results=data.results||[];
    const items=data.dashboards||[];
    if(!results.length&&!items.length){
      mount.classList.remove("hidden");
      mount.innerHTML='<div class="empty-card">No published dashboards yet.</div>';
      panel?.classList.add("hidden");
      destroyReviewDashboard();
      return;
    }
    if(els["published-dash-title"])els["published-dash-title"].textContent=data.title||"Dashboard";
    if(els["published-dash-meta"]){
      const when=data.updated_at?new Date(String(data.updated_at).endsWith("Z")?data.updated_at:data.updated_at+"Z").toLocaleString():"";
      const count=items.length;
      els["published-dash-meta"].textContent=data.view_all
        ?`Combined · ${count} TeleCaller${count===1?"":"s"} · ${results.length} rows${when?" · updated "+when:""}`
        :`Your board · ${results.length} rows${when?" · updated "+when:""}`;
    }
    const fakeJob={id:"published-combined",results,status:"completed",telecallerName:data.title||"Dashboard",updatedAt:data.updated_at};
    const actions=els["published-dash-actions"];
    if(actions){
      actions.replaceChildren();
      const pdfBtn=document.createElement("button");
      pdfBtn.type="button";
      pdfBtn.className="secondary-button";
      pdfBtn.textContent="Export PDF";
      pdfBtn.onclick=()=>exportDashboardPdf([fakeJob]);
      actions.append(pdfBtn);
      if(canManagePublishedDashboards()&&items.length){
        const all=document.createElement("button");
        all.type="button";
        all.className="danger-button";
        all.textContent="Delete All";
        all.onclick=()=>deleteAllPublishedDashboards();
        actions.append(all);
      }
    }
    panel?.classList.remove("hidden");
    renderReviewDashboard(els["published-dashboard-mount"],[fakeJob],dashboardRenderOptions([fakeJob]));
  }catch(err){
    mount.classList.remove("hidden");
    mount.innerHTML=`<div class="empty-card">${err.message||"Could not load dashboards."}</div>`;
    panel?.classList.add("hidden");
  }
}

bootTeleCallerAudit();
// Do not re-register a service worker — it only caused sticky "update" banners.
if("serviceWorker" in navigator){
  navigator.serviceWorker.getRegistrations().then(regs=>Promise.all(regs.map(reg=>reg.unregister()))).catch(()=>{});
}

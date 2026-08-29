/**
 * DeBug Mode UI — SuperUser-only Error Focus Lab (Run + Settings).
 */
import {
  APP_VERSION,
  DEFAULT_SETTINGS,
  DEFAULT_OUTPUT_FIELDS,
  MAX_BATCH_SIZE,
  MAX_CONCURRENCY,
  normalizeSettings,
  normalizeInputFields,
  slugFieldId,
  parseWorkbook,
  downloadWorkbook,
  selectedOutputFields,
  sortResults,
  validateApiKey,
  SERVER_API_KEY,
} from "./audit.js?v=5.2.18";
import {getApiKey,apiKeyIsRemembered,saveApiKey,forgetApiKey,setStorageUserId,storageKey} from "./db.js?v=5.2.18";
import {requireAuth,logout,getUser,changePassword,updateProfile} from "./auth.js?v=5.2.18";
import {SettingsApi} from "./api-client.js?v=5.2.18";
import {mountNotifications} from "./notifications-ui.js?v=5.2.18";
import {
  debugAuditBatch,
  telecallerAuditBatch,
  compareDebugVsTelecaller,
  activePromptsReady,
  normalizeActiveErrorTypes,
} from "./debug-engine.js?v=5.2.18";
import {
  LAB_ERROR_TYPES,
  STATUS_HISTORY_PROMPT,
  emptyErrorPrompts,
  ERROR_TO_AUDIT_RULE,
} from "./debug-prompts.js?v=5.2.18";

const $=id=>document.getElementById(id);
const ids=[
  "page-title","key-state","pause-run","download-result","compare-telecaller","re-audit","re-audit-panel",
  "run-ten-times","run-ten-times-panel","progress-label","progress-percent","progress-bar",
  "metric-leads","metric-calls","metric-batch","metric-completed","metric-status","metric-input-tokens",
  "metric-cached-tokens","metric-output-tokens","metric-duration","metric-cost","live-log","clear-console",
  "api-key","remember-key","toggle-key","save-key","forget-key","key-message","batch-size","concurrency","model",
  "input-field-config","add-input-field","ai-field-config","output-field-config","yes-values","no-values",
  "error-type-checks","error-run-hint","focus-error-type","error-prompt","sync-status-from-audit","push-prompt-to-audit","clear-error-prompt",
  "input-price","cached-price","output-price","save-settings","reset-settings","settings-message",
  "toast","mobile-menu","sort-field","sort-direction","app-version","export-settings","import-settings",
  "import-settings-file","update-banner","update-banner-text","reload-app","key-modal","onboard-key",
  "onboard-toggle","onboard-remember","onboard-message","onboard-save","onboard-skip","sidebar-version",
  "sidebar-notes","debug-drop-zone","debug-file-input","debug-drop-hint","debug-file-list","debug-validation",
  "start-debug","debug-run-panel","debug-precounts","debug-active-chips","debug-results-panel","debug-error-counts",
  "debug-result-filters","debug-results-head","debug-results-body","debug-compare-panel","debug-compare-summary","debug-compare-metrics",
  "debug-compare-body",
  "shell-user-label","shell-logout","shell-account"
];
const els=Object.fromEntries(ids.map(id=>[id,$(id)]));
const titles={run:"Run",settings:"Settings"};
const ENGINE_VERSION="debug-csv-v3";
const MULTI_RUN_COUNT=10;
const SYSTEM_OUTPUT_IDS=new Set(DEFAULT_OUTPUT_FIELDS.map(field=>field.id));
const BLOCK_KEY_REASONS=new Set(["empty","format","unauthorized","forbidden"]);
const SHORT_ERROR_LABEL={
  "Lead Status Not Aligned With Comments":"Status",
  "Customer Requirement Empty":"Rq empty",
  "Incorrect Customer Requirement":"Rq wrong",
  "Customer Comment Quality Not Appropriate":"Comment quality"
};
const STATUS_HISTORY_ERROR=LAB_ERROR_TYPES[0];
const WIDE_RESULT_COLS=new Set(["observation","recommendation","comments"]);

function formatResultCell(fieldId,value){
  const text=String(value??"").trim();
  if(!text)return fieldId==="errorTypes"?"None":"—";
  return text;
}

function resultColumns(rawSettings){
  return selectedOutputFields(normalizeSettings(rawSettings));
}

function refreshResultsTable(){
  if(currentJob)renderResultsPanel(currentJob);
}

function normalizeDebugSettings(saved={}){
  const merged=normalizeSettings(saved);
  const prompts={...emptyErrorPrompts()};
  const incoming=saved.errorPrompts&&typeof saved.errorPrompts==="object"?saved.errorPrompts:{};
  for(const label of LAB_ERROR_TYPES){
    prompts[label]=String(incoming[label]??"");
  }
  const legacy=String(saved.customPrompt??merged.customPrompt??"").trim();
  const promptsEmpty=LAB_ERROR_TYPES.every(label=>!String(prompts[label]||"").trim());
  if(legacy&&promptsEmpty){
    prompts[LAB_ERROR_TYPES[0]]=legacy;
  }
  merged.errorPrompts=prompts;
  merged.activeErrorTypes=normalizeActiveErrorTypes(saved.activeErrorTypes);
  let focus=String(saved.focusErrorType||"").trim();
  if(!LAB_ERROR_TYPES.includes(focus))focus=merged.activeErrorTypes[0]||LAB_ERROR_TYPES[0];
  if(!merged.activeErrorTypes.includes(focus))focus=merged.activeErrorTypes[0];
  merged.focusErrorType=focus;
  delete merged.customPrompt;
  return merged;
}

const DEFAULT_DEBUG_SETTINGS=normalizeDebugSettings({
  ...DEFAULT_SETTINGS,
  errorPrompts:emptyErrorPrompts(),
  activeErrorTypes:[LAB_ERROR_TYPES[0]],
  focusErrorType:LAB_ERROR_TYPES[0]
});

let currentJob=null,displayLogs=true,parsedFile=null,serverKeyConfigured=false;
/** Kept after Start so Re-Audit can rerun without re-upload (same leads/job input). */
let loadedBundle=null;
let multiRunActive=false;
let multiRunProgress={current:0,total:MULTI_RUN_COUNT};
/** project\u0001mobile keys currently re-auditing from the Results table. */
const rowReAuditKeys=new Set();
const rowReAuditControllers=new Map();
/** Progress for per-row 10× re-audit: key → {current,total}. */
const rowTenReAuditProgress=new Map();
let settings=normalizeDebugSettings(DEFAULT_DEBUG_SETTINGS);
let resultFilter="all";
const controllers=new Map();
const compareControllers=new Map();

function loadDebugSettingsLocal(defaults){
  try{return{...defaults,...JSON.parse(localStorage.getItem(storageKey("debugSettings"))||"{}")};}
  catch{return{...defaults};}
}
function saveDebugSettingsLocal(next){
  localStorage.setItem(storageKey("debugSettings"),JSON.stringify(next));
}

function deepCopy(value){return JSON.parse(JSON.stringify(value));}
function number(value){return Number.isFinite(Number(value))?Number(value):0;}
function timestamp(){return new Date().toISOString();}
function toast(message){
  if(!els.toast)return;
  els.toast.textContent=message;
  els.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer=setTimeout(()=>els.toast.classList.remove("show"),3200);
}

function parseErrorList(value){
  const text=String(value??"").trim();
  if(!text||/^none$/i.test(text))return[];
  return text.split(",").map(part=>part.trim()).filter(Boolean);
}

function resultLeadKey(row){
  const project=String(row?.project??"").trim().toLowerCase();
  const mobile=String(row?.mobile??"").trim().toLowerCase();
  return`${project}\u0001${mobile}`;
}

function leadsForResultRow(job,row){
  const key=resultLeadKey(row);
  if(!key||key==="\u0001")return[];
  const match=lead=>{
    const sv=lead?.staticValues||{};
    if(resultLeadKey(sv)===key)return true;
    const groupKey=String(lead?.groupId||"").trim().toLowerCase();
    const expected=`${String(row?.project??"").trim().toLowerCase()} | ${String(row?.mobile??"").trim().toLowerCase()}`;
    return Boolean(groupKey)&&groupKey===expected;
  };
  const fromJob=(job?.leads||[]).filter(match);
  if(fromJob.length)return fromJob;
  return(loadedBundle?.leads||[]).filter(match);
}

/** Clone a lead and keep auditContext.c as the full chronological comment array. */
function withFullCommentHistory(lead){
  const next={
    ...lead,
    staticValues:{...(lead.staticValues||{})},
    auditContext:{...(lead.auditContext||{})},
    localErrors:Array.isArray(lead.localErrors)?[...lead.localErrors]:lead.localErrors
  };
  const c=next.auditContext.c;
  if(Array.isArray(c)&&c.length){
    next.auditContext.c=c.map(entry=>String(entry??""));
  }else if(typeof c==="string"&&c.trim()){
    next.auditContext.c=[c];
  }else if(next.staticValues.comments){
    next.auditContext.c=[String(next.staticValues.comments)];
  }else{
    next.auditContext.c=[];
  }
  return next;
}

function resultsTableColSpan(columns,multiRunStats){
  return(columns?.length||1)+(multiRunStats?1:0)+1;
}

/** Per lead: count each error label (and "None") across repeated runs — one increment per run per lead. */
function aggregatePerLeadFrequencies(resultSets){
  const byLead=new Map();
  for(const results of resultSets||[]){
    for(const row of results||[]){
      const key=resultLeadKey(row);
      if(!byLead.has(key))byLead.set(key,new Map());
      const counts=byLead.get(key);
      const errors=parseErrorList(row?.errorTypes);
      if(!errors.length){
        counts.set("None",(counts.get("None")||0)+1);
      }else{
        for(const label of errors){
          counts.set(label,(counts.get(label)||0)+1);
        }
      }
    }
  }
  const out=new Map();
  for(const [key,counts] of byLead){
    out.set(key,[...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])));
  }
  return out;
}

function renderLeadFrequencyMini(container,entries,runCount){
  if(!container)return;
  container.replaceChildren();
  container.className="debug-lead-freq-mini";
  if(!entries?.length){
    container.textContent="—";
    return;
  }
  const max=Math.max(runCount,...entries.map(([,count])=>count),1);
  for(const [label,count] of entries){
    const row=document.createElement("div");
    row.className="debug-freq-row debug-freq-row-mini";
    const name=document.createElement("div");
    name.className="debug-freq-label";
    name.textContent=shortLabel(label);
    name.title=label;
    const wrap=document.createElement("div");
    wrap.className="debug-freq-bar-wrap";
    const bar=document.createElement("div");
    bar.className="debug-freq-bar";
    bar.style.width=`${Math.max(2,Math.round(count/max*100))}%`;
    bar.title=`${label}: ${count}/${runCount}`;
    const value=document.createElement("span");
    value.className="debug-freq-count";
    value.textContent=String(count);
    wrap.append(bar,value);
    row.append(name,wrap);
    container.append(row);
  }
}

function shortLabel(label){return SHORT_ERROR_LABEL[label]||label;}

function effectiveApiKey(){
  const local=getApiKey();
  if(local)return local;
  if(serverKeyConfigured)return SERVER_API_KEY;
  return"";
}

function showView(name){
  document.querySelectorAll(".view").forEach(view=>view.classList.toggle("active",view.id===`view-${name}`));
  document.querySelectorAll(".nav-item").forEach(button=>button.classList.toggle("active",button.dataset.view===name));
  if(els["page-title"])els["page-title"].textContent=titles[name]||titles.run;
  document.querySelector(".shell")?.classList.remove("menu-open");
  if(name==="settings")renderSettings();
  if(name==="run")renderActiveChips();
}

function updateKeyState(){
  const ready=Boolean(effectiveApiKey());
  let label="API key not set";
  if(getApiKey())label="API key ready";
  else if(serverKeyConfigured)label="Server API key ready";
  if(els["key-state"]){
    els["key-state"].textContent=label;
    els["key-state"].classList.toggle("ready",ready);
  }
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
    if(serverKeyConfigured){
      hint.textContent="Server API key is saved (encrypted). Paste a new key and click Save to server to replace it.";
    }else{
      hint.textContent="Paste your OpenAI key and click Save to server so DeBug Mode can run via the proxy.";
    }
    hint.classList.remove("hidden");
  }
  if(saveBtn)saveBtn.textContent="Save to server";
  if(keyInput)keyInput.placeholder="sk-…";
  if(rememberLabel)rememberLabel.classList.remove("hidden");
  if(forgetBtn){
    const hasLocal=Boolean(getApiKey());
    forgetBtn.textContent=serverKeyConfigured?"Clear server key":(hasLocal?"Forget local key":"Forget key");
    forgetBtn.classList.toggle("hidden",!serverKeyConfigured&&!hasLocal&&!isSuper);
  }
}

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
      if(messageEl)messageEl.textContent=result.ok?"Saved to server.":(result.message||"Saved to server (key check soft-failed).");
    }catch(err){
      if(messageEl)messageEl.textContent=err.message||"Could not save server key";
      return false;
    }
  }else{
    saveApiKey(trimmed,remember);
    if(messageEl)messageEl.textContent=result.ok?"Saved on this device.":(result.message||"Saved locally (key check soft-failed).");
  }
  updateKeyState();
  syncApiKeySettingsUi();
  return true;
}

function openKeyModal(){
  if(serverKeyConfigured||effectiveApiKey())return;
  els["key-modal"]?.classList.remove("hidden");
  setTimeout(()=>els["onboard-key"]?.focus(),60);
}
function closeKeyModal(){els["key-modal"]?.classList.add("hidden");}

function addLog(job,message,level="info"){
  job.logs=job.logs||[];
  job.logs.push({at:timestamp(),level,message});
  if(job.logs.length>1200)job.logs=job.logs.slice(-1200);
  if(currentJob?.id===job.id)renderLogs(job);
}
function renderLogs(job){
  if(!els["live-log"])return;
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
  const live=job.status==="running"&&job.runStartedAt?Date.now()-new Date(job.runStartedAt).valueOf():0;
  return(job.elapsedMs||0)+live;
}
function durationText(ms){
  const seconds=Math.max(0,Math.floor(ms/1000)),minutes=Math.floor(seconds/60);
  return minutes?`${minutes}m ${seconds%60}s`:`${seconds}s`;
}
function estimatedCost(job){
  const usage=job.tokenUsage||{input:0,cached:0,output:0};
  const rates=job.pricing||settings.pricing||{};
  return Math.max(0,(number(usage.input)-number(usage.cached))*number(rates.input)/1e6+number(usage.cached)*number(rates.cached)/1e6+number(usage.output)*number(rates.output)/1e6);
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
  return keys.size||job.totalLeads||0;
}
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
function pendingResultCount(job){
  return Object.values(job.pendingBatches||{}).reduce((n,rows)=>n+(Array.isArray(rows)?rows.length:0),0);
}
function auditedDoneCount(job){
  return(job.results?.length||0)+pendingResultCount(job);
}

function activeForJob(job){
  return normalizeActiveErrorTypes(job?.settings?.activeErrorTypes||settings.activeErrorTypes);
}

function renderActiveChips(active=settings.activeErrorTypes){
  const box=els["debug-active-chips"];
  if(!box)return;
  const list=normalizeActiveErrorTypes(active);
  box.replaceChildren();
  const title=document.createElement("span");
  title.className="debug-chip-label";
  title.textContent=`Running with ${list.length} error${list.length===1?"":"s"}:`;
  box.append(title);
  for(const label of list){
    const chip=document.createElement("span");
    chip.className="debug-chip";
    chip.textContent=shortLabel(label);
    chip.title=label;
    box.append(chip);
  }
}

function renderErrorFocusSettings(){
  const checks=els["error-type-checks"];
  const focusSelect=els["focus-error-type"];
  const hint=els["error-run-hint"];
  const textarea=els["error-prompt"];
  if(!checks||!focusSelect||!textarea)return;
  const active=new Set(settings.activeErrorTypes);
  checks.replaceChildren();
  for(const label of LAB_ERROR_TYPES){
    const row=document.createElement("label");
    row.className="check-row debug-error-check";
    const input=document.createElement("input");
    input.type="checkbox";
    input.checked=active.has(label);
    input.dataset.errorLabel=label;
    input.addEventListener("change",()=>{
      settings=collectSettings();
      if(!settings.activeErrorTypes.length){
        settings.activeErrorTypes=[label];
        input.checked=true;
      }
      if(!settings.activeErrorTypes.includes(settings.focusErrorType)){
        settings.focusErrorType=settings.activeErrorTypes[0];
      }
      renderErrorFocusSettings();
      renderActiveChips();
    });
    const span=document.createElement("span");
    span.textContent=label;
    row.append(input,span);
    checks.append(row);
  }
  focusSelect.replaceChildren();
  for(const label of LAB_ERROR_TYPES){
    const option=document.createElement("option");
    option.value=label;
    option.textContent=label;
    option.selected=label===settings.focusErrorType;
    focusSelect.append(option);
  }
  textarea.value=settings.errorPrompts?.[settings.focusErrorType]||"";
  const syncBtn=els["sync-status-from-audit"];
  if(syncBtn){
    const isStatus=settings.focusErrorType===STATUS_HISTORY_ERROR;
    syncBtn.hidden=!isStatus;
    syncBtn.disabled=!isStatus;
  }
  const pushBtn=els["push-prompt-to-audit"];
  if(pushBtn){
    const isSuper=Boolean(getUser()?.is_super);
    pushBtn.hidden=!isSuper;
    pushBtn.disabled=!isSuper;
    pushBtn.title=isSuper
      ? "Sync this prompt into TeleCaller Bucket 1 audit settings (server audit_settings) for everyone"
      : "Super User only";
  }
  if(hint){
    const list=settings.activeErrorTypes;
    hint.textContent=`Running with ${list.length} error(s): ${list.map(shortLabel).join(", ")}`;
  }
}

function resultHasActiveAiError(row,active){
  const errors=parseErrorList(row?.errorTypes);
  return errors.some(label=>active.includes(label));
}

function countResultsByError(job){
  const active=activeForJob(job);
  const counts=Object.fromEntries(active.map(label=>[label,0]));
  let flagged=0,clean=0;
  for(const row of job?.results||[]){
    const errors=parseErrorList(row.errorTypes);
    const hit=errors.filter(label=>active.includes(label));
    if(hit.length){
      flagged++;
      for(const label of hit)counts[label]=(counts[label]||0)+1;
    }else clean++;
  }
  return{counts,flagged,clean,total:(job?.results||[]).length,active};
}

function filteredResults(job){
  const rows=job?.results||[];
  const active=activeForJob(job);
  if(resultFilter==="all")return rows;
  if(resultFilter==="flagged")return rows.filter(row=>resultHasActiveAiError(row,active));
  if(resultFilter==="clean")return rows.filter(row=>!resultHasActiveAiError(row,active));
  return rows.filter(row=>parseErrorList(row.errorTypes).includes(resultFilter));
}

function syncRunActionButtons(job=currentJob){
  const hasLeads=Boolean((loadedBundle?.leads||[]).length||(job?.leads||[]).length);
  const busy=multiRunActive||job?.status==="running"||job?.compareStatus==="running";
  for(const id of ["re-audit","re-audit-panel"]){
    const btn=els[id]||document.getElementById(id);
    if(!btn)continue;
    btn.disabled=!hasLeads||busy;
  }
  for(const id of ["run-ten-times","run-ten-times-panel"]){
    const btn=els[id]||document.getElementById(id);
    if(!btn)continue;
    btn.disabled=!hasLeads||busy;
    btn.textContent=multiRunActive?`Running ${multiRunProgress.current}/${multiRunProgress.total}…`:"Run 10 times";
  }
  if(els["start-debug"])els["start-debug"].disabled=!(parsedFile?.leads||[]).length||multiRunActive;
}

function renderResultsPanel(job){
  const panel=els["debug-results-panel"];
  if(!panel)return;
  if(!job||!(job.results||[]).length||!["completed","failed","paused"].includes(job.status)){
    panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");
  const {counts,flagged,clean,total,active}=countResultsByError(job);
  const countBox=els["debug-error-counts"];
  if(countBox){
    countBox.replaceChildren();
    const addMetric=(label,value)=>{
      const div=document.createElement("div");
      const span=document.createElement("span");
      span.textContent=label;
      const strong=document.createElement("strong");
      strong.textContent=String(value);
      div.append(span,strong);
      countBox.append(div);
    };
    addMetric("Rows",total);
    addMetric("Flagged",flagged);
    addMetric("Clean",clean);
    for(const label of active)addMetric(shortLabel(label),counts[label]||0);
  }
  const filters=els["debug-result-filters"];
  if(filters){
    filters.replaceChildren();
    const makeBtn=(id,label)=>{
      const btn=document.createElement("button");
      btn.type="button";
      btn.className=`debug-filter-chip${resultFilter===id?" active":""}`;
      btn.textContent=label;
      btn.onclick=()=>{resultFilter=id;renderResultsPanel(job);};
      filters.append(btn);
    };
    makeBtn("all","All");
    makeBtn("flagged",`Flagged (${flagged})`);
    makeBtn("clean",`Clean (${clean})`);
    for(const label of active)makeBtn(label,`${shortLabel(label)} (${counts[label]||0})`);
  }
  const body=els["debug-results-body"];
  const head=els["debug-results-head"];
  const live=collectSettings();
  const columns=resultColumns(live);
  const multiRunStats=job.multiRunStats;
  const multiRunCount=job.multiRunMeta?.runsCompleted||0;
  if(head){
    head.replaceChildren();
    if(!columns.length){
      const th=document.createElement("th");
      th.textContent="Output columns";
      head.append(th);
    }else{
      for(const field of columns){
        const th=document.createElement("th");
        th.textContent=field.label;
        head.append(th);
      }
      if(multiRunStats){
        const th=document.createElement("th");
        th.textContent=`${multiRunCount}-run consistency`;
        th.className="debug-consistency-col";
        head.append(th);
      }
      const actionTh=document.createElement("th");
      actionTh.textContent="Actions";
      actionTh.className="debug-actions-col";
      head.append(actionTh);
    }
  }
  if(body){
    body.replaceChildren();
    if(!columns.length){
      const tr=document.createElement("tr");
      const td=document.createElement("td");
      td.colSpan=1;
      td.className="empty-state";
      td.textContent="Enable at least one column in Settings → Output Excel.";
      tr.append(td);
      body.append(tr);
      return;
    }
    const rows=sortResults(filteredResults(job),live);
    const colSpan=resultsTableColSpan(columns,multiRunStats);
    const rowBusyBlocked=multiRunActive||job.status==="running"||job.compareStatus==="running";
    if(!rows.length){
      const tr=document.createElement("tr");
      const td=document.createElement("td");
      td.colSpan=colSpan;
      td.className="empty-state";
      td.textContent="No rows match this filter.";
      tr.append(td);
      body.append(tr);
    }else{
      for(const row of rows.slice(0,400)){
        const tr=document.createElement("tr");
        for(const field of columns){
          const text=formatResultCell(field.id,row[field.id]);
          const td=document.createElement("td");
          td.textContent=text;
          if(field.id==="errorTypes")td.className="debug-errors-cell";
          if(WIDE_RESULT_COLS.has(field.id)){
            td.className="debug-obs-cell";
            td.title=text;
          }
          tr.append(td);
        }
        if(multiRunStats){
          const td=document.createElement("td");
          td.className="debug-consistency-cell";
          renderLeadFrequencyMini(td,multiRunStats.get(resultLeadKey(row)),multiRunCount);
          tr.append(td);
        }
        const actionTd=document.createElement("td");
        actionTd.className="debug-actions-cell";
        const rowKey=resultLeadKey(row);
        const auditing=rowReAuditKeys.has(rowKey);
        const tenProgress=rowTenReAuditProgress.get(rowKey);
        const rowInvalid=!rowKey||rowKey==="\u0001";
        const btn=document.createElement("button");
        btn.type="button";
        btn.className="secondary-button debug-row-reaudit";
        btn.textContent=auditing&&!tenProgress?"Re-Auditing…":"Re-Audit";
        btn.disabled=rowBusyBlocked||auditing||rowInvalid;
        btn.title="Re-audit this lead with full comment history using current settings";
        btn.onclick=()=>reAuditResultRow(job,row);
        const btnTen=document.createElement("button");
        btnTen.type="button";
        btnTen.className="secondary-button debug-row-reaudit";
        btnTen.textContent=tenProgress?`Running ${tenProgress.current}/${tenProgress.total}…`:"Re-Audit 10×";
        btnTen.disabled=rowBusyBlocked||auditing||rowInvalid;
        btnTen.title="Re-audit this lead 10 times with full comment history; updates consistency bars";
        btnTen.onclick=()=>reAuditResultRowTenTimes(job,row);
        actionTd.append(btn,btnTen);
        tr.append(actionTd);
        body.append(tr);
      }
    }
  }
}

function renderComparePanel(job){
  const panel=els["debug-compare-panel"];
  if(!panel)return;
  const cmp=job?.compare;
  if(!cmp){
    panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");
  if(els["debug-compare-summary"]){
    const parts=[
      `Active AI errors: ${cmp.active.map(shortLabel).join(", ")}.`,
      `Agreement ${cmp.agreement}/${cmp.total}.`,
      `Stock TeleCaller handbook + audit_settings (not DeBug prompts).`
    ];
    if(cmp.unmatched)parts.push(`Unmatched rows: ${cmp.unmatched}.`);
    if(cmp.teleTotal!=null&&cmp.teleTotal!==cmp.total)parts.push(`TeleCaller rows: ${cmp.teleTotal}.`);
    els["debug-compare-summary"].textContent=parts.join(" ");
  }
  const metrics=els["debug-compare-metrics"];
  if(metrics){
    metrics.replaceChildren();
    const add=(label,value)=>{
      const div=document.createElement("div");
      const span=document.createElement("span");
      span.textContent=label;
      const strong=document.createElement("strong");
      strong.textContent=String(value);
      div.append(span,strong);
      metrics.append(div);
    };
    add("Total",cmp.total);
    add("Agreement",cmp.agreement);
    add("Only DeBug",cmp.onlyDebug);
    add("Only TeleCaller",cmp.onlyTele);
  }
  const body=els["debug-compare-body"];
  if(body){
    body.replaceChildren();
    if(!cmp.rows.length){
      const tr=document.createElement("tr");
      const td=document.createElement("td");
      td.colSpan=6;
      td.textContent="No differences on active AI errors.";
      tr.append(td);
      body.append(tr);
    }else{
      for(const row of cmp.rows.slice(0,400)){
        const tr=document.createElement("tr");
        const obs=row.debugObservation||"—";
        for(const text of [
          row.mobile||"—",
          row.status||"—",
          row.onlyDebug.join(", ")||"—",
          row.onlyTele.join(", ")||"—",
          row.both.join(", ")||"—",
          obs
        ]){
          const td=document.createElement("td");
          td.textContent=text;
          if(text===obs){td.className="debug-obs-cell";td.title=obs;}
          tr.append(td);
        }
        body.append(tr);
      }
    }
  }
}

function renderProgress(job){
  if(!job)return;
  currentJob=job;
  const totalAudited=job.totalLeads||0,done=auditedDoneCount(job),pct=totalAudited?Math.round(Math.min(done,totalAudited)/totalAudited*100):0;
  const batches=leadBatchCount(job),usage=job.tokenUsage||{};
  const concurrency=job.settings?.concurrency||1;
  const billable=Math.max(0,number(usage.input)-number(usage.cached));
  const pendingLeft=Object.keys(job.pendingBatches||{}).length;
  if(els["progress-label"])els["progress-label"].textContent=multiRunActive
    ?`Multi-run ${multiRunProgress.current}/${multiRunProgress.total} · ${job.status==="running"?`${pct}% of current run`:"between runs"}`
    :job.status==="completed"
    ?"DeBug complete"
    :job.status==="running"
    ?`Keeping ${concurrency} batch request${concurrency>1?"s":""} in flight${pendingLeft?` · ${pendingLeft} batch(es) waiting to checkpoint`:""}…`
    :job.status==="paused"?"DeBug paused — ready to resume":job.status==="failed"?"DeBug stopped":"Waiting for a file";
  if(els["progress-percent"])els["progress-percent"].textContent=`${pct}%`;
  if(els["progress-bar"])els["progress-bar"].style.width=`${pct}%`;
  if(els["metric-leads"])els["metric-leads"].textContent=uniqueLeadCount(job)||"—";
  if(els["metric-calls"])els["metric-calls"].textContent=job.callCount!=null?Number(job.callCount).toLocaleString():"—";
  if(els["metric-batch"])els["metric-batch"].textContent=batches?`${Math.min((job.nextBatch||0)+1,batches)} / ${batches}`:"—";
  if(els["metric-completed"])els["metric-completed"].textContent=totalAudited?`${done} / ${totalAudited}`:"—";
  if(els["metric-status"])els["metric-status"].textContent=job.status?job.status[0].toUpperCase()+job.status.slice(1):"Idle";
  if(els["metric-input-tokens"])els["metric-input-tokens"].textContent=`${number(usage.input).toLocaleString()} (${billable.toLocaleString()} billable)`;
  if(els["metric-cached-tokens"])els["metric-cached-tokens"].textContent=number(usage.cached).toLocaleString();
  if(els["metric-output-tokens"])els["metric-output-tokens"].textContent=number(usage.output).toLocaleString();
  if(els["metric-duration"])els["metric-duration"].textContent=durationText(elapsed(job));
  if(els["metric-cost"])els["metric-cost"].textContent=estimatedCost(job).toFixed(4);
  if(els["pause-run"]){
    els["pause-run"].disabled=multiRunActive||!(["running","paused","failed"].includes(job.status));
    els["pause-run"].textContent=job.status==="running"?"Pause":"Resume";
  }
  if(els["download-result"])els["download-result"].disabled=multiRunActive||job.status!=="completed";
  if(els["compare-telecaller"]){
    els["compare-telecaller"].disabled=multiRunActive||job.status!=="completed"||job.compareStatus==="running"||job.status==="running";
    els["compare-telecaller"].textContent=job.compareStatus==="running"?"Comparing…":"Compare to TeleCaller Audit";
  }
  syncRunActionButtons(job);
  renderActiveChips(activeForJob(job));
  renderResultsPanel(job);
  renderComparePanel(job);
  renderLogs(job);
}

function throttleProgress(job){
  if(currentJob?.id!==job.id)return;
  if(throttleProgress._timer)return;
  throttleProgress._timer=setTimeout(()=>{
    throttleProgress._timer=null;
    if(currentJob?.id===job.id)renderProgress(currentJob);
  },200);
}

function commitBatch(job,index,rows){
  job.pendingBatches=job.pendingBatches||{};
  if(rows&&job.pendingBatches[String(index)]===undefined){
    job.pendingBatches[String(index)]=rows;
    throttleProgress(job);
  }
  let merged=0;
  const from=job.nextBatch;
  while(job.pendingBatches[String(job.nextBatch)]){
    job.results.push(...job.pendingBatches[String(job.nextBatch)]);
    delete job.pendingBatches[String(job.nextBatch)];
    job.nextBatch+=1;
    merged++;
  }
  if(merged){
    job.updatedAt=timestamp();
    addLog(job,merged===1
      ?`Checkpoint batch ${from+1}. ${auditedDoneCount(job)}/${job.totalLeads} audited.`
      :`Checkpoint batches ${from+1}–${job.nextBatch}. ${auditedDoneCount(job)}/${job.totalLeads} audited.`);
  }else{
    addLog(job,`Batch ${index+1} API done (${rows?.length||0} audited) — waiting for earlier batches.`);
  }
  throttleProgress(job);
}

function flushPendingBatches(job){
  job.pendingBatches=job.pendingBatches||{};
  while(job.pendingBatches[String(job.nextBatch)]){
    job.results.push(...job.pendingBatches[String(job.nextBatch)]);
    delete job.pendingBatches[String(job.nextBatch)];
    job.nextBatch+=1;
  }
  job.updatedAt=timestamp();
}

async function runJob(job){
  if(controllers.has(job.id)){toast("That DeBug run is already running.");return;}
  const key=effectiveApiKey();
  if(!key){showView("settings");toast("Add an OpenAI API key first.");return;}
  if(key!==SERVER_API_KEY&&!/^sk-[A-Za-z0-9_-]{20,}$/.test(key)){showView("settings");toast("That does not look like an OpenAI API key.");return;}
  const ready=activePromptsReady(job.settings||settings);
  if(!ready.ok){showView("settings");toast(`Fill prompts for: ${ready.missing.map(shortLabel).join(", ")}`);return;}

  const controller=new AbortController();
  controllers.set(job.id,controller);
  currentJob=job;
  job.status="running";
  job.error="";
  job.startedAt=job.startedAt||timestamp();
  job.runStartedAt=timestamp();
  job.finishedAt="";
  job.tokenUsage=job.tokenUsage||{input:0,cached:0,output:0};
  job.elapsedMs=job.elapsedMs||0;
  job.pendingBatches=job.pendingBatches||{};
  job.results=Array.isArray(job.results)?job.results:[];
  job.leads=Array.isArray(job.leads)?job.leads:[];
  job.compare=null;
  job.compareStatus="";
  job.telecallerResults=null;
  compareControllers.get(job.id)?.abort();
  compareControllers.delete(job.id);
  displayLogs=true;
  resultFilter="all";

  const concurrency=Math.min(MAX_CONCURRENCY,Math.max(1,Number(job.settings.concurrency)||1));
  const active=activeForJob(job);
  addLog(job,`DeBug started: ${active.length} error(s) [${active.map(shortLabel).join(", ")}], pool ${concurrency}, batch ${job.settings.batchSize}, model ${job.settings.model}, app ${APP_VERSION}.`);
  renderProgress(job);
  els["debug-run-panel"]?.classList.remove("hidden");

  const batchSize=Math.max(1,Number(job.settings.batchSize)||1);
  const leadGroups=groupCallRowsByLead(job.leads);
  const totalBatches=Math.ceil(leadGroups.length/batchSize);
  const pending=job.pendingBatches||{};
  const queue=[];
  for(let index=0;index<totalBatches;index++){
    if(index<job.nextBatch)continue;
    if(pending[String(index)])continue;
    queue.push(index);
  }
  flushPendingBatches(job);

  const persistUsage=usage=>{
    job.tokenUsage.input+=usage.input;
    job.tokenUsage.cached+=usage.cached;
    job.tokenUsage.output+=usage.output;
    throttleProgress(job);
  };

  let fatalError=null;
  let launched=0;
  const quietLogs=concurrency>=4;
  const workers=Array.from({length:Math.min(concurrency,Math.max(queue.length,1))},async()=>{
    while(!fatalError&&!controller.signal.aborted){
      const index=queue.shift();
      if(index===undefined)return;
      const leadSlice=leadGroups.slice(index*batchSize,(index+1)*batchSize);
      const batch=leadSlice.flat();
      launched++;
      if(!quietLogs||launched<=concurrency||launched%concurrency===1||index===totalBatches-1){
        addLog(job,`Dispatch batch ${index+1}/${totalBatches} (${leadSlice.length} leads · ${batch.length} call${batch.length===1?"":"s"}) · composed prompts.`);
      }
      throttleProgress(job);
      try{
        const rows=await debugAuditBatch(
          key,
          job.settings,
          batch,
          controller.signal,
          quietLogs?(message,level)=>{if(level==="error"||level==="warn")addLog(job,message,level);}:((message,level)=>addLog(job,message,level)),
          persistUsage
        );
        commitBatch(job,index,rows);
      }catch(error){
        if(error.name==="AbortError"){
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
    flushPendingBatches(job);
    if(fatalError)throw fatalError;
    if(job.nextBatch<totalBatches)throw new Error("DeBug stopped before all batches finished. Resume to continue.");
    job.status="completed";
    job.pendingBatches={};
    stopClock(job);
    job.updatedAt=timestamp();
    const billable=Math.max(0,number(job.tokenUsage.input)-number(job.tokenUsage.cached));
    addLog(job,`DeBug complete in ${durationText(job.elapsedMs)}. Cost est. ${estimatedCost(job).toFixed(4)}. Cached ${number(job.tokenUsage.cached).toLocaleString()} · billable input ${billable.toLocaleString()} · output ${number(job.tokenUsage.output).toLocaleString()}.`,"success");
    renderProgress(job);
    if(!multiRunActive)toast(`${job.fileName}: DeBug complete.`);
  }catch(error){
    flushPendingBatches(job);
    stopClock(job);
    if(error.name==="AbortError"){
      job.status="paused";
      addLog(job,"DeBug paused. Completed batches are kept in memory — resume to continue.","warn");
    }else{
      job.status="failed";
      job.error=error.message||String(error);
      addLog(job,`FAILED: ${job.error}`,"error");
    }
    job.updatedAt=timestamp();
    renderProgress(job);
  }finally{
    controllers.delete(job.id);
  }
}

async function runTelecallerCompare(job){
  if(!job||job.status!=="completed"){
    toast("Finish a DeBug run before Compare.");
    return;
  }
  if(!(job.results||[]).length){
    toast("No DeBug results to compare.");
    return;
  }
  if(!(job.leads||[]).length){
    toast("No leads in memory for Compare.");
    return;
  }
  if(job.compareStatus==="running")return;
  const key=effectiveApiKey();
  if(!key){showView("settings");toast("Add an OpenAI API key first.");return;}

  // Abort any prior compare for this job.
  compareControllers.get(job.id)?.abort();
  const controller=new AbortController();
  compareControllers.set(job.id,controller);

  job.compare=null;
  job.compareStatus="running";
  job.telecallerResults=null;
  renderProgress(job);
  addLog(job,"Compare: loading TeleCaller audit_settings, then stock handbook audit on the same leads…");

  try{
    let auditSettings=normalizeSettings(DEFAULT_SETTINGS);
    let settingsSource="defaults";
    try{
      const payload=await SettingsApi.getAudit();
      if(payload?.settings&&typeof payload.settings==="object"){
        auditSettings=normalizeSettings(payload.settings);
        settingsSource="server audit_settings";
      }
    }catch(err){
      addLog(job,`Compare: could not load audit_settings (${err.message||err}); using defaults.`,"warn");
    }
    // Throughput only — never reuse DeBug model/prompts/error focus.
    auditSettings={
      ...auditSettings,
      batchSize:Math.max(1,Number(job.settings?.batchSize)||Number(auditSettings.batchSize)||1),
      concurrency:Math.min(MAX_CONCURRENCY,Math.max(1,Number(job.settings?.concurrency)||Number(auditSettings.concurrency)||1)),
      model:String(auditSettings.model||DEFAULT_SETTINGS.model).trim()||DEFAULT_SETTINGS.model
    };
    delete auditSettings.errorPrompts;
    delete auditSettings.activeErrorTypes;
    delete auditSettings.focusErrorType;
    delete auditSettings.customPrompt;

    addLog(job,`Compare: TeleCaller path · ${settingsSource} · model ${auditSettings.model} · batch ${auditSettings.batchSize} · pool ${auditSettings.concurrency}.`);

    const concurrency=auditSettings.concurrency;
    const batchSize=auditSettings.batchSize;
    const leadGroups=groupCallRowsByLead(job.leads);
    const totalBatches=Math.ceil(leadGroups.length/batchSize)||0;
    if(!totalBatches)throw new Error("No lead batches to compare.");

    const teleResults=new Array(totalBatches);
    const queue=[...Array(totalBatches).keys()];
    const persistUsage=usage=>{
      job.tokenUsage=job.tokenUsage||{input:0,cached:0,output:0};
      job.tokenUsage.input+=usage.input;
      job.tokenUsage.cached+=usage.cached;
      job.tokenUsage.output+=usage.output;
      throttleProgress(job);
    };
    let fatalError=null;
    const workers=Array.from({length:Math.min(concurrency,Math.max(queue.length,1))},async()=>{
      while(!fatalError&&!controller.signal.aborted){
        const index=queue.shift();
        if(index===undefined)return;
        const batch=leadGroups.slice(index*batchSize,(index+1)*batchSize).flat();
        try{
          const rows=await telecallerAuditBatch(
            key,
            auditSettings,
            batch,
            controller.signal,
            (message,level)=>addLog(job,`TeleCaller · ${message}`,level),
            persistUsage
          );
          teleResults[index]=rows;
        }catch(error){
          if(error.name==="AbortError"){
            if(!fatalError)fatalError=error;
            queue.length=0;
            return;
          }
          fatalError=error;
          queue.length=0;
          controller.abort();
        }
      }
    });
    await Promise.all(workers);
    if(fatalError)throw fatalError;

    // Preserve batch order (dense) — do not flatMap sparse holes.
    const flat=[];
    for(let i=0;i<totalBatches;i++){
      const rows=teleResults[i];
      if(!Array.isArray(rows))throw new Error(`TeleCaller batch ${i+1}/${totalBatches} missing after Compare.`);
      flat.push(...rows);
    }
    if(flat.length!==(job.results||[]).length){
      addLog(job,`Compare: row count DeBug ${job.results.length} vs TeleCaller ${flat.length} — pairing by index then key.`,"warn");
    }
    job.telecallerResults=flat;
    job.compare=compareDebugVsTelecaller(job.results,flat,activeForJob(job));
    job.compareStatus="done";
    addLog(job,`Compare done: agreement ${job.compare.agreement}/${job.compare.total}, only-DeBug ${job.compare.onlyDebug}, only-TeleCaller ${job.compare.onlyTele}.`,"success");
    toast("Compare complete.");
  }catch(error){
    job.compareStatus="failed";
    const msg=error?.name==="AbortError"?"Compare aborted.":(error.message||String(error));
    addLog(job,`Compare failed: ${msg}`,"error");
    toast(msg||"Compare failed");
  }finally{
    compareControllers.delete(job.id);
    renderProgress(job);
  }
}

function buildJobFromBundle(bundle,liveSettings){
  return{
    id:crypto.randomUUID(),
    engineVersion:ENGINE_VERSION,
    appVersion:APP_VERSION,
    mode:"debug",
    fileName:bundle.fileName,
    sheetName:bundle.sheetName||"",
    createdAt:timestamp(),
    updatedAt:timestamp(),
    status:"queued",
    totalLeads:bundle.leads.length,
    leadCount:bundle.leadCount||0,
    callCount:bundle.callCount||bundle.leads.length,
    latestDayCalls:bundle.latestDayCalls||bundle.leads.length,
    rowCount:bundle.rowCount||0,
    nextBatch:0,
    pendingBatches:{},
    leads:bundle.leads,
    results:[],
    logs:[],
    tokenUsage:{input:0,cached:0,output:0},
    elapsedMs:0,
    pricing:deepCopy(liveSettings.pricing),
    settings:deepCopy(liveSettings),
    compare:null,
    compareStatus:"",
    telecallerResults:null
  };
}

async function abortInFlight(job){
  if(!job)return;
  compareControllers.get(job.id)?.abort();
  compareControllers.delete(job.id);
  for(const ctrl of rowReAuditControllers.values())ctrl.abort();
  rowReAuditControllers.clear();
  rowReAuditKeys.clear();
  rowTenReAuditProgress.clear();
  const ctrl=controllers.get(job.id);
  if(ctrl){
    ctrl.abort();
    // Wait briefly for runJob finally to clear the controller map.
    for(let i=0;i<40&&controllers.has(job.id);i++)await new Promise(r=>setTimeout(r,50));
  }
}

async function reAuditResultRow(job,row){
  if(!job||!row)return;
  const key=resultLeadKey(row);
  if(!key||key==="\u0001"){
    toast("This row is missing mobile/project — cannot re-audit.");
    return;
  }
  if(rowReAuditKeys.has(key)){
    toast("That lead is already re-auditing.");
    return;
  }
  if(multiRunActive||job.status==="running"||job.compareStatus==="running"){
    toast("Wait for the current run to finish before re-auditing a row.");
    return;
  }
  const keyApi=effectiveApiKey();
  if(!keyApi){showView("settings");toast("Add an OpenAI API key first.");return;}
  const live=collectSettings();
  const ready=activePromptsReady(live);
  if(!ready.ok){showView("settings");toast(`Fill prompts for: ${ready.missing.map(shortLabel).join(", ")}`);return;}
  settings=live;
  saveDebugSettingsLocal(settings);

  const sourceLeads=leadsForResultRow(job,row);
  if(!sourceLeads.length){
    toast("Lead not found in memory — re-upload the file or run a full Re-Audit.");
    return;
  }
  const leadGroup=groupCallRowsByLead(sourceLeads)[0]||sourceLeads;
  const batch=leadGroup.map(withFullCommentHistory);
  const historyLen=Array.isArray(batch[0]?.auditContext?.c)?batch[0].auditContext.c.length:0;
  const label=`${row.mobile||"?"} · ${row.project||"?"}`;

  rowReAuditKeys.add(key);
  const controller=new AbortController();
  rowReAuditControllers.set(key,controller);
  renderResultsPanel(job);
  addLog(job,`Row Re-Audit: ${label} · full comment history (${historyLen}) · current settings (${activeForJob({settings:live}).map(shortLabel).join(", ")}).`);

  try{
    const rows=await debugAuditBatch(
      keyApi,
      live,
      batch,
      controller.signal,
      (message,level)=>addLog(job,message,level),
      usage=>{
        job.tokenUsage=job.tokenUsage||{input:0,cached:0,output:0};
        job.tokenUsage.input+=usage.input;
        job.tokenUsage.cached+=usage.cached;
        job.tokenUsage.output+=usage.output;
      }
    );
    if(!rows?.length)throw new Error("Re-audit returned no rows.");
    const next=rows[0];
    let replaced=false;
    job.results=(job.results||[]).map(existing=>{
      if(resultLeadKey(existing)!==key)return existing;
      if(replaced)return existing;
      replaced=true;
      return next;
    });
    if(!replaced)job.results.push(next);
    job.compare=null;
    job.telecallerResults=null;
    job.compareStatus="";
    job.updatedAt=timestamp();
    job.settings=deepCopy(live);
    addLog(job,`Row Re-Audit complete: ${label}.`,"success");
    toast(`Re-audited ${row.mobile||"lead"}.`);
    renderProgress(job);
  }catch(error){
    if(error.name==="AbortError"){
      addLog(job,`Row Re-Audit aborted: ${label}.`,"warn");
    }else{
      addLog(job,`Row Re-Audit FAILED (${label}): ${error.message||error}`,"error");
      toast(error.message||"Row re-audit failed.");
    }
    renderResultsPanel(job);
    renderProgress(job);
  }finally{
    rowReAuditKeys.delete(key);
    rowReAuditControllers.delete(key);
    if(currentJob?.id===job.id)renderResultsPanel(job);
  }
}

async function reAuditResultRowTenTimes(job,row){
  if(!job||!row)return;
  const key=resultLeadKey(row);
  if(!key||key==="\u0001"){
    toast("This row is missing mobile/project — cannot re-audit.");
    return;
  }
  if(rowReAuditKeys.has(key)){
    toast("That lead is already re-auditing.");
    return;
  }
  if(multiRunActive||job.status==="running"||job.compareStatus==="running"){
    toast("Wait for the current run to finish before re-auditing a row.");
    return;
  }
  const keyApi=effectiveApiKey();
  if(!keyApi){showView("settings");toast("Add an OpenAI API key first.");return;}
  const live=collectSettings();
  const ready=activePromptsReady(live);
  if(!ready.ok){showView("settings");toast(`Fill prompts for: ${ready.missing.map(shortLabel).join(", ")}`);return;}
  settings=live;
  saveDebugSettingsLocal(settings);

  const sourceLeads=leadsForResultRow(job,row);
  if(!sourceLeads.length){
    toast("Lead not found in memory — re-upload the file or run a full Re-Audit.");
    return;
  }
  const leadGroup=groupCallRowsByLead(sourceLeads)[0]||sourceLeads;
  const batch=leadGroup.map(withFullCommentHistory);
  const historyLen=Array.isArray(batch[0]?.auditContext?.c)?batch[0].auditContext.c.length:0;
  const label=`${row.mobile||"?"} · ${row.project||"?"}`;

  rowReAuditKeys.add(key);
  rowTenReAuditProgress.set(key,{current:0,total:MULTI_RUN_COUNT});
  const controller=new AbortController();
  rowReAuditControllers.set(key,controller);
  renderResultsPanel(job);
  addLog(job,`Row Re-Audit 10×: ${label} · full comment history (${historyLen}) · current settings (${activeForJob({settings:live}).map(shortLabel).join(", ")}).`);

  const resultSets=[];
  let runsCompleted=0,runsFailed=0,lastRow=null;
  try{
    for(let run=1;run<=MULTI_RUN_COUNT;run++){
      if(controller.signal.aborted){
        const err=new Error("Aborted");
        err.name="AbortError";
        throw err;
      }
      rowTenReAuditProgress.set(key,{current:run,total:MULTI_RUN_COUNT});
      renderResultsPanel(job);
      addLog(job,`Row Re-Audit 10× ${run}/${MULTI_RUN_COUNT}: ${label}…`,"info");
      try{
        const rows=await debugAuditBatch(
          keyApi,
          live,
          batch,
          controller.signal,
          (message,level)=>addLog(job,message,level),
          usage=>{
            job.tokenUsage=job.tokenUsage||{input:0,cached:0,output:0};
            job.tokenUsage.input+=usage.input;
            job.tokenUsage.cached+=usage.cached;
            job.tokenUsage.output+=usage.output;
          }
        );
        if(!rows?.length)throw new Error("Re-audit returned no rows.");
        const next=rows[0];
        resultSets.push([next]);
        lastRow=next;
        runsCompleted++;
        addLog(job,`Row Re-Audit 10× ${run}/${MULTI_RUN_COUNT} complete: ${label}.`,"success");
      }catch(error){
        if(error.name==="AbortError")throw error;
        runsFailed++;
        addLog(job,`Row Re-Audit 10× ${run}/${MULTI_RUN_COUNT} failed (${label}): ${error.message||error}. Continuing.`,"warn");
      }
    }

    if(!runsCompleted||!lastRow){
      addLog(job,`Row Re-Audit 10× finished with no successful runs: ${label}.`,"error");
      toast(`Re-Audit 10× failed for ${row.mobile||"lead"} — no successful runs.`);
      return;
    }

    let replaced=false;
    job.results=(job.results||[]).map(existing=>{
      if(resultLeadKey(existing)!==key)return existing;
      if(replaced)return existing;
      replaced=true;
      return lastRow;
    });
    if(!replaced)job.results.push(lastRow);

    const perLead=aggregatePerLeadFrequencies(resultSets);
    if(!(job.multiRunStats instanceof Map))job.multiRunStats=new Map();
    const leadEntries=perLead.get(key)||perLead.get(resultLeadKey(lastRow));
    if(leadEntries)job.multiRunStats.set(key,leadEntries);
    const prevCompleted=job.multiRunMeta?.runsCompleted||0;
    job.multiRunMeta={
      runsCompleted:Math.max(prevCompleted,runsCompleted),
      runsFailed:(job.multiRunMeta?.runsFailed||0)+runsFailed
    };
    job.compare=null;
    job.telecallerResults=null;
    job.compareStatus="";
    job.updatedAt=timestamp();
    job.settings=deepCopy(live);
    addLog(job,`Row Re-Audit 10× complete: ${label} · ${runsCompleted}/${MULTI_RUN_COUNT} succeeded${runsFailed?`, ${runsFailed} failed`:""}. Consistency bars updated.`,"success");
    toast(`Re-Audit 10× complete for ${row.mobile||"lead"} (${runsCompleted}/${MULTI_RUN_COUNT}).`);
    renderProgress(job);
  }catch(error){
    if(error.name==="AbortError"){
      addLog(job,`Row Re-Audit 10× aborted: ${label}.`,"warn");
    }else{
      addLog(job,`Row Re-Audit 10× FAILED (${label}): ${error.message||error}`,"error");
      toast(error.message||"Row Re-Audit 10× failed.");
    }
    renderResultsPanel(job);
    renderProgress(job);
  }finally{
    rowReAuditKeys.delete(key);
    rowTenReAuditProgress.delete(key);
    rowReAuditControllers.delete(key);
    if(currentJob?.id===job.id)renderResultsPanel(job);
  }
}

async function startDebug(){
  if(!parsedFile?.leads?.length)return;
  const key=effectiveApiKey();
  if(!key){showView("settings");toast("Add an OpenAI API key first.");return;}
  const live=collectSettings();
  const ready=activePromptsReady(live);
  if(!ready.ok){showView("settings");toast(`Fill prompts for: ${ready.missing.map(shortLabel).join(", ")}`);return;}
  settings=live;
  saveDebugSettingsLocal(settings);

  loadedBundle={
    fileName:parsedFile.fileName,
    sheetName:parsedFile.sheetName||"",
    leads:parsedFile.leads,
    leadCount:parsedFile.leadCount||0,
    callCount:parsedFile.callCount||parsedFile.leads.length,
    latestDayCalls:parsedFile.latestDayCalls||parsedFile.leads.length,
    rowCount:parsedFile.rowCount||0
  };

  if(currentJob)await abortInFlight(currentJob);

  const job=buildJobFromBundle(loadedBundle,settings);
  // Keep file list / Re-Audit source; clear the file input only.
  if(els["debug-file-input"])els["debug-file-input"].value="";
  renderFileList();
  updateValidation();
  els["debug-run-panel"]?.classList.remove("hidden");
  currentJob=job;
  renderProgress(job);
  await runJob(job);
}

async function reAudit(){
  const bundle=getLoadedBundle();
  if(!bundle?.leads?.length){
    toast("Upload an Excel file first.");
    return;
  }
  loadedBundle=bundle;
  const key=effectiveApiKey();
  if(!key){showView("settings");toast("Add an OpenAI API key first.");return;}
  const live=collectSettings();
  const ready=activePromptsReady(live);
  if(!ready.ok){showView("settings");toast(`Fill prompts for: ${ready.missing.map(shortLabel).join(", ")}`);return;}
  settings=live;
  saveDebugSettingsLocal(settings);

  if(currentJob)await abortInFlight(currentJob);

  const job=buildJobFromBundle(bundle,settings);
  els["debug-run-panel"]?.classList.remove("hidden");
  currentJob=job;
  addLog(job,`Re-Audit: same file “${job.fileName}” with current settings (${activeForJob(job).map(shortLabel).join(", ")}).`);
  renderProgress(job);
  toast("Re-Audit started.");
  await runJob(job);
}

function getLoadedBundle(){
  return loadedBundle?.leads?.length
    ?loadedBundle
    :(currentJob?.leads?.length?{
      fileName:currentJob.fileName,
      sheetName:currentJob.sheetName||"",
      leads:currentJob.leads,
      leadCount:currentJob.leadCount||0,
      callCount:currentJob.callCount||currentJob.leads.length,
      latestDayCalls:currentJob.latestDayCalls||currentJob.leads.length,
      rowCount:currentJob.rowCount||0
    }:null);
}

async function runTenTimes(){
  if(multiRunActive){
    toast("A 10-run batch is already in progress.");
    return;
  }
  const bundle=getLoadedBundle();
  if(!bundle?.leads?.length){
    toast("Upload an Excel file first.");
    return;
  }
  loadedBundle=bundle;
  const key=effectiveApiKey();
  if(!key){showView("settings");toast("Add an OpenAI API key first.");return;}
  const live=collectSettings();
  const ready=activePromptsReady(live);
  if(!ready.ok){showView("settings");toast(`Fill prompts for: ${ready.missing.map(shortLabel).join(", ")}`);return;}
  settings=live;
  saveDebugSettingsLocal(settings);

  if(currentJob)await abortInFlight(currentJob);

  multiRunActive=true;
  multiRunProgress={current:0,total:MULTI_RUN_COUNT};
  syncRunActionButtons();
  els["debug-run-panel"]?.classList.remove("hidden");

  const resultSets=[];
  let runsCompleted=0,runsFailed=0;
  let lastSuccessfulJob=null;
  const logJob={
    id:"multi-run",
    logs:[],
    status:"running",
    settings:deepCopy(settings),
    leads:bundle.leads,
    fileName:bundle.fileName,
    totalLeads:bundle.leads.length,
    results:[],
    pendingBatches:{},
    nextBatch:0,
    tokenUsage:{input:0,cached:0,output:0},
    elapsedMs:0
  };
  currentJob=logJob;
  displayLogs=true;
  addLog(logJob,`Run 10 times: starting ${MULTI_RUN_COUNT} sequential audits on “${bundle.fileName}” (${activeForJob(logJob).map(shortLabel).join(", ")}).`,"info");
  renderProgress(logJob);

  let perLeadStats=null;
  try{
    for(let run=1;run<=MULTI_RUN_COUNT;run++){
      multiRunProgress={current:run,total:MULTI_RUN_COUNT};
      syncRunActionButtons(logJob);
      addLog(logJob,`Run ${run}/${MULTI_RUN_COUNT}…`,"info");
      renderProgress(logJob);

      const job=buildJobFromBundle(bundle,settings);
      currentJob=job;
      job.logs=logJob.logs;
      await runJob(job);

      if(job.status==="completed"&&(job.results||[]).length){
        resultSets.push(job.results);
        runsCompleted++;
        lastSuccessfulJob=job;
        addLog(logJob,`Run ${run}/${MULTI_RUN_COUNT} complete · ${job.results.length} rows.`,"success");
      }else{
        runsFailed++;
        const reason=job.status==="paused"
          ?"paused"
          :(job.error||job.status||"unknown error");
        addLog(logJob,`Run ${run}/${MULTI_RUN_COUNT} failed (${reason}). Continuing with remaining runs.`,"warn");
        if(job.status==="paused")break;
      }
      currentJob=logJob;
      renderProgress(logJob);
    }

    perLeadStats=aggregatePerLeadFrequencies(resultSets);

    if(!perLeadStats.size){
      addLog(logJob,`Run 10 times finished with no successful runs.`,"error");
      toast("Run 10 times finished — no successful runs.");
    }else{
      addLog(logJob,`Run 10 times complete · ${runsCompleted}/${MULTI_RUN_COUNT} succeeded${runsFailed?`, ${runsFailed} failed`:""}. Per-lead consistency shown in Results.`,"success");
      toast(`Run 10 times complete (${runsCompleted}/${MULTI_RUN_COUNT}).`);
    }
  }finally{
    multiRunActive=false;
    multiRunProgress={current:0,total:MULTI_RUN_COUNT};
    if(lastSuccessfulJob){
      lastSuccessfulJob.logs=logJob.logs;
      if(typeof perLeadStats!=="undefined"&&perLeadStats?.size){
        lastSuccessfulJob.multiRunStats=perLeadStats;
        lastSuccessfulJob.multiRunMeta={runsCompleted,runsFailed};
      }
      currentJob=lastSuccessfulJob;
      currentJob.status="completed";
    }else{
      logJob.status=runsFailed?"failed":"completed";
      currentJob=logJob;
    }
    syncRunActionButtons(currentJob);
    renderProgress(currentJob);
  }
}

function download(job){
  if(!job||job.status!=="completed")return;
  const live=collectSettings();
  downloadWorkbook(job,live);
  toast("Audit Excel downloaded.");
}

function configRow(className){const row=document.createElement("div");row.className=className;return row;}
function input(type,value,aria){const element=document.createElement("input");element.type=type;element.value=value??"";if(aria)element.setAttribute("aria-label",aria);return element;}

function syncCustomOutputField(field,{remove=false}={}){
  if(!field?.id||SYSTEM_OUTPUT_IDS.has(field.id)||field.id==="update")return;
  if(remove){
    settings.outputFields=settings.outputFields.filter(item=>item.id!==field.id);
    return;
  }
  const output=settings.outputFields.find(item=>item.id===field.id);
  if(output)output.label=field.label;
  else settings.outputFields.push({id:field.id,label:field.label,enabled:true});
}

function moveInputField(index,delta){
  settings=collectSettings();
  const next=index+delta;
  if(next<0||next>=settings.inputFields.length)return;
  const copy=[...settings.inputFields];
  const [item]=copy.splice(index,1);
  copy.splice(next,0,item);
  settings.inputFields=normalizeInputFields(copy,false);
  renderInputFields();
  renderOutputFields();
  renderSortFields();
  refreshResultsTable();
}

function renderInputFields(){
  if(!els["input-field-config"])return;
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
  if(!els["ai-field-config"])return;
  els["ai-field-config"].replaceChildren();
  for(const field of settings.aiFields){
    const row=configRow("config-row ai-row");
    const send=input("checkbox","",`Send ${field.label} to AI`);
    const name=document.createElement("span");
    const history=input("checkbox","",`Send all ${field.label} history to AI`);
    const historyLabel=document.createElement("label");
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
  if(!els["output-field-config"])return;
  els["output-field-config"].replaceChildren();
  for(const field of settings.outputFields){
    const row=configRow("config-row output-row");
    const toggle=input("checkbox","",`Include ${field.label} in download`);
    const name=document.createElement("span");
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
  const current=settings.sort?.field||"callDate";
  select.replaceChildren();
  for(const field of settings.outputFields){
    const option=document.createElement("option");
    option.value=field.id;
    option.textContent=field.label;
    option.selected=field.id===current;
    select.append(option);
  }
  if(els["sort-direction"])els["sort-direction"].value=settings.sort?.direction==="desc"?"desc":"asc";
}

function renderSettings(){
  settings=normalizeDebugSettings(settings);
  if(els["batch-size"])els["batch-size"].value=settings.batchSize;
  if(els.concurrency)els.concurrency.value=settings.concurrency;
  if(els.model)els.model.value=settings.model;
  if(els["yes-values"])els["yes-values"].value=settings.yesValues;
  if(els["no-values"])els["no-values"].value=settings.noValues;
  if(els["input-price"])els["input-price"].value=settings.pricing.input;
  if(els["cached-price"])els["cached-price"].value=settings.pricing.cached;
  if(els["output-price"])els["output-price"].value=settings.pricing.output;
  if(els["api-key"])els["api-key"].value=getApiKey();
  if(els["remember-key"])els["remember-key"].checked=apiKeyIsRemembered();
  if(els["app-version"])els["app-version"].textContent=APP_VERSION;
  renderInputFields();
  renderAiFields();
  renderOutputFields();
  renderSortFields();
  renderErrorFocusSettings();
  renderActiveChips();
  updateKeyState();
  syncApiKeySettingsUi();
  refreshResultsTable();
}

function collectSettings(){
  const next=normalizeDebugSettings(settings);
  next.batchSize=Number(els["batch-size"]?.value);
  next.concurrency=Number(els.concurrency?.value);
  next.model=(els.model?.value||"").trim();
  next.yesValues=(els["yes-values"]?.value||"").trim();
  next.noValues=(els["no-values"]?.value||"").trim();
  next.pricing={input:number(els["input-price"]?.value),cached:number(els["cached-price"]?.value),output:number(els["output-price"]?.value)};
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
  next.aiFields=next.aiFields.map(field=>({
    ...field,
    enabled:Boolean(document.querySelector(`[data-ai-id="${field.id}"]`)?.checked),
    history:Boolean(document.querySelector(`[data-history-id="${field.id}"]`)?.checked)
  }));
  next.outputFields=next.outputFields.map(field=>({
    ...field,
    enabled:Boolean(document.querySelector(`[data-output-id="${field.id}"]`)?.checked)
  }));
  for(const field of next.inputFields){
    if(SYSTEM_OUTPUT_IDS.has(field.id)||field.id==="update")continue;
    const output=next.outputFields.find(item=>item.id===field.id);
    if(output)output.label=field.label;
    else next.outputFields.push({id:field.id,label:field.label,enabled:true});
  }
  // Preserve in-memory prompts; sync textarea for current focus.
  const focus=(els["focus-error-type"]?.value||next.focusErrorType||LAB_ERROR_TYPES[0]).trim();
  next.focusErrorType=LAB_ERROR_TYPES.includes(focus)?focus:next.activeErrorTypes[0];
  const checked=[...document.querySelectorAll("#error-type-checks [data-error-label]:checked")].map(el=>el.dataset.errorLabel);
  next.activeErrorTypes=normalizeActiveErrorTypes(checked.length?checked:next.activeErrorTypes);
  if(!next.activeErrorTypes.includes(next.focusErrorType))next.focusErrorType=next.activeErrorTypes[0];
  next.errorPrompts={...emptyErrorPrompts(),...next.errorPrompts};
  if(els["error-prompt"]&&next.focusErrorType){
    next.errorPrompts[next.focusErrorType]=els["error-prompt"].value||"";
  }
  return normalizeDebugSettings(next);
}

async function persistSettingsEverywhere(next,{announce=true}={}){
  settings=normalizeDebugSettings(next);
  saveDebugSettingsLocal(settings);
  try{
    await SettingsApi.saveDebug(settings);
    if(announce&&els["settings-message"])els["settings-message"].textContent="Saved for everyone (debug_settings).";
    return true;
  }catch(err){
    if(announce&&els["settings-message"])els["settings-message"].textContent=err.message||"Saved locally; server save failed.";
    return false;
  }
}

function exportSettings(){
  const payload={
    format:"leadlens-debug-settings",
    version:APP_VERSION,
    exportedAt:timestamp(),
    settings:collectSettings()
  };
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const link=document.createElement("a");
  link.href=url;
  link.download=`leadlens-debug-settings-${APP_VERSION}.json`;
  link.click();
  URL.revokeObjectURL(url);
  if(els["settings-message"])els["settings-message"].textContent="DeBug settings exported (API key is not included).";
}

async function importSettingsFile(file){
  if(!file)return;
  try{
    const parsed=JSON.parse(await file.text());
    const incoming=parsed.settings||parsed;
    settings=normalizeDebugSettings(incoming);
    saveDebugSettingsLocal(settings);
    renderSettings();
    if(els["settings-message"])els["settings-message"].textContent=`Settings imported from JSON${parsed.version?` (file v${parsed.version})`:""}.`;
    toast("DeBug settings imported.");
  }catch(error){
    if(els["settings-message"])els["settings-message"].textContent=`Import failed: ${error.message}`;
  }finally{
    if(els["import-settings-file"])els["import-settings-file"].value="";
  }
}

function renderFileList(){
  const box=els["debug-file-list"];
  if(!box)return;
  const source=parsedFile||(loadedBundle?{fileName:loadedBundle.fileName,leads:loadedBundle.leads,leadCount:loadedBundle.leadCount}:null);
  if(!source){box.classList.add("hidden");box.replaceChildren();return;}
  box.classList.remove("hidden");
  box.replaceChildren();
  const row=document.createElement("div");
  row.className="file-row";
  const suffix=parsedFile?"":" · loaded for Re-Audit";
  row.textContent=`${source.fileName} · ${source.leads?.length||0} latest-day calls · ${source.leadCount||0} leads${suffix}`;
  box.append(row);
}

function updateValidation(){
  const box=els["debug-validation"];
  const pre=els["debug-precounts"];
  const start=els["start-debug"];
  if(!box||!start)return;
  syncRunActionButtons();
  if(!parsedFile){
    if(loadedBundle?.leads?.length){
      box.classList.remove("hidden");
      box.className="validation";
      box.textContent=`Loaded: ${loadedBundle.fileName} · ${loadedBundle.leadCount||0} leads · use Re-Audit to rerun, or upload a new file.`;
      if(pre){
        pre.classList.remove("hidden");
        pre.textContent=`In memory · ${Number(loadedBundle.callCount||loadedBundle.leads.length).toLocaleString()} calls · ready for Re-Audit`;
      }
    }else{
      box.classList.add("hidden");
      pre?.classList.add("hidden");
    }
    start.disabled=true;
    return;
  }
  box.classList.remove("hidden");
  const notes=[];
  const missing=new Set(parsedFile.missingColumns||[]);
  const unknown=new Set(parsedFile.unknownHeaders||[]);
  if(missing.size)notes.push(`Missing enabled Settings columns: ${[...missing].join(", ")}.`);
  if(unknown.size)notes.push(`Unmapped headers: ${[...unknown].join(", ")}.`);
  if(!(parsedFile.leads||[]).length)notes.push("No latest-day calls found after preprocessing.");
  if(notes.length){
    box.className="validation warn";
    box.replaceChildren();
    for(const text of notes){
      const note=document.createElement("div");
      note.className="validation-note";
      note.textContent=text;
      box.append(note);
    }
  }else{
    box.className="validation";
    box.textContent=`Ready: ${parsedFile.leadCount||0} leads · ${parsedFile.leads.length} call rows on latest day.`;
  }
  if(pre){
    pre.classList.remove("hidden");
    pre.textContent=`Sheet “${parsedFile.sheetName||"—"}” · ${Number(parsedFile.rowCount||0).toLocaleString()} Excel rows · ${Number(parsedFile.callCount||parsedFile.leads.length).toLocaleString()} calls · latest-day ${parsedFile.leads.length}`;
  }
  start.disabled=!(parsedFile.leads||[]).length;
  syncRunActionButtons();
}

async function handleFiles(fileList){
  const files=[...fileList||[]].filter(file=>/\.(xlsx|xls|xlsm)$/i.test(file.name));
  if(!files.length){toast("Choose an Excel workbook.");return;}
  const box=els["debug-validation"];
  box.className="validation";
  box.classList.remove("hidden");
  box.textContent=`Reading ${files[0].name}…`;
  try{
    const file=files[0];
    const parsed=parseWorkbook(await file.arrayBuffer(),settings);
    parsedFile={...parsed,fileName:file.name,fileSize:file.size,sourceFormat:"raw"};
    loadedBundle={
      fileName:parsedFile.fileName,
      sheetName:parsedFile.sheetName||"",
      leads:parsedFile.leads,
      leadCount:parsedFile.leadCount||0,
      callCount:parsedFile.callCount||parsedFile.leads.length,
      latestDayCalls:parsedFile.latestDayCalls||parsedFile.leads.length,
      rowCount:parsedFile.rowCount||0
    };
  }catch(error){
    parsedFile=null;
    loadedBundle=null;
    box.className="validation error";
    box.textContent=error.message||"Could not read workbook.";
    els["start-debug"].disabled=true;
    syncRunActionButtons();
    renderFileList();
    return;
  }
  if(files.length>1)toast("Only the first file is used.");
  renderFileList();
  updateValidation();
}

async function loadServerSettingsAndKey(){
  try{
    const [debug,keyStatus]=await Promise.all([
      SettingsApi.getDebug().catch(()=>({settings:null})),
      SettingsApi.openaiKeyStatus().catch(()=>({configured:false})),
    ]);
    serverKeyConfigured=Boolean(keyStatus&&(keyStatus.configured===true||keyStatus.configured===1||keyStatus.configured==="true"));
    if(debug?.settings&&typeof debug.settings==="object"){
      settings=normalizeDebugSettings({...DEFAULT_DEBUG_SETTINGS,...debug.settings});
      saveDebugSettingsLocal(settings);
    }
  }catch{/* local fallback */}
  updateKeyState();
  syncApiKeySettingsUi();
}

function renderSidebarRelease(version=APP_VERSION,notes=""){
  if(els["sidebar-version"])els["sidebar-version"].textContent=`v${version}`;
  if(els["sidebar-notes"]&&notes)els["sidebar-notes"].textContent=notes;
}
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
function showUpdateBanner(latest){
  if(!els["update-banner"])return;
  els["update-banner"].classList.remove("hidden");
  const box=els["update-banner-text"];
  if(!box)return;
  box.replaceChildren();
  box.append(`LeadLens v${latest} is available (you are on v${APP_VERSION}). Hard-reload to update.`);
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
    if(newer||latest===APP_VERSION)renderSidebarRelease(APP_VERSION,notes||els["sidebar-notes"]?.textContent||"");
    if(newer)showUpdateBanner(latest);
    else els["update-banner"]?.classList.add("hidden");
  }catch{/* offline */}
}

// —— wire events ——
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

document.querySelectorAll(".nav-item").forEach(button=>button.addEventListener("click",()=>showView(button.dataset.view)));
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

els["pause-run"]?.addEventListener("click",async()=>{
  if(!currentJob)return;
  if(currentJob.status==="running")controllers.get(currentJob.id)?.abort();
  else await runJob(currentJob);
});
els["download-result"]?.addEventListener("click",()=>currentJob&&download(currentJob));
els["compare-telecaller"]?.addEventListener("click",()=>currentJob&&runTelecallerCompare(currentJob));
els["re-audit"]?.addEventListener("click",()=>reAudit());
els["re-audit-panel"]?.addEventListener("click",()=>reAudit());
els["run-ten-times"]?.addEventListener("click",()=>runTenTimes());
els["run-ten-times-panel"]?.addEventListener("click",()=>runTenTimes());
els["clear-console"]?.addEventListener("click",()=>{displayLogs=false;renderLogs(currentJob);});

els["focus-error-type"]?.addEventListener("change",()=>{
  const prev=settings.focusErrorType;
  settings.errorPrompts=settings.errorPrompts||emptyErrorPrompts();
  if(prev&&els["error-prompt"])settings.errorPrompts[prev]=els["error-prompt"].value||"";
  const nextFocus=els["focus-error-type"].value;
  settings.focusErrorType=LAB_ERROR_TYPES.includes(nextFocus)?nextFocus:settings.activeErrorTypes[0];
  if(els["error-prompt"])els["error-prompt"].value=settings.errorPrompts?.[settings.focusErrorType]||"";
  renderErrorFocusSettings();
});
els["error-prompt"]?.addEventListener("input",()=>{
  const focus=settings.focusErrorType||LAB_ERROR_TYPES[0];
  settings.errorPrompts=settings.errorPrompts||emptyErrorPrompts();
  settings.errorPrompts[focus]=els["error-prompt"].value||"";
});
els["sync-status-from-audit"]?.addEventListener("click",()=>{
  settings=collectSettings();
  const focus=settings.focusErrorType||LAB_ERROR_TYPES[0];
  if(focus!==STATUS_HISTORY_ERROR)return;
  settings.errorPrompts=settings.errorPrompts||emptyErrorPrompts();
  settings.errorPrompts[focus]=STATUS_HISTORY_PROMPT;
  if(els["error-prompt"])els["error-prompt"].value=STATUS_HISTORY_PROMPT;
  if(els["settings-message"])els["settings-message"].textContent="Loaded production Status rules into this DeBug prompt (from app defaults, not live server).";
});
els["push-prompt-to-audit"]?.addEventListener("click",async()=>{
  if(!getUser()?.is_super){
    toast("Only Super User can update Bucket 1 audit settings.");
    return;
  }
  settings=collectSettings();
  const focus=settings.focusErrorType||LAB_ERROR_TYPES[0];
  const mapping=ERROR_TO_AUDIT_RULE[focus];
  if(!mapping){
    toast("No Bucket 1 rule mapping for this error type.");
    return;
  }
  const prompt=String(els["error-prompt"]?.value||settings.errorPrompts?.[focus]||"").trim();
  if(!prompt){
    toast("Prompt is empty — write or load a prompt first.");
    return;
  }
  settings.errorPrompts=settings.errorPrompts||emptyErrorPrompts();
  settings.errorPrompts[focus]=prompt;
  const pushBtn=els["push-prompt-to-audit"];
  if(pushBtn)pushBtn.disabled=true;
  if(els["settings-message"])els["settings-message"].textContent="Syncing to Bucket 1…";
  try{
    const payload=await SettingsApi.getAudit().catch(()=>({settings:null}));
    const merged=normalizeSettings(payload?.settings||{});
    const rules=Array.isArray(merged.rules)?merged.rules.map(rule=>({...rule})):merged.rules;
    const idx=rules.findIndex(rule=>String(rule.field||"").trim()===mapping.field);
    const nextRule={
      field:mapping.field,
      instruction:prompt,
      errors:mapping.errors||(idx>=0?rules[idx].errors:"")
    };
    if(idx>=0)rules[idx]={...rules[idx],...nextRule};
    else rules.push(nextRule);
    merged.rules=rules;
    delete merged.errorPrompts;
    delete merged.activeErrorTypes;
    delete merged.focusErrorType;
    delete merged.customPrompt;
    await SettingsApi.saveAudit(merged);
    if(els["settings-message"]){
      const sharedNote=mapping.field==="Customer Requirement"
        ? " (replaces the whole Customer Requirement rule — tune Empty and Incorrect separately in DeBug, then push each)."
        : "";
      els["settings-message"].textContent=`Synced ${shortLabel(focus)} to Bucket 1 · rule “${mapping.field}”.${sharedNote}`;
    }
    toast(`Synced to Bucket 1 — ${mapping.field}`);
  }catch(error){
    if(els["settings-message"])els["settings-message"].textContent=error.message||"Sync to Bucket 1 failed.";
    toast(error.message||"Could not sync to Bucket 1.");
  }finally{
    renderErrorFocusSettings();
  }
});
els["clear-error-prompt"]?.addEventListener("click",()=>{
  settings=collectSettings();
  const focus=settings.focusErrorType||LAB_ERROR_TYPES[0];
  settings.errorPrompts[focus]="";
  if(els["error-prompt"])els["error-prompt"].value="";
});

if(els["debug-drop-zone"]){
  els["debug-drop-zone"].onclick=()=>els["debug-file-input"].click();
  els["debug-drop-zone"].onkeydown=event=>{if(["Enter"," "].includes(event.key))els["debug-file-input"].click();};
  for(const event of ["dragenter","dragover"])els["debug-drop-zone"].addEventListener(event,e=>{e.preventDefault();els["debug-drop-zone"].classList.add("dragover");});
  for(const event of ["dragleave","drop"])els["debug-drop-zone"].addEventListener(event,e=>{e.preventDefault();els["debug-drop-zone"].classList.remove("dragover");});
  els["debug-drop-zone"].addEventListener("drop",event=>handleFiles(event.dataTransfer.files));
}
if(els["debug-file-input"])els["debug-file-input"].onchange=event=>handleFiles(event.target.files);
if(els["start-debug"])els["start-debug"].onclick=startDebug;
syncRunActionButtons();

els["toggle-key"]?.addEventListener("click",()=>{const hidden=els["api-key"].type==="password";els["api-key"].type=hidden?"text":"password";els["toggle-key"].textContent=hidden?"Hide":"Show";});
els["save-key"]?.addEventListener("click",async()=>{
  await validateAndSaveKey(els["api-key"].value,els["remember-key"].checked,els["key-message"],els["save-key"],{toServer:true});
});
els["forget-key"]?.addEventListener("click",async()=>{
  forgetApiKey();
  if(els["api-key"])els["api-key"].value="";
  if(els["remember-key"])els["remember-key"].checked=false;
  if(serverKeyConfigured){
    try{
      await SettingsApi.clearOpenaiKey();
      serverKeyConfigured=false;
      if(els["key-message"])els["key-message"].textContent="Server key cleared.";
    }catch(err){
      if(els["key-message"])els["key-message"].textContent=err.message||"Could not clear server key";
    }
  }else if(els["key-message"])els["key-message"].textContent="Key removed.";
  updateKeyState();
  syncApiKeySettingsUi();
});
els["onboard-toggle"]?.addEventListener("click",()=>{const hidden=els["onboard-key"].type==="password";els["onboard-key"].type=hidden?"text":"password";els["onboard-toggle"].textContent=hidden?"Hide":"Show";});
els["onboard-save"]?.addEventListener("click",async()=>{
  const saved=await validateAndSaveKey(els["onboard-key"].value,els["onboard-remember"].checked,els["onboard-message"],els["onboard-save"],{toServer:true});
  if(saved){closeKeyModal();toast("Server OpenAI key saved.");}
});
els["onboard-skip"]?.addEventListener("click",()=>{closeKeyModal();toast("You can save the server key any time in Settings.");});

els["add-input-field"]?.addEventListener("click",()=>{
  settings=collectSettings();
  const used=new Set(settings.inputFields.map(field=>field.id));
  const label=`Custom field ${settings.inputFields.length+1}`;
  const field={id:slugFieldId(label,used),label,aliases:label,required:false,enabled:true};
  settings.inputFields=normalizeInputFields([...settings.inputFields,field],false);
  syncCustomOutputField(field);
  renderInputFields();
  renderOutputFields();
  renderSortFields();
  refreshResultsTable();
});

els["output-field-config"]?.addEventListener("change",event=>{
  if(!event.target.matches("[data-output-id]"))return;
  settings=collectSettings();
  refreshResultsTable();
});
for(const id of ["sort-field","sort-direction"]){
  els[id]?.addEventListener("change",()=>{
    settings=collectSettings();
    refreshResultsTable();
  });
}

els["save-settings"]?.addEventListener("click",async()=>{
  const rawBatch=Number(els["batch-size"]?.value);
  const rawConc=Number(els.concurrency?.value);
  if(!Number.isInteger(rawBatch)||rawBatch<1||rawBatch>MAX_BATCH_SIZE){
    if(els["settings-message"])els["settings-message"].textContent=`Batch size must be 1–${MAX_BATCH_SIZE}.`;
    return;
  }
  if(!Number.isInteger(rawConc)||rawConc<1||rawConc>MAX_CONCURRENCY){
    if(els["settings-message"])els["settings-message"].textContent=`Parallel batches must be 1–${MAX_CONCURRENCY}.`;
    return;
  }
  const next=collectSettings();
  const ready=activePromptsReady(next);
  if(!ready.ok){
    if(els["settings-message"])els["settings-message"].textContent=`Fill prompts for active errors: ${ready.missing.map(shortLabel).join(", ")}.`;
    return;
  }
  await persistSettingsEverywhere(next);
  renderSettings();
  toast("DeBug settings saved.");
});
els["reset-settings"]?.addEventListener("click",()=>{
  settings=normalizeDebugSettings(DEFAULT_DEBUG_SETTINGS);
  saveDebugSettingsLocal(settings);
  renderSettings();
  if(els["settings-message"])els["settings-message"].textContent="Defaults restored (not yet saved to server).";
});
els["export-settings"]?.addEventListener("click",exportSettings);
els["import-settings"]?.addEventListener("click",()=>els["import-settings-file"]?.click());
els["import-settings-file"]?.addEventListener("change",event=>importSettingsFile(event.target.files?.[0]));
els["reload-app"]?.addEventListener("click",()=>location.reload());

async function bootDeBugMode(){
  const user=await requireAuth({loginPath:"/"});
  if(!user?.is_super){
    location.href="/";
    return;
  }
  setStorageUserId(user.id);
  applySidebarCollapsed(readSidebarCollapsedPref(),{persist:false});
  settings=normalizeDebugSettings(loadDebugSettingsLocal(DEFAULT_DEBUG_SETTINGS));
  await loadServerSettingsAndKey();
  renderSettings();
  renderActiveChips();
  if(els["shell-user-label"])els["shell-user-label"].textContent=user.display_name||user.username;
  showView("run");
  checkForUpdate();
  openKeyModal();
  mountNotifications({
    variant:"chrome",
    onOpenAccessRequests:()=>{location.href="/admin/";},
  });
  setInterval(()=>{
    if(currentJob?.status==="running")renderProgress(currentJob);
  },1000);
  setInterval(checkForUpdate,5*60*1000);
}

bootDeBugMode();

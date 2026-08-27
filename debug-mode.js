/**
 * DeBug Mode UI — SuperUser-only slim Run + Settings shell.
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
  validateApiKey,
  SERVER_API_KEY,
} from "./audit.js?v=5.1.1";
import {getApiKey,apiKeyIsRemembered,saveApiKey,forgetApiKey,setStorageUserId,storageKey} from "./db.js?v=5.1.1";
import {requireAuth,logout,getUser,changePassword,updateProfile} from "./auth.js?v=5.1.1";
import {SettingsApi} from "./api-client.js?v=5.1.1";
import {mountNotifications} from "./notifications-ui.js?v=5.1.1";
import {debugAuditBatch} from "./debug-engine.js?v=5.1.1";

const $=id=>document.getElementById(id);
const ids=[
  "page-title","key-state","pause-run","download-result","progress-label","progress-percent","progress-bar",
  "metric-leads","metric-calls","metric-batch","metric-completed","metric-status","metric-input-tokens",
  "metric-cached-tokens","metric-output-tokens","metric-duration","metric-cost","live-log","clear-console",
  "api-key","remember-key","toggle-key","save-key","forget-key","key-message","batch-size","concurrency","model",
  "input-field-config","add-input-field","ai-field-config","output-field-config","yes-values","no-values",
  "custom-prompt","input-price","cached-price","output-price","save-settings","reset-settings","settings-message",
  "toast","mobile-menu","sort-field","sort-direction","app-version","export-settings","import-settings",
  "import-settings-file","update-banner","update-banner-text","reload-app","key-modal","onboard-key",
  "onboard-toggle","onboard-remember","onboard-message","onboard-save","onboard-skip","sidebar-version",
  "sidebar-notes","debug-drop-zone","debug-file-input","debug-drop-hint","debug-file-list","debug-validation",
  "start-debug","debug-run-panel","debug-precounts","shell-user-label","shell-logout","shell-account"
];
const els=Object.fromEntries(ids.map(id=>[id,$(id)]));
const titles={run:"Run",settings:"Settings"};
const ENGINE_VERSION="debug-csv-v1";
const SYSTEM_OUTPUT_IDS=new Set(DEFAULT_OUTPUT_FIELDS.map(field=>field.id));
const BLOCK_KEY_REASONS=new Set(["empty","format","unauthorized","forbidden"]);

const DEFAULT_DEBUG_SETTINGS=normalizeDebugSettings({...DEFAULT_SETTINGS,customPrompt:""});

let currentJob=null,displayLogs=true,parsedFile=null,serverKeyConfigured=false;
let settings=normalizeDebugSettings(DEFAULT_DEBUG_SETTINGS);
const controllers=new Map();

function normalizeDebugSettings(saved={}){
  const merged=normalizeSettings(saved);
  merged.customPrompt=String(saved.customPrompt??merged.customPrompt??"");
  return merged;
}

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

function renderProgress(job){
  if(!job)return;
  currentJob=job;
  const totalAudited=job.totalLeads||0,done=auditedDoneCount(job),pct=totalAudited?Math.round(Math.min(done,totalAudited)/totalAudited*100):0;
  const batches=leadBatchCount(job),usage=job.tokenUsage||{};
  const concurrency=job.settings?.concurrency||1;
  const billable=Math.max(0,number(usage.input)-number(usage.cached));
  const pendingLeft=Object.keys(job.pendingBatches||{}).length;
  if(els["progress-label"])els["progress-label"].textContent=job.status==="completed"
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
    els["pause-run"].disabled=!(["running","paused","failed"].includes(job.status));
    els["pause-run"].textContent=job.status==="running"?"Pause":"Resume";
  }
  if(els["download-result"])els["download-result"].disabled=job.status!=="completed";
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
  const prompt=String(job.settings?.customPrompt||settings.customPrompt||"").trim();
  if(!prompt){showView("settings");toast("Add a custom prompt in Settings before starting.");return;}

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
  displayLogs=true;

  const concurrency=Math.min(MAX_CONCURRENCY,Math.max(1,Number(job.settings.concurrency)||1));
  addLog(job,`DeBug started: pool ${concurrency}, batch ${job.settings.batchSize}, model ${job.settings.model}, app ${APP_VERSION}.`);
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
        addLog(job,`Dispatch batch ${index+1}/${totalBatches} (${leadSlice.length} leads · ${batch.length} call${batch.length===1?"":"s"}) · CSV prompt.`);
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
    toast(`${job.fileName}: DeBug complete.`);
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
  if(els["custom-prompt"])els["custom-prompt"].value=settings.customPrompt||"";
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
  updateKeyState();
  syncApiKeySettingsUi();
}

function collectSettings(){
  const next=normalizeDebugSettings(settings);
  next.batchSize=Number(els["batch-size"]?.value);
  next.concurrency=Number(els.concurrency?.value);
  next.model=(els.model?.value||"").trim();
  next.yesValues=(els["yes-values"]?.value||"").trim();
  next.noValues=(els["no-values"]?.value||"").trim();
  next.customPrompt=(els["custom-prompt"]?.value||"");
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
  if(!parsedFile){box.classList.add("hidden");box.replaceChildren();return;}
  box.classList.remove("hidden");
  box.replaceChildren();
  const row=document.createElement("div");
  row.className="file-row";
  row.textContent=`${parsedFile.fileName} · ${parsedFile.leads?.length||0} latest-day calls · ${parsedFile.leadCount||0} leads`;
  box.append(row);
}

function updateValidation(){
  const box=els["debug-validation"];
  const pre=els["debug-precounts"];
  const start=els["start-debug"];
  if(!box||!start)return;
  if(!parsedFile){
    box.classList.add("hidden");
    pre?.classList.add("hidden");
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
  }catch(error){
    parsedFile=null;
    box.className="validation error";
    box.textContent=error.message||"Could not read workbook.";
    els["start-debug"].disabled=true;
    renderFileList();
    return;
  }
  if(files.length>1)toast("Only the first file is used.");
  renderFileList();
  updateValidation();
}

async function startDebug(){
  if(!parsedFile?.leads?.length)return;
  const key=effectiveApiKey();
  if(!key){showView("settings");toast("Add an OpenAI API key first.");return;}
  const live=collectSettings();
  if(!String(live.customPrompt||"").trim()){showView("settings");toast("Custom prompt is required.");return;}
  settings=live;
  saveDebugSettingsLocal(settings);

  const job={
    id:crypto.randomUUID(),
    engineVersion:ENGINE_VERSION,
    appVersion:APP_VERSION,
    mode:"debug",
    fileName:parsedFile.fileName,
    sheetName:parsedFile.sheetName||"",
    createdAt:timestamp(),
    updatedAt:timestamp(),
    status:"queued",
    totalLeads:parsedFile.leads.length,
    leadCount:parsedFile.leadCount||0,
    callCount:parsedFile.callCount||parsedFile.leads.length,
    latestDayCalls:parsedFile.latestDayCalls||parsedFile.leads.length,
    rowCount:parsedFile.rowCount||0,
    nextBatch:0,
    pendingBatches:{},
    leads:parsedFile.leads,
    results:[],
    logs:[],
    tokenUsage:{input:0,cached:0,output:0},
    elapsedMs:0,
    pricing:deepCopy(settings.pricing),
    settings:deepCopy(settings)
  };
  parsedFile=null;
  renderFileList();
  updateValidation();
  if(els["debug-file-input"])els["debug-file-input"].value="";
  els["debug-run-panel"]?.classList.remove("hidden");
  currentJob=job;
  renderProgress(job);
  await runJob(job);
}

function download(job){
  if(!job||job.status!=="completed")return;
  const live=collectSettings();
  downloadWorkbook(job,live);
  toast("Audit Excel downloaded.");
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
document.querySelectorAll(".nav-item").forEach(button=>button.addEventListener("click",()=>showView(button.dataset.view)));
document.getElementById("settings-form")?.addEventListener("submit",event=>event.preventDefault());
els["mobile-menu"]?.addEventListener("click",()=>document.querySelector(".shell")?.classList.toggle("menu-open"));
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
els["clear-console"]?.addEventListener("click",()=>{displayLogs=false;renderLogs(currentJob);});

if(els["debug-drop-zone"]){
  els["debug-drop-zone"].onclick=()=>els["debug-file-input"].click();
  els["debug-drop-zone"].onkeydown=event=>{if(["Enter"," "].includes(event.key))els["debug-file-input"].click();};
  for(const event of ["dragenter","dragover"])els["debug-drop-zone"].addEventListener(event,e=>{e.preventDefault();els["debug-drop-zone"].classList.add("dragover");});
  for(const event of ["dragleave","drop"])els["debug-drop-zone"].addEventListener(event,e=>{e.preventDefault();els["debug-drop-zone"].classList.remove("dragover");});
  els["debug-drop-zone"].addEventListener("drop",event=>handleFiles(event.dataTransfer.files));
}
if(els["debug-file-input"])els["debug-file-input"].onchange=event=>handleFiles(event.target.files);
if(els["start-debug"])els["start-debug"].onclick=startDebug;

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
});

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
  if(!String(els["custom-prompt"]?.value||"").trim()){
    if(els["settings-message"])els["settings-message"].textContent="Custom prompt is required.";
    return;
  }
  const next=collectSettings();
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
  settings=normalizeDebugSettings(loadDebugSettingsLocal(DEFAULT_DEBUG_SETTINGS));
  await loadServerSettingsAndKey();
  renderSettings();
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

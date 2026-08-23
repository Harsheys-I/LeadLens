import {putJob,getJob,getJobs,deleteJob,clearJobs,loadSettings,saveSettings,getApiKey,apiKeyIsRemembered,saveApiKey,forgetApiKey} from "./db.js";
import {APP_VERSION,DEFAULT_SETTINGS,DEFAULT_OUTPUT_FIELDS,SETTINGS_SEED,normalizeSettings,normalizeInputFields,slugFieldId,parseWorkbook,auditBatch,downloadWorkbook} from "./audit.js";

const $=id=>document.getElementById(id);
const ids=["file-input","drop-zone","file-list","validation","start-audit","page-title","key-state","run-name","pause-run","download-result","progress-label","progress-percent","progress-bar","metric-leads","metric-excel-rows","metric-calls","metric-batch","metric-completed","metric-status","metric-input-tokens","metric-cached-tokens","metric-output-tokens","metric-duration","metric-cost","live-log","clear-console","history-list","clear-history","api-key","remember-key","toggle-key","save-key","forget-key","key-message","batch-size","concurrency","model","input-field-config","add-input-field","ai-field-config","rule-config","add-rule","output-field-config","yes-values","no-values","additional-instructions","input-price","cached-price","output-price","save-settings","reset-settings","settings-message","toast","mobile-menu","active-job-switch","sort-field","sort-direction","app-version","export-settings","import-settings","import-settings-file","update-banner","update-banner-text","reload-app"];
const els=Object.fromEntries(ids.map(id=>[id,$(id)]));
const titles={new:"New audit",console:"Run console",history:"History",settings:"Settings"};
const ENGINE_VERSION="latest-day-v6";
const ACTIVE_JOB_KEY="leadlens.activeJobId";

let parsedFiles=[],currentJob=null,displayLogs=true;
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

function showView(name){
  document.querySelectorAll(".view").forEach(view=>view.classList.toggle("active",view.id===`view-${name}`));
  document.querySelectorAll(".nav-item").forEach(button=>button.classList.toggle("active",button.dataset.view===name));
  els["page-title"].textContent=titles[name];
  document.querySelector(".shell").classList.remove("menu-open");
  if(name==="history")renderHistory();
  if(name==="settings")renderSettings();
  if(name==="console")refreshJobSwitcher();
}
function toast(message){els.toast.textContent=message;els.toast.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>els.toast.classList.remove("show"),3200);}
function updateKeyState(){const ready=Boolean(getApiKey());els["key-state"].textContent=ready?"API key ready":"API key not set";els["key-state"].classList.toggle("ready",ready);}
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
function elapsed(job){return (job.elapsedMs||0)+(job.status==="running"&&job.runStartedAt?Date.now()-new Date(job.runStartedAt).valueOf():0);}
function durationText(ms){const seconds=Math.max(0,Math.floor(ms/1000)),minutes=Math.floor(seconds/60);return minutes?`${minutes}m ${seconds%60}s`:`${seconds}s`;}
function estimatedCost(job){const usage=job.tokenUsage||{},rates=job.pricing||settings.pricing||{};return Math.max(0,(number(usage.input)-number(usage.cached))*number(rates.input)/1e6+number(usage.cached)*number(rates.cached)/1e6+number(usage.output)*number(rates.output)/1e6);}
function stopClock(job){if(job.runStartedAt){job.elapsedMs=(job.elapsedMs||0)+Date.now()-new Date(job.runStartedAt).valueOf();job.runStartedAt="";}}

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
function renderProgress(job){
  if(!job)return;
  currentJob=job;
  setActiveJobId(job.id);
  const totalCalls=job.totalLeads||0,done=job.results?.length||0,pct=totalCalls?Math.round(done/totalCalls*100):0;
  const batches=leadBatchCount(job),usage=job.tokenUsage||{};
  const concurrency=job.settings?.concurrency||1;
  const billable=Math.max(0,number(usage.input)-number(usage.cached));
  els["run-name"].textContent=job.fileName||"No active audit";
  els["progress-label"].textContent=job.status==="completed"?"Audit complete":job.status==="running"?`Keeping ${concurrency} batch request${concurrency>1?"s":""} in flight…`:job.status==="paused"?"Audit paused — ready to resume":job.status==="failed"?"Audit stopped — saved work is safe":"Waiting for a file";
  els["progress-percent"].textContent=`${pct}%`;
  els["progress-bar"].style.width=`${pct}%`;
  els["metric-leads"].textContent=uniqueLeadCount(job)||"—";
  if(els["metric-excel-rows"])els["metric-excel-rows"].textContent=job.rowCount?Number(job.rowCount).toLocaleString():"—";
  if(els["metric-calls"])els["metric-calls"].textContent=job.callCount!=null?Number(job.callCount).toLocaleString():"—";
  els["metric-batch"].textContent=batches?`${Math.min((job.nextBatch||0)+1,batches)} / ${batches}`:"—";
  els["metric-completed"].textContent=totalCalls?`${done} / ${totalCalls}`:"—";
  els["metric-status"].textContent=job.status?job.status[0].toUpperCase()+job.status.slice(1):"Idle";
  els["metric-input-tokens"].textContent=`${number(usage.input).toLocaleString()} (${billable.toLocaleString()} billable)`;
  els["metric-cached-tokens"].textContent=number(usage.cached).toLocaleString();
  els["metric-output-tokens"].textContent=number(usage.output).toLocaleString();
  els["metric-duration"].textContent=durationText(elapsed(job));
  els["metric-cost"].textContent=estimatedCost(job).toFixed(4);
  els["pause-run"].disabled=!(["running","paused","failed"].includes(job.status));
  els["pause-run"].textContent=job.status==="running"?"Pause":"Resume";
  els["download-result"].disabled=job.status!=="completed";
  renderLogs(job);
  refreshJobSwitcher();
}

async function refreshJobSwitcher(){
  const switcher=els["active-job-switch"];
  if(!switcher)return;
  const jobs=await getJobs();
  const live=jobs.filter(job=>["running","paused","failed","queued","completed"].includes(job.status)&&job.engineVersion===ENGINE_VERSION).slice(0,12);
  switcher.replaceChildren();
  if(live.length<=1){switcher.classList.add("hidden");return;}
  switcher.classList.remove("hidden");
  const label=document.createElement("span");
  label.textContent="Active file";
  const select=document.createElement("select");
  select.setAttribute("aria-label","Switch active audit");
  for(const job of live){
    const option=document.createElement("option");
    option.value=job.id;
    option.textContent=`${job.fileName} (${job.status})`;
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
    }).catch(()=>{});
  },1500));
}
function clearPendingPersist(jobId){
  const prior=pendingPersistTimers.get(jobId);
  if(prior)clearTimeout(prior);
  pendingPersistTimers.delete(jobId);
}

function throttleProgress(job){
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
        ?`Checkpoint batch ${from+1}. ${job.results.length}/${job.totalLeads} saved${pendingLeft?` · ${pendingLeft} finished API batch(es) waiting for order`:""}.`
        :`Checkpoint batches ${from+1}–${job.nextBatch}. ${job.results.length}/${job.totalLeads} saved${pendingLeft?` · ${pendingLeft} finished API batch(es) waiting for order`:""}.`);
      throttleProgress(job);
    }else{
      // Finished early (e.g. batch 9 before batch 1) — keep in RAM, soft-persist later.
      const waitingFor=(job.nextBatch||0)+1;
      addLog(job,`Batch ${index+1} API done — held until batch ${waitingFor} checkpoints (in-order save).`);
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

async function runJob(job){
  if(controllers.has(job.id)){toast("That audit is already running.");return;}
  const key=getApiKey();
  if(!key){showView("settings");toast("Add an OpenAI API key first.");return;}
  if(!/^sk-[A-Za-z0-9_-]{20,}$/.test(key)){showView("settings");toast("That does not look like an OpenAI API key.");return;}

  const controller=new AbortController();
  controllers.set(job.id,controller);
  job.status="running";
  job.error="";
  job.runStartedAt=timestamp();
  job.tokenUsage=job.tokenUsage||{input:0,cached:0,output:0};
  job.elapsedMs=job.elapsedMs||0;
  job.pendingBatches=job.pendingBatches||{};
  displayLogs=true;
  const concurrency=Math.min(20,Math.max(1,Number(job.settings.concurrency)||1));
  addLog(job,`Run started: live pool of ${concurrency} (next batch fires the instant one frees a slot), batch size ${job.settings.batchSize} leads, model ${job.settings.model}, app ${APP_VERSION}. Checkpoints stay in order — later batches may finish API first and wait.`);
  await putJob(job);
  if(!currentJob||currentJob.id===job.id||!controllers.has(currentJob.id))renderProgress(job);
  showView("console");

  const batchSize=Math.max(1,Number(job.settings.batchSize)||1);
  const leadGroups=groupCallRowsByLead(job.leads);
  const totalBatches=Math.ceil(leadGroups.length/batchSize);
  const pending=job.pendingBatches||{};
  // Full remaining work pre-queued; workers pull instantly when a slot frees.
  const queue=[];
  for(let index=0;index<totalBatches;index++){
    if(index<job.nextBatch)continue;
    if(pending[String(index)])continue;
    queue.push(index);
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

  const workers=Array.from({length:Math.min(concurrency,Math.max(queue.length,1))},async()=>{
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
          fatalError=error;
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
    if(job.nextBatch<totalBatches)throw new Error("Audit stopped before all batches finished. Resume to continue.");
    job.status="completed";
    job.pendingBatches={};
    stopClock(job);
    job.updatedAt=timestamp();
    const billable=Math.max(0,number(job.tokenUsage.input)-number(job.tokenUsage.cached));
    addLog(job,`Audit complete in ${durationText(job.elapsedMs)}. Cost est. ${estimatedCost(job).toFixed(4)}. Cached ${number(job.tokenUsage.cached).toLocaleString()} · billable input ${billable.toLocaleString()} · output ${number(job.tokenUsage.output).toLocaleString()}.`,"success");
    await putJob(job);
    if(currentJob?.id===job.id)renderProgress(job);
    toast(`${job.fileName}: audit complete.`);
  }catch(error){
    await Promise.allSettled(checkpointTasks);
    await flushPendingBatches(job).catch(()=>{});
    stopClock(job);
    if(error.name==="AbortError"){
      job.status="paused";
      addLog(job,"Audit paused. Completed + pending batch checkpoints are saved on this device.","warn");
    }else{
      job.status="failed";
      job.error=error.message;
      addLog(job,error.message,"error");
    }
    job.updatedAt=timestamp();
    await putJob(job);
    if(currentJob?.id===job.id)renderProgress(job);
  }finally{
    controllers.delete(job.id);
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
    meta.textContent=`${(file.fileSize/1048576).toFixed(1)} MB · ${file.sheetName} · ${(file.leadCount??0).toLocaleString()} leads · ${(file.callCount??0).toLocaleString()} calls · ${(file.latestDayCalls??file.leads.length).toLocaleString()} latest-day · ${file.rowCount.toLocaleString()} Excel rows`;
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
  if(!parsedFiles.length){box.classList.add("hidden");box.textContent="";return;}
  box.classList.remove("hidden");
  box.className="validation";
  if(parsedFiles.length===1){
    const file=parsedFiles[0];
    box.textContent=`${(file.leadCount??0).toLocaleString()} leads · ${(file.callCount??0).toLocaleString()} calls · ${(file.latestDayCalls??file.leads.length).toLocaleString()} latest-day · ${file.rowCount.toLocaleString()} Excel rows`;
    return;
  }
  const leads=parsedFiles.reduce((sum,file)=>sum+(file.leadCount||0),0);
  const calls=parsedFiles.reduce((sum,file)=>sum+(file.callCount||0),0);
  const latest=parsedFiles.reduce((sum,file)=>sum+(file.latestDayCalls||file.leads?.length||0),0);
  const rows=parsedFiles.reduce((sum,file)=>sum+(file.rowCount||0),0);
  box.textContent=`${parsedFiles.length} files · ${leads.toLocaleString()} leads · ${calls.toLocaleString()} calls · ${latest.toLocaleString()} latest-day · ${rows.toLocaleString()} Excel rows`;
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
  await Promise.all(jobs.map(job=>runJob(job)));
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
      :`${timeText(job.createdAt)} · ${uniqueLeadCount(job)} leads · ${job.callCount??"—"} calls · ${job.results?.length||0}/${job.totalLeads} latest-day · ${durationText(job.elapsedMs||0)} · cost ${estimatedCost(job).toFixed(4)} · cached ${number(job.tokenUsage?.cached).toLocaleString()}`;
    info.append(title,document.createTextNode(" "),status,meta);
    actions.className="history-actions";
    const view=document.createElement("button");
    view.className="secondary-button";
    view.textContent="View run";
    view.onclick=()=>{displayLogs=true;renderProgress(job);showView("console");};
    actions.append(view);
    if(job.status==="completed"&&!legacy){
      const button=document.createElement("button");
      button.className="primary-button";
      button.textContent="Download";
      button.onclick=()=>download(job);
      actions.append(button);
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
    if(job.status==="running"){
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
}

function showUpdateBanner(latest){
  if(!els["update-banner"])return;
  els["update-banner"].classList.remove("hidden");
  els["update-banner-text"].innerHTML=`LeadLens <strong>v${latest}</strong> is available (you are on <strong>v${APP_VERSION}</strong>). Hard-reload to update: Windows/Linux <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd> · Mac <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>. Or use the button.`;
}
async function checkForUpdate(){
  if(els["app-version"])els["app-version"].textContent=APP_VERSION;
  try{
    const response=await fetch(`./version.json?t=${Date.now()}`,{cache:"no-store"});
    if(!response.ok)return;
    const data=await response.json();
    const latest=String(data.version||"").trim();
    if(latest&&latest!==APP_VERSION)showUpdateBanner(latest);
    else if(els["update-banner"])els["update-banner"].classList.add("hidden");
  }catch{/* offline or first local open */}
}

document.querySelectorAll(".nav-item").forEach(button=>button.addEventListener("click",()=>showView(button.dataset.view)));
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
  if(currentJob.status==="running")controllers.get(currentJob.id)?.abort();
  else await runJob(await getJob(currentJob.id));
};
els["download-result"].onclick=()=>currentJob&&download(currentJob);
els["clear-console"].onclick=()=>{displayLogs=false;renderLogs(currentJob);};
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
els["save-key"].onclick=()=>{
  const key=els["api-key"].value.trim();
  if(!key){els["key-message"].textContent="Enter a key.";return;}
  saveApiKey(key,els["remember-key"].checked);
  els["key-message"].textContent=els["remember-key"].checked?"Saved on this device.":"Saved for this browser session.";
  updateKeyState();
};
els["forget-key"].onclick=()=>{forgetApiKey();els["api-key"].value="";els["remember-key"].checked=false;els["key-message"].textContent="Key removed.";updateKeyState();};
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
  const next=collectSettings();
  if(!Number.isInteger(next.batchSize)||next.batchSize<1||next.batchSize>50){els["settings-message"].textContent="Batch size must be 1–50.";return;}
  if(!Number.isInteger(next.concurrency)||next.concurrency<1||next.concurrency>20){els["settings-message"].textContent="Parallel batches must be 1–20.";return;}
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
  if("serviceWorker" in navigator){
    const regs=await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map(reg=>reg.unregister()));
  }
  if(window.caches){
    const keys=await caches.keys();
    await Promise.all(keys.map(key=>caches.delete(key)));
  }
  location.reload();
});

window.addEventListener("beforeunload",event=>{
  if(!controllers.size)return;
  event.preventDefault();
  event.returnValue="";
});

renderSettings();
renderHistory();
restoreFromStorage();
checkForUpdate();
setInterval(()=>{if(currentJob?.status==="running")renderProgress(currentJob);},1000);
setInterval(checkForUpdate,5*60*1000);
if("serviceWorker" in navigator)navigator.serviceWorker.register("./service-worker.js").catch(()=>{});

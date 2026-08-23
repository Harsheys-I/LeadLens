import {putJob,getJob,getJobs,deleteJob,clearJobs,loadSettings,saveSettings,getApiKey,apiKeyIsRemembered,saveApiKey,forgetApiKey} from "./db.js";
import {DEFAULT_SETTINGS,normalizeSettings,parseWorkbook,auditBatch,downloadWorkbook} from "./audit.js";

const $=id=>document.getElementById(id);
const ids=["file-input","drop-zone","file-list","validation","start-audit","page-title","key-state","run-name","pause-run","download-result","progress-label","progress-percent","progress-bar","metric-leads","metric-batch","metric-completed","metric-status","metric-input-tokens","metric-cached-tokens","metric-output-tokens","metric-duration","metric-cost","live-log","clear-console","history-list","clear-history","api-key","remember-key","toggle-key","save-key","forget-key","key-message","batch-size","concurrency","model","input-field-config","ai-field-config","rule-config","add-rule","output-field-config","yes-values","no-values","additional-instructions","input-price","cached-price","output-price","save-settings","reset-settings","settings-message","toast","mobile-menu","active-job-switch"];
const els=Object.fromEntries(ids.map(id=>[id,$(id)]));
const titles={new:"New audit",console:"Run console",history:"History",settings:"Settings"};
const ENGINE_VERSION="latest-call-v2";
const ACTIVE_JOB_KEY="leadlens.activeJobId";

let parsedFiles=[],currentJob=null,displayLogs=true;
const controllers=new Map();
const saveChains=new Map();
let settings=normalizeSettings(loadSettings(DEFAULT_SETTINGS));

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
function toast(message){els.toast.textContent=message;els.toast.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>els.toast.classList.remove("show"),2800);}
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

function renderProgress(job){
  if(!job)return;
  currentJob=job;
  setActiveJobId(job.id);
  const total=job.totalLeads||0,done=job.results?.length||0,pct=total?Math.round(done/total*100):0;
  const batchSize=job.settings?.batchSize||1,batches=Math.ceil(total/batchSize),usage=job.tokenUsage||{};
  const concurrency=job.settings?.concurrency||1;
  els["run-name"].textContent=job.fileName||"No active audit";
  els["progress-label"].textContent=job.status==="completed"?"Audit complete":job.status==="running"?`Auditing with ${concurrency} parallel request${concurrency>1?"s":""}…`:job.status==="paused"?"Audit paused — ready to resume":job.status==="failed"?"Audit stopped — saved work is safe":"Waiting for a file";
  els["progress-percent"].textContent=`${pct}%`;
  els["progress-bar"].style.width=`${pct}%`;
  els["metric-leads"].textContent=total||"—";
  els["metric-batch"].textContent=total?`${Math.min((job.nextBatch||0)+1,batches)} / ${batches}`:"—";
  els["metric-completed"].textContent=total?`${done} / ${total}`:"—";
  els["metric-status"].textContent=job.status?job.status[0].toUpperCase()+job.status.slice(1):"Idle";
  els["metric-input-tokens"].textContent=number(usage.input).toLocaleString();
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
    meta.textContent=`${(file.fileSize/1048576).toFixed(1)} MB · ${file.sheetName} · ${file.leads.length.toLocaleString()} valid leads`;
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
  const leads=parsedFiles.reduce((sum,file)=>sum+file.leads.length,0);
  const invalid=parsedFiles.reduce((sum,file)=>sum+(file.invalidRows||0),0);
  box.textContent=parsedFiles.length===1
    ?`Ready: ${parsedFiles[0].rowCount.toLocaleString()} rows · ${leads.toLocaleString()} valid Indian mobile leads.${invalid?` ${invalid} invalid-mobile row(s) excluded.`:""}`
    :`Ready: ${parsedFiles.length} separate workbooks · ${leads.toLocaleString()} total valid leads. Each file runs as its own audit (not merged).${invalid?` ${invalid} invalid-mobile row(s) excluded.`:" "}`;
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
  displayLogs=true;
  const concurrency=Math.min(8,Math.max(1,Number(job.settings.concurrency)||1));
  addLog(job,`Run started: latest-call AI audit, batch size ${job.settings.batchSize}, parallel batches ${concurrency}, model ${job.settings.model}.`);
  await putJob(job);
  if(!currentJob||currentJob.id===job.id||!controllers.has(currentJob.id))renderProgress(job);
  showView("console");

  const batchSize=job.settings.batchSize;
  const totalBatches=Math.ceil(job.leads.length/batchSize);

  const persistUsage=usage=>{
    job.tokenUsage.input+=usage.input;
    job.tokenUsage.cached+=usage.cached;
    job.tokenUsage.output+=usage.output;
    if(currentJob?.id===job.id)renderProgress(job);
  };

  try{
    while(job.nextBatch<totalBatches){
      if(controller.signal.aborted)throw new DOMException("Aborted","AbortError");
      const waveStart=job.nextBatch;
      const waveSize=Math.min(concurrency,totalBatches-waveStart);
      const indexes=Array.from({length:waveSize},(_,i)=>waveStart+i);
      addLog(job,waveSize>1
        ?`Sending parallel wave: batches ${indexes[0]+1}–${indexes.at(-1)+1} of ${totalBatches}.`
        :`Sending batch ${indexes[0]+1}/${totalBatches} (${job.leads.slice(indexes[0]*batchSize,(indexes[0]+1)*batchSize).length} leads).`);
      if(currentJob?.id===job.id)renderProgress(job);

      const settled=await Promise.allSettled(indexes.map(index=>{
        const batch=job.leads.slice(index*batchSize,(index+1)*batchSize);
        return auditBatch(key,job.settings,batch,controller.signal,(message,level)=>addLog(job,message,level),persistUsage);
      }));

      await withJobSave(job.id,async()=>{
        for(let i=0;i<settled.length;i++){
          const outcome=settled[i];
          if(outcome.status==="rejected")throw outcome.reason;
          job.results.push(...outcome.value);
          job.nextBatch=indexes[i]+1;
          job.updatedAt=timestamp();
          addLog(job,`Batch ${indexes[i]+1} checkpoint saved. ${job.results.length}/${job.totalLeads} leads complete.`);
          await putJob(job);
          if(currentJob?.id===job.id)renderProgress(job);
        }
      });
    }
    job.status="completed";
    stopClock(job);
    job.updatedAt=timestamp();
    addLog(job,`Audit complete in ${durationText(job.elapsedMs)}. Estimated cost: ${estimatedCost(job).toFixed(4)}. Cached input tokens: ${number(job.tokenUsage.cached).toLocaleString()}.`,"success");
    await putJob(job);
    if(currentJob?.id===job.id)renderProgress(job);
    toast(`${job.fileName}: audit complete.`);
  }catch(error){
    stopClock(job);
    if(error.name==="AbortError"){
      job.status="paused";
      addLog(job,"Audit paused. Completed batches, token usage and logs are saved on this device.","warn");
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

async function startNew(){
  if(!parsedFiles.length)return;
  const jobs=[];
  for(const file of parsedFiles){
    const job={
      id:crypto.randomUUID(),
      engineVersion:ENGINE_VERSION,
      fileName:file.fileName,
      sheetName:file.sheetName,
      createdAt:timestamp(),
      updatedAt:timestamp(),
      status:"queued",
      totalLeads:file.leads.length,
      nextBatch:0,
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
  // Separate audits in parallel — files are never joined.
  await Promise.all(jobs.map(job=>runJob(job)));
}

function download(job){try{downloadWorkbook(job,settings);}catch(error){toast(error.message);}}

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
      :`${timeText(job.createdAt)} · ${job.results?.length||0}/${job.totalLeads} leads · ${durationText(job.elapsedMs||0)} · cost ${estimatedCost(job).toFixed(4)} · cached ${number(job.tokenUsage?.cached).toLocaleString()}`;
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
function renderInputFields(){
  els["input-field-config"].replaceChildren();
  for(const field of settings.inputFields){
    const row=configRow("config-row mapping-row"),toggle=input("checkbox","",`${field.label} enabled`),name=document.createElement("span"),aliases=input("text",field.aliases,`${field.label} aliases`);
    toggle.checked=field.required||field.enabled!==false;
    toggle.disabled=field.required;
    toggle.dataset.inputId=field.id;
    aliases.dataset.aliasId=field.id;
    name.textContent=field.label+(field.required?" *":"");
    aliases.placeholder="Accepted Excel headers, separated by commas";
    row.append(toggle,name,aliases);
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
  const options=["Lead Status + Comments",...settings.aiFields.map(field=>field.label)];
  if(current&&!options.includes(current))options.push(current);
  return options;
}
function renderRules(){
  els["rule-config"].replaceChildren();
  for(let index=0;index<settings.rules.length;index++){
    const rule=settings.rules[index],row=configRow("rule-row"),field=document.createElement("select"),instruction=document.createElement("textarea"),errors=input("text",rule.errors,"Possible errors"),remove=document.createElement("button");
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
    errors.placeholder="Possible errors, separated by commas";
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
  renderInputFields();
  renderAiFields();
  renderRules();
  renderOutputFields();
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
  next.inputFields=next.inputFields.map(field=>({...field,enabled:field.required||Boolean(document.querySelector(`[data-input-id="${field.id}"]`)?.checked),aliases:document.querySelector(`[data-alias-id="${field.id}"]`)?.value.trim()||field.aliases}));
  next.aiFields=next.aiFields.map(field=>({...field,enabled:Boolean(document.querySelector(`[data-ai-id="${field.id}"]`)?.checked),history:Boolean(document.querySelector(`[data-history-id="${field.id}"]`)?.checked)}));
  next.outputFields=next.outputFields.map(field=>({...field,enabled:Boolean(document.querySelector(`[data-output-id="${field.id}"]`)?.checked)}));
  next.rules=[...document.querySelectorAll("[data-rule-field]")].map(field=>{
    const index=field.dataset.ruleField;
    return{field:field.value,instruction:document.querySelector(`[data-rule-instruction="${index}"]`)?.value.trim()||"",errors:document.querySelector(`[data-rule-errors="${index}"]`)?.value.trim()||""};
  });
  return normalizeSettings(next);
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
els["save-settings"].onclick=()=>{
  const next=collectSettings();
  if(!Number.isInteger(next.batchSize)||next.batchSize<1||next.batchSize>50){els["settings-message"].textContent="Batch size must be 1–50.";return;}
  if(!Number.isInteger(next.concurrency)||next.concurrency<1||next.concurrency>8){els["settings-message"].textContent="Parallel batches must be 1–8.";return;}
  if(!next.model){els["settings-message"].textContent="Enter a model name.";return;}
  if(!next.outputFields.some(field=>field.enabled)){els["settings-message"].textContent="Select at least one output Excel field.";return;}
  settings=next;
  saveSettings(settings);
  els["settings-message"].textContent="Settings saved. New audits will use them; downloads use the current output selection.";
  renderSettings();
};
els["reset-settings"].onclick=()=>{settings=normalizeSettings(DEFAULT_SETTINGS);saveSettings(settings);renderSettings();els["settings-message"].textContent="Defaults restored.";};

window.addEventListener("beforeunload",event=>{
  if(!controllers.size)return;
  event.preventDefault();
  event.returnValue="";
});

renderSettings();
renderHistory();
restoreFromStorage();
setInterval(()=>{if(currentJob?.status==="running")renderProgress(currentJob);},1000);
if("serviceWorker" in navigator)navigator.serviceWorker.register("./service-worker.js").catch(()=>{});

export const APP_VERSION = "2.3.1";

export const ERROR_CATALOG = [
  {code:"0",label:"Comment displaying -ve, but Lead Status is +ve",hint:"-ve comment vs +ve status"},
  {code:"1",label:"Comment displaying +ve, but Lead Status is -ve",hint:"+ve comment vs -ve status"},
  {code:"2",label:"Followup Date is Missed",hint:"missed follow-up date"},
  {code:"3",label:"Customer Location is empty",hint:"connected + empty location"},
  {code:"4",label:"Customer Requirement is empty",hint:"connected + empty requirement"},
  {code:"5",label:"Estimated Budget is empty",hint:"connected + empty budget"},
  {code:"6",label:"Analysis Parameter is Empty",hint:"analysis parameter empty"}
];
export const ERROR_TYPES = ERROR_CATALOG.map(item=>item.label);
export const HIGH_SEVERITY_CODES = new Set(["0","1","2","3"]);
export const HIGH_SEVERITY_ERRORS = new Set(ERROR_CATALOG.filter(item=>HIGH_SEVERITY_CODES.has(item.code)).map(item=>item.label));

export const AI_FIELD_KEYS = {status:"s",comments:"c",next:"n",location:"l",requirement:"rq",budget:"b",connected:"k"};

export const DEFAULT_INPUT_FIELDS = [
  {id:"mobile",label:"Mobile",aliases:"mobile, mobile number, mobile no, phone, phone number",required:true},
  {id:"project",label:"Project Name",aliases:"project name, project",required:true},
  {id:"registration",label:"Lead Registration Date",aliases:"lead registration date, registration date",required:false},
  {id:"telecaller",label:"Telecaller Name",aliases:"telecaller name, tellecaller name, caller name, agent name",required:false},
  {id:"update",label:"Call / Lead Update Date",aliases:"lead update date, call date, update date",required:false},
  {id:"status",label:"Lead Status",aliases:"lead status, status",required:false},
  {id:"comments",label:"Comments",aliases:"comments, comment, remarks, remark",required:false},
  {id:"next",label:"Next Followup Date",aliases:"next followup date, next follow-up date, next follow up date",required:false},
  {id:"location",label:"Customer Location",aliases:"customer location, location",required:false},
  {id:"requirement",label:"Customer Requirement",aliases:"customer requirement, requirement",required:false},
  {id:"parameter",label:"Analysis Parameter",aliases:"analysis parameter, analysis parameters",required:false},
  {id:"budget",label:"Estimated Budget",aliases:"estimated budget, budget",required:false}
];
export const DEFAULT_AI_FIELDS = [
  {id:"status",label:"Lead Status",enabled:true,history:false},{id:"comments",label:"Comments",enabled:true,history:false},
  {id:"next",label:"Next Followup Date",enabled:true,history:false},{id:"location",label:"Customer Location",enabled:true,history:false},
  {id:"requirement",label:"Customer Requirement",enabled:true,history:false},{id:"budget",label:"Estimated Budget",enabled:true,history:false},
  {id:"connected",label:"Connected",enabled:true,history:false}
];
export const DEFAULT_OUTPUT_FIELDS = [
  {id:"project",label:"Project Name",enabled:true},{id:"mobile",label:"Mobile Number",enabled:true},{id:"registration",label:"Lead Registration Date",enabled:true},
  {id:"telecaller",label:"Telecaller Name",enabled:true},{id:"status",label:"Latest Lead Status",enabled:true},{id:"comments",label:"Comments",enabled:true},
  {id:"next",label:"Next Followup Date",enabled:true},{id:"totalFollowups",label:"Total Followups",enabled:true},{id:"location",label:"Customer Location",enabled:true},
  {id:"requirement",label:"Customer Requirement",enabled:true},{id:"parameter",label:"Analysis Parameter",enabled:true},{id:"budget",label:"Estimated Budget",enabled:true},
  {id:"commentQuality",label:"Comment Quality Score",enabled:true},{id:"errorTypes",label:"Error Type(s)",enabled:true},{id:"errorSeverity",label:"Error Severity",enabled:true},
  {id:"buyingIntent",label:"Buying Intent",enabled:true},{id:"observation",label:"AI Observation",enabled:true},{id:"recommendation",label:"AI Recommendation",enabled:true}
];
export const DEFAULT_RULES = [
  {field:"Lead Status + Comments",instruction:"Comments are source of truth. Emit code 0 only for clear -ve comment vs +ve status. Emit code 1 only for clear +ve comment vs -ve status. Neutral/not-connected is not a mismatch.",errors:"0,1"},
  {field:"Comment quality",instruction:"Score q 0-10. Reward specific requirement/budget/objection/next action. Generic or empty notes score low.",errors:""},
  {field:"Buying intent",instruction:"i=1 only for genuine positive purchase interest in latest comment/status; else i=0.",errors:""}
];
export const DEFAULT_SETTINGS = {
  batchSize:20,concurrency:2,model:"gpt-4o-mini",
  inputFields:DEFAULT_INPUT_FIELDS,aiFields:DEFAULT_AI_FIELDS,outputFields:DEFAULT_OUTPUT_FIELDS,rules:DEFAULT_RULES,
  yesValues:"yes, connected, call connected",noValues:"no, not connected, call not connected",
  additionalInstructions:"",
  sort:{field:"project",direction:"asc"},
  pricing:{input:0,cached:0,output:0}
};

/* Stable prefix sized just over OpenAI's ~1024-token cache floor. Keep static text first; lead payloads last. */
const CACHE_HANDBOOK = `LeadLens QA v2.3 compact auditor. Evidence only. Never invent facts, dates, budgets, locations, or prior calls.

INPUT KEYS (short): id=opaque lead id (echo exact), s=Lead Status, c=Comments, n=Next Followup, l=Location, rq=Requirement, b=Budget, k=Connected Yes/No/"". If a value is an array it is chronological history for that key only. Empty string means unknown. Location may already be blanked for project exceptions — do not restore it.

OUTPUT KEYS (short JSON only, schema a[]): id, q (int 0-10), e (array of error CODE strings only), i (0 or 1 buying intent), o (<=18 words), r (<=14 words). Do not output severity. Do not output full error sentences. No markdown fences.

ERROR CODES — emit codes only:
0 = -ve comment vs +ve status
1 = +ve comment vs -ve status
2 = missed follow-up date
3 = connected call + empty location
4 = connected call + empty requirement
5 = connected call + empty budget
6 = analysis parameter empty
Also emit only extra codes listed in RUN CHECKS. Prefer e:[] over weak guesses. App expands codes to Excel text.

q RUBRIC: 10=req+budget/objection+clear next action; 8-9=strong context+next step; 6-7=partial useful notes; 4-5=thin connected note; 2-3=boilerplate; 0-1=empty/unreadable.
i=1 only for genuine purchase interest (site visit, options request, active shortlist, budget toward buy). i=0 for CNP/busy/NI/wrong number/neutral admin/no interest signal.
Status mismatch: comments are source of truth. Neutral or not-connected comments are NOT mismatches.
If k is No or "", do not demand l/rq/b unless a run check explicitly requires it.
o must cite decisive evidence only. r must be one coaching/process action. Never dump the full comment into o or r.
Never drop an id. Never invent ids. Never merge leads.

EXAMPLES (patterns only):
A) s=Interested, c=not interested stop calling → e includes 0, i=0, low q if thin.
B) k=Yes, l/rq/b empty, c=talked later → low q, i=0; deterministic codes 3/4/5 may apply in-app.
C) s=Hot, c=2BHK Whitefield under 90L wants Saturday visit → high q, i=1, e:[].
D) k=No, c=ringing no answer → i=0, usually e:[] from model.
E) soft callback with active search → i may be 1; honor promised window in r.

Consistency: CNP/busy/switched off ≠ status mismatch. "SV fixed/positive" usually i=1. Boilerplate across leads → low q. Mixed-language comments OK — judge meaning. Insufficient data → short o + r asking what to capture next.

FIELD NOTES
- Dates may be DD/MM/YYYY. Do not convert timezones. Do not invent missing dates.
- Budget ranges stay as written; do not normalize currency.
- Requirement configs like 1BHK/2BHK/plot count as quality evidence.
- Telecaller CRM labels (Hot/Warm/Cold/NI/CNP/Busy) are interpreted with comment polarity, not alone.
- "Just enquiry/browsing" with no next step is usually i=0.
- Callback-after-salary / active locality search can support i=1 if interest continues.
- Budget objection with continued option openness can still be i=1; capture budget in r if missing.
- If history arrays exist, use them as context only; latest values drive i and status codes unless a run check says otherwise.
- Deterministic app checks may also add codes 2/3/4/5/6; you may still mention process gaps in o/r without inventing disallowed codes.
- Identical empty connected-call notes across many leads should stay low q.
- Emoji-only or symbol-only comments → q near 0.
- Illegal/harassing calling advice is forbidden in r.

OUTPUT DISCIPLINE
- Return exactly one object per input id inside a[].
- Keep o and r short: decisive evidence + one action.
- Never restate this handbook.
- Never output keys other than id,q,e,i,o,r.
- If unsure about a mismatch code, omit it.

This handbook is identical across batches for prompt caching. Unique lead payloads follow run checks.`;

const norm=value=>String(value??"").trim().toLowerCase().replace(/[_-]+/g," ").replace(/\s+/g," ");
const clean=value=>["","nan","none","nat","undefined","null"].includes(norm(value))?"":String(value).trim();
const clone=value=>JSON.parse(JSON.stringify(value));
const list=value=>String(value||"").split(",").map(norm).filter(Boolean);
const firstNonEmpty=values=>values.map(clean).find(Boolean)||"";
const defaultsById=(saved,fallback)=>fallback.map(base=>({...base,...((Array.isArray(saved)?saved:[]).find(item=>item.id===base.id)||{})}));

export function buildErrorMaps(settings=DEFAULT_SETTINGS){
  const byCode=new Map(ERROR_CATALOG.map(item=>[item.code,{...item}]));
  const byLabel=new Map(ERROR_CATALOG.map(item=>[norm(item.label),item.code]));
  let next=7;
  for(const rule of settings.rules||[]){
    for(const part of String(rule.errors||"").split(",")){
      const token=clean(part);
      if(!token)continue;
      if(byCode.has(token))continue;
      if(byLabel.has(norm(token)))continue;
      const code=String(next++);
      byCode.set(code,{code,label:token,hint:token.slice(0,48)});
      byLabel.set(norm(token),code);
    }
  }
  const resolve=token=>{
    const raw=clean(token);
    if(!raw)return"";
    if(byCode.has(raw))return raw;
    return byLabel.get(norm(raw))||"";
  };
  const labelOf=code=>byCode.get(clean(code))?.label||"";
  return{byCode,byLabel,resolve,labelOf};
}

function normalizeRuleErrors(rules,maps){
  return (rules||[]).map(rule=>{
    const codes=String(rule.errors||"").split(",").map(part=>maps.resolve(part)).filter(Boolean);
    return{...rule,errors:[...new Set(codes)].join(",")};
  });
}

export function normalizeSettings(saved={}){
  const merged={...clone(DEFAULT_SETTINGS),...saved};
  merged.inputFields=defaultsById(saved.inputFields,DEFAULT_INPUT_FIELDS);
  merged.aiFields=defaultsById(saved.aiFields,DEFAULT_AI_FIELDS);
  merged.outputFields=defaultsById(saved.outputFields,DEFAULT_OUTPUT_FIELDS);
  merged.rules=Array.isArray(saved.rules)?saved.rules:clone(DEFAULT_RULES);
  merged.pricing={...DEFAULT_SETTINGS.pricing,...(saved.pricing||{})};
  merged.sort={...DEFAULT_SETTINGS.sort,...(saved.sort||{})};
  if(!merged.outputFields.some(field=>field.id===merged.sort.field))merged.sort.field="project";
  merged.sort.direction=merged.sort.direction==="desc"?"desc":"asc";
  const concurrency=Number(merged.concurrency);
  merged.concurrency=Number.isInteger(concurrency)?Math.min(20,Math.max(1,concurrency)):DEFAULT_SETTINGS.concurrency;
  const batchSize=Number(merged.batchSize);
  merged.batchSize=Number.isInteger(batchSize)?Math.min(50,Math.max(1,batchSize)):DEFAULT_SETTINGS.batchSize;
  const maps=buildErrorMaps(merged);
  merged.rules=normalizeRuleErrors(merged.rules,maps);
  return merged;
}

function parseDate(value){
  if(value instanceof Date&&!Number.isNaN(value.valueOf()))return new Date(value.getFullYear(),value.getMonth(),value.getDate());
  if(typeof value==="number"&&window.XLSX?.SSF){const d=XLSX.SSF.parse_date_code(value);return d?new Date(d.y,d.m-1,d.d):null;}
  const s=clean(value);if(!s)return null;
  const match=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
  if(match){const year=match[3].length===2?Number(`20${match[3]}`):Number(match[3]);const d=new Date(year,Number(match[2])-1,Number(match[1]));return Number.isNaN(d.valueOf())?null:d;}
  const parsed=new Date(s);return Number.isNaN(parsed.valueOf())?null:new Date(parsed.getFullYear(),parsed.getMonth(),parsed.getDate());
}
const dateText=value=>{const d=value instanceof Date?value:parseDate(value);return d?`${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`:clean(value);};
export function indianMobile(value){let digits=clean(value).replace(/\.0$/,"").replace(/\D/g,"");if(digits.length===12&&digits.startsWith("91"))digits=digits.slice(2);if(digits.length===11&&digits.startsWith("0"))digits=digits.slice(1);return /^[6-9]\d{9}$/.test(digits)?digits:"";}
function fieldColumns(headers,fields){const normalized=headers.map(header=>({header,key:norm(header)}));return Object.fromEntries(fields.filter(field=>field.required||field.enabled!==false).map(field=>{const match=normalized.find(item=>list(field.aliases).includes(item.key));return[field.id,match?.header||""];}));}
function correctedAiLocation(project,location){const exceptions=new Set(["guru punvaanii eureka|bidadi","guru punvaanii ernika|anekal","guru punvaanii eka|anekal","guru punvaanii elegance|bheemenahalli"]);return exceptions.has(`${norm(project)}|${norm(location)}`)?"":location;}
function connectedFromParameter(parameter,settings){const value=norm(parameter);if(!value)return"";if(list(settings.yesValues).includes(value)||value==="yes")return"Yes";if(list(settings.noValues).includes(value)||value==="no")return"No";return"";}
function deterministicErrorCodes(latest,aiLocation){const codes=[];const today=new Date();today.setHours(0,0,0,0);if(latest.nextDate&&latest.nextDate<today)codes.push("2");if(!latest.parameter)codes.push("6");if(latest.connected==="Yes"&&!aiLocation)codes.push("3");if(latest.connected==="Yes"&&!latest.requirement)codes.push("4");if(latest.connected==="Yes"&&!latest.budget)codes.push("5");return codes;}
function contextValue(id,record,aiLocation){if(id==="connected")return record.connected;if(id==="next")return dateText(record.nextDate||record.next);if(id==="location")return aiLocation;return record[id]||"";}

export function parseWorkbook(arrayBuffer,rawSettings=DEFAULT_SETTINGS){
  if(!window.XLSX)throw new Error("Excel reader failed to load. Check the internet connection and reload.");
  const settings=normalizeSettings(rawSettings),workbook=XLSX.read(arrayBuffer,{type:"array",cellDates:true});
  const candidates=workbook.SheetNames.map(name=>{
    const rows=XLSX.utils.sheet_to_json(workbook.Sheets[name],{defval:"",raw:true}),headers=rows.length?Object.keys(rows[0]):[],columns=fieldColumns(headers,settings.inputFields);
    return{name,rows,columns,score:Object.values(columns).filter(Boolean).length};
  }).sort((a,b)=>b.score-a.score),selected=candidates[0];
  if(!selected?.columns.mobile||!selected?.columns.project)throw new Error("No sheet contains both Mobile and Project Name. Edit their aliases in Settings if your headers use different names.");
  const grouped=new Map();let lastMobile="",lastProject="",invalidRows=0;
  for(let index=0;index<selected.rows.length;index++){
    const row=selected.rows[index],rawMobile=clean(row[selected.columns.mobile]),rawProject=clean(row[selected.columns.project]);
    if(rawMobile)lastMobile=indianMobile(rawMobile);
    if(rawProject)lastProject=rawProject;
    if(!lastMobile||!lastProject){if(rawMobile)invalidRows++;continue;}
    const values={};
    for(const field of settings.inputFields)values[field.id]=clean(row[selected.columns[field.id]]);
    values.mobile=lastMobile;values.project=lastProject;
    const record={...values,rowIndex:index,updateDate:parseDate(values.update),nextDate:parseDate(values.next)},key=`${lastProject} | ${lastMobile}`;
    if(!grouped.has(key))grouped.set(key,[]);
    grouped.get(key).push(record);
  }
  const leads=[...grouped.entries()].map(([leadId,records])=>{
    records.sort((a,b)=>(a.updateDate?.valueOf()??a.rowIndex)-(b.updateDate?.valueOf()??b.rowIndex));
    for(const record of records)record.connected=connectedFromParameter(record.parameter,settings);
    const latest=records.at(-1),aiLocation=correctedAiLocation(latest.project,latest.location);
    const staticValues={
      project:latest.project,mobile:latest.mobile,registration:firstNonEmpty(records.map(record=>record.registration)),
      telecaller:latest.telecaller,status:latest.status,comments:latest.comments,next:dateText(latest.nextDate||latest.next),
      totalFollowups:records.length,location:latest.location,requirement:latest.requirement,parameter:latest.parameter,budget:latest.budget
    };
    const auditContext={};
    for(const field of settings.aiFields.filter(field=>field.enabled)){
      const key=AI_FIELD_KEYS[field.id]||field.id;
      auditContext[key]=field.history
        ?records.map(record=>contextValue(field.id,record,correctedAiLocation(record.project,record.location)))
        :contextValue(field.id,latest,aiLocation);
    }
    return{leadId,staticValues,auditContext,deterministicErrors:deterministicErrorCodes(latest,aiLocation)};
  });
  if(!leads.length)throw new Error("No valid Indian mobile numbers were found. Only 10-digit Indian mobiles starting with 6, 7, 8 or 9 are processed.");
  return{sheetName:selected.name,leads,rowCount:selected.rows.length,invalidRows};
}

function buildPrompt(settings){
  const maps=buildErrorMaps(settings);
  const codeLegend=[...maps.byCode.entries()].map(([code,item])=>`${code}:${item.hint||item.label}`).join(" | ");
  const rules=settings.rules.filter(rule=>clean(rule.instruction)).map((rule,index)=>{
    const codes=String(rule.errors||"").split(",").map(clean).filter(Boolean);
    return`${index+1}. ${clean(rule.field)||"check"}: ${clean(rule.instruction)}${codes.length?` codes:${codes.join(",")}`:""}`;
  }).join("\n");
  const extra=clean(settings.additionalInstructions);
  return `${CACHE_HANDBOOK}\n\nRUN CODES: ${codeLegend}\n\nRUN CHECKS:\n${rules||"none"}${extra?`\n\nEXTRA:\n${extra}`:""}`;
}
function promptCacheKey(settings){
  const material=JSON.stringify({v:APP_VERSION,model:settings.model,rules:settings.rules,additionalInstructions:settings.additionalInstructions||"",aiFields:settings.aiFields});
  let hash=2166136261;
  for(let i=0;i<material.length;i++){hash^=material.charCodeAt(i);hash=Math.imul(hash,16777619);}
  return `leadlens-${APP_VERSION}-${(hash>>>0).toString(16)}`;
}

const responseSchema={
  type:"object",additionalProperties:false,required:["a"],
  properties:{
    a:{
      type:"array",
      items:{
        type:"object",additionalProperties:false,
        required:["id","q","e","i","o","r"],
        properties:{
          id:{type:"string"},
          q:{type:"integer",minimum:0,maximum:10},
          e:{type:"array",items:{type:"string"}},
          i:{type:"integer",enum:[0,1]},
          o:{type:"string"},
          r:{type:"string"}
        }
      }
    }
  }
};

function clipWords(text,maxWords){
  const words=clean(text).split(/\s+/).filter(Boolean);
  return words.slice(0,maxWords).join(" ");
}

async function requestAudit(apiKey,settings,leads,signal,log,onUsage){
  const modelInput=leads.map(lead=>({id:lead.leadId,...lead.auditContext}));
  const response=await fetch("https://api.openai.com/v1/chat/completions",{
    method:"POST",signal,
    headers:{"Content-Type":"application/json","Authorization":`Bearer ${apiKey}`},
    body:JSON.stringify({
      model:settings.model,
      temperature:0,
      max_tokens:Math.max(256,leads.length*90),
      prompt_cache_key:promptCacheKey(settings),
      messages:[
        {role:"system",content:buildPrompt(settings)},
        {role:"user",content:`Audit ${leads.length}. Echo each id. Compact only.\n${JSON.stringify({L:modelInput})}`}
      ],
      response_format:{type:"json_schema",json_schema:{name:"ll_audit",strict:true,schema:responseSchema}}
    })
  });
  if(!response.ok){
    let detail="";
    try{detail=(await response.json()).error?.message||"";}catch{/* ignore */}
    throw new Error(`OpenAI ${response.status}: ${detail||response.statusText}`);
  }
  const data=await response.json(),usage=data.usage;
  const input=usage?.prompt_tokens??usage?.input_tokens??0;
  const cached=usage?.prompt_tokens_details?.cached_tokens??usage?.input_tokens_details?.cached_tokens??0;
  const output=usage?.completion_tokens??usage?.output_tokens??0;
  if(usage&&onUsage)onUsage({input,cached,output});
  if(usage&&log)log(`Tokens: ${input} in (${cached} cached, ${Math.max(0,input-cached)} billable), ${output} out.`,"info");
  const content=data.choices?.[0]?.message?.content;
  if(!content)throw new Error("OpenAI returned no audit content.");
  const parsed=JSON.parse(content);
  if(!Array.isArray(parsed.a))throw new Error("OpenAI response did not contain results array.");
  return parsed.a;
}

const unique=values=>[...new Set(values.filter(Boolean))];
const severityFromCodes=codes=>!codes.length?"NONE":codes.some(code=>HIGH_SEVERITY_CODES.has(code))?"HIGH":"MEDIUM";

export async function auditBatch(apiKey,rawSettings,batch,signal,log,onUsage){
  const settings=normalizeSettings(rawSettings);
  const maps=buildErrorMaps(settings);
  const allowed=new Set([...maps.byCode.keys()]);
  let result,lastError;
  for(let attempt=1;attempt<=3;attempt++){
    try{result=await requestAudit(apiKey,settings,batch,signal,log,onUsage);break;}
    catch(error){
      if(error.name==="AbortError")throw error;
      lastError=error;
      log(`Attempt ${attempt} failed: ${error.message}`,"error");
      if(attempt<3)await new Promise(resolve=>setTimeout(resolve,attempt*1500));
    }
  }
  if(!result)throw lastError;
  const byId=new Map(result.map(item=>[clean(item.id),item]));
  let missing=batch.filter(lead=>!byId.has(lead.leadId));
  if(missing.length){
    log(`Model omitted ${missing.length} lead(s); retrying only those leads.`,"warn");
    const recovered=await requestAudit(apiKey,settings,missing,signal,log,onUsage);
    recovered.forEach(item=>byId.set(clean(item.id),item));
    missing=batch.filter(lead=>!byId.has(lead.leadId));
  }
  if(missing.length)throw new Error(`OpenAI still omitted ${missing.length} lead(s). Saved batches are safe; resume to retry.`);
  return batch.map(lead=>{
    const ai=byId.get(lead.leadId);
    const aiCodes=Array.isArray(ai.e)?ai.e.map(code=>maps.resolve(code)).filter(code=>allowed.has(code)):[];
    const codes=unique([...lead.deterministicErrors,...aiCodes]);
    const labels=codes.map(code=>maps.labelOf(code)).filter(Boolean);
    const intent=Number(ai.i)===1||clean(ai.i)==="1"||norm(ai.i)==="yes"?"Yes":"No";
    return{
      ...lead.staticValues,
      commentQuality:ai.q,
      errorTypes:labels.length?labels.join(", "):"None",
      errorSeverity:severityFromCodes(codes),
      buyingIntent:intent,
      observation:clipWords(ai.o,18),
      recommendation:clipWords(ai.r,14)
    };
  });
}

export const selectedOutputFields=rawSettings=>normalizeSettings(rawSettings).outputFields.filter(field=>field.enabled);

const DATE_SORT_FIELDS=new Set(["registration","next","update"]);
function sortValue(row,fieldId){
  const raw=row?.[fieldId];
  if(DATE_SORT_FIELDS.has(fieldId)){
    const date=parseDate(raw);
    return date?date.valueOf():Number.NEGATIVE_INFINITY;
  }
  if(fieldId==="totalFollowups"||fieldId==="commentQuality")return Number(raw)||0;
  return String(raw??"").toLocaleLowerCase();
}
export function sortResults(rows,rawSettings=DEFAULT_SETTINGS){
  const settings=normalizeSettings(rawSettings);
  const field=settings.sort.field||"project";
  const dir=settings.sort.direction==="desc"?-1:1;
  return[...(rows||[])].sort((a,b)=>{
    const av=sortValue(a,field),bv=sortValue(b,field);
    let cmp=0;
    if(typeof av==="number"&&typeof bv==="number")cmp=av-bv;
    else cmp=String(av).localeCompare(String(bv),undefined,{numeric:true,sensitivity:"base"});
    if(cmp)return cmp*dir;
    return String(a.mobile??"").localeCompare(String(b.mobile??""))||String(a.project??"").localeCompare(String(b.project??""));
  });
}

export function downloadWorkbook(job,currentSettings){
  const settings=normalizeSettings(currentSettings);
  const fields=selectedOutputFields(settings);
  if(!fields.length)throw new Error("Select at least one output field in Settings.");
  const rows=sortResults(job.results||[],settings);
  const data=rows.map(row=>Object.fromEntries(fields.map(field=>[field.label,row[field.id]??""])));
  const sheet=XLSX.utils.json_to_sheet(data,{header:fields.map(field=>field.label)});
  sheet["!cols"]=fields.map(field=>({wch:Math.min(48,Math.max(14,field.label.length+2,...data.slice(0,100).map(row=>String(row[field.label]??"").length+2)))}));
  const mergeField=fields.find(field=>field.id===settings.sort.field)||fields.find(field=>field.id==="project");
  if(mergeField){
    const key=mergeField.label,col=fields.findIndex(field=>field.id===mergeField.id);
    let start=0;
    for(let i=1;i<=data.length;i++){
      if(i===data.length||data[i][key]!==data[start][key]){
        if(i-start>1){sheet["!merges"]=sheet["!merges"]||[];sheet["!merges"].push({s:{r:start+1,c:col},e:{r:i,c:col}});}
        start=i;
      }
    }
  }
  const book=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,sheet,"Audit Data");
  XLSX.writeFile(book,`Audit_Data_${new Date().toISOString().slice(0,10)}.xlsx`);
}

/**
 * DeBug Mode engine — CSV batches + composed per-error prompts + dynamic Structured Outputs.
 */
import {
  APP_VERSION,
  SERVER_API_KEY,
  AUDIT_RESPONSE_SCHEMA,
  AI_ALLOWED_ERRORS,
  HIGH_SEVERITY_ERRORS,
  buildChatCompletionBody,
  normalizeSettings,
  auditBatch,
  resolveAuditResultId,
} from "./audit.js?v=5.2.8";
import {
  LAB_ERROR_TYPES,
  SHARED_PREAMBLE,
  DEFAULT_ERROR_PROMPTS,
} from "./debug-prompts.js?v=5.2.8";

/** App-local labels — never shown in DeBug focus-lab results / Excel. */
const LOCAL_OWNED_ERRORS = new Set([
  "Follow-up Missed",
  "Analysis Parameter Empty",
  "Customer Location Empty",
  "Estimate Budget Empty"
]);

function csvCell(value){
  if(value==null)return"";
  if(typeof value==="number"&&Number.isFinite(value))return String(value);
  if(typeof value==="boolean")return value?"true":"false";
  if(Array.isArray(value)||(typeof value==="object"))return JSON.stringify(value);
  return String(value);
}

/** Build a CSV string for one AI batch: id + compact auditContext columns. */
export function leadsToCsv(batch){
  const rows=(batch||[]).map(lead=>{
    const ctx=lead?.auditContext&&typeof lead.auditContext==="object"?lead.auditContext:{};
    return{id:lead.leadId,...ctx};
  });
  const keySet=new Set(["id"]);
  for(const row of rows){
    for(const key of Object.keys(row))keySet.add(key);
  }
  const cols=["id",...[...keySet].filter(key=>key!=="id")];
  const aoa=[cols,...rows.map(row=>cols.map(col=>csvCell(row[col])))];
  if(typeof XLSX!=="undefined"&&XLSX?.utils?.aoa_to_sheet&&XLSX?.utils?.sheet_to_csv){
    const sheet=XLSX.utils.aoa_to_sheet(aoa);
    return XLSX.utils.sheet_to_csv(sheet);
  }
  const escape=value=>{
    const text=csvCell(value);
    if(/[",\n\r]/.test(text))return`"${text.replace(/"/g,'""')}"`;
    return text;
  };
  return aoa.map(line=>line.map(escape).join(",")).join("\n");
}

export function normalizeActiveErrorTypes(raw){
  const allowed=new Set(LAB_ERROR_TYPES);
  const list=Array.isArray(raw)?raw.map(item=>String(item||"").trim()).filter(label=>allowed.has(label)):[];
  const unique=[];
  for(const label of list){
    if(!unique.includes(label))unique.push(label);
  }
  return unique.length?unique:[LAB_ERROR_TYPES[0]];
}

/** Compose shared preamble + selected per-error prompt bodies + allowed e footer. */
export function composeDebugPrompt(settings){
  const active=normalizeActiveErrorTypes(settings?.activeErrorTypes);
  const prompts=settings?.errorPrompts&&typeof settings.errorPrompts==="object"?settings.errorPrompts:{};
  const parts=[SHARED_PREAMBLE];
  for(const label of active){
    const body=String(prompts[label]??"").trim();
    parts.push(`## Error focus: ${label}\n${body}`);
  }
  parts.push(`ALLOWED e labels (exact text only): ${active.join(" | ")}\nPrefer e:[] when unsure. Never invent other labels.\nFor each id, o must explain WHY every label in e was raised (evidence from s/c/rq/k).`);
  return parts.join("\n\n");
}

export function activePromptsReady(settings){
  const active=normalizeActiveErrorTypes(settings?.activeErrorTypes);
  const prompts=settings?.errorPrompts&&typeof settings.errorPrompts==="object"?settings.errorPrompts:{};
  const missing=active.filter(label=>!String(prompts[label]??"").trim());
  return{ok:!missing.length,missing,active};
}

/** Clone AUDIT_RESPONSE_SCHEMA with e.items.enum locked to active labels. */
export function buildDebugResponseSchema(activeErrorTypes){
  const active=normalizeActiveErrorTypes(activeErrorTypes);
  const schema=JSON.parse(JSON.stringify(AUDIT_RESPONSE_SCHEMA));
  const item=schema?.properties?.a?.items;
  if(item?.properties?.e){
    item.properties.e={type:"array",items:{type:"string",enum:active}};
  }
  return schema;
}

function parseErrorTypes(value){
  if(Array.isArray(value))return value.map(item=>String(item||"").trim()).filter(Boolean);
  const text=String(value??"").trim();
  if(!text||/^none$/i.test(text))return[];
  return text.split(",").map(part=>part.trim()).filter(Boolean);
}

/**
 * DeBug focus lab: keep ONLY active AI labels.
 * Strip all LOCAL_OWNED_ERRORS and any non-active AI labels (incl. hard-rule status when not selected).
 */
export function filterDebugResultErrors(row,activeErrorTypes){
  const active=new Set(normalizeActiveErrorTypes(activeErrorTypes));
  const errors=parseErrorTypes(row?.errorTypes);
  const kept=errors.filter(label=>active.has(label)&&!LOCAL_OWNED_ERRORS.has(label)&&AI_ALLOWED_ERRORS.has(label));
  const severity=!kept.length?"NONE":kept.some(label=>HIGH_SEVERITY_ERRORS.has(label))?"HIGH":"MEDIUM";
  return{
    ...row,
    errorTypes:kept.length?kept.join(", "):"None",
    errorSeverity:severity
  };
}

async function requestDebugAudit(apiKey,settings,leads,signal,log,onUsage){
  const ready=activePromptsReady(settings);
  if(!ready.ok){
    throw new Error(`Fill prompts for: ${ready.missing.join("; ")}`);
  }
  const system=composeDebugPrompt(settings);
  const schema=buildDebugResponseSchema(settings.activeErrorTypes);
  const csv=leadsToCsv(leads);
  const sentIds=(leads||[]).map(lead=>String(lead.leadId??""));
  const maxTokens=Math.max(500,leads.length*140);
  const auditBody=buildChatCompletionBody(settings.model,{
    temperature:0,
    maxTokens,
    messages:[
      {role:"system",content:system},
      {role:"user",content:`Audit ${leads.length} call(s). Echo each id. For each id, o must explain WHY each e label was raised.\n\n${csv}`}
    ],
    response_format:{type:"json_schema",json_schema:{name:"ll_audit",strict:true,schema}}
  });
  const useProxy=!apiKey||apiKey===SERVER_API_KEY;
  const response=await fetch(useProxy?"/api/openai/chat/completions":"https://api.openai.com/v1/chat/completions",{
    method:"POST",signal,
    credentials:useProxy?"same-origin":"omit",
    headers:useProxy
      ?{"Content-Type":"application/json",Accept:"application/json"}
      :{"Content-Type":"application/json","Authorization":`Bearer ${apiKey}`},
    body:JSON.stringify(auditBody)
  });
  if(!response.ok){
    let detail="";
    try{
      const errJson=await response.json();
      detail=errJson.error?.message||errJson.error||"";
    }catch{/* ignore */}
    throw new Error(`OpenAI ${response.status}: ${detail||response.statusText}`);
  }
  const data=await response.json(),usage=data.usage;
  const content=data.choices?.[0]?.message?.content;
  if(!content)throw new Error("OpenAI returned no audit content.");
  const parsed=JSON.parse(content);
  if(!Array.isArray(parsed.a))throw new Error("OpenAI response did not contain results array.");
  const claimed=new Set();
  for(const item of parsed.a){
    const pool=sentIds.filter(id=>!claimed.has(id));
    const resolved=resolveAuditResultId(item?.id,pool);
    if(resolved){
      claimed.add(resolved);
      item.id=resolved;
    }
  }
  const active=new Set(normalizeActiveErrorTypes(settings.activeErrorTypes));
  for(const item of parsed.a){
    if(Array.isArray(item.e)){
      item.e=item.e.map(token=>String(token||"").trim()).filter(label=>active.has(label)&&AI_ALLOWED_ERRORS.has(label)&&!LOCAL_OWNED_ERRORS.has(label));
    }
  }
  const input=usage?.prompt_tokens??usage?.input_tokens??0;
  const cached=usage?.prompt_tokens_details?.cached_tokens??usage?.input_tokens_details?.cached_tokens??0;
  const output=usage?.completion_tokens??usage?.output_tokens??0;
  if(usage&&onUsage)onUsage({input,cached,output});
  if(usage&&log)log(`Tokens: ${input} in (${cached} cached, ${Math.max(0,input-cached)} billable), ${output} out.`,"info");
  return parsed.a;
}

/** Same merge/retry as TeleCaller auditBatch; composed prompt + dynamic schema + strip local errors after merge. */
export async function debugAuditBatch(apiKey,rawSettings,batch,signal,log,onUsage){
  const settings=normalizeSettings(rawSettings);
  settings.activeErrorTypes=normalizeActiveErrorTypes(rawSettings?.activeErrorTypes??settings.activeErrorTypes);
  settings.errorPrompts=rawSettings?.errorPrompts&&typeof rawSettings.errorPrompts==="object"
    ?rawSettings.errorPrompts
    :(settings.errorPrompts||{});
  settings.focusErrorType=String(rawSettings?.focusErrorType||settings.focusErrorType||settings.activeErrorTypes[0]||"");
  // Prevent local-owned labels from being attached during merge (auditBatch still may add them; we strip after).
  const scrubbed=batch.map(lead=>{
    const next={...lead};
    if(Array.isArray(next.localErrors))next.localErrors=next.localErrors.filter(label=>!LOCAL_OWNED_ERRORS.has(label));
    if(Array.isArray(next.deterministicErrors))next.deterministicErrors=next.deterministicErrors.filter(label=>!LOCAL_OWNED_ERRORS.has(label));
    return next;
  });
  const rows=await auditBatch(apiKey,settings,scrubbed,signal,log,onUsage,requestDebugAudit);
  return rows.map(row=>filterDebugResultErrors(row,settings.activeErrorTypes));
}

function rowKey(row){
  return[
    String(row?.mobile??"").trim(),
    String(row?.project??"").trim(),
    String(row?.callDate??row?.update??"").trim(),
    String(row?.comments??"").slice(0,80)
  ].join(" | ");
}

function activeIntersection(errorTypes,activeSet){
  return parseErrorTypes(errorTypes)
    .filter(label=>activeSet.has(label)&&!LOCAL_OWNED_ERRORS.has(label)&&AI_ALLOWED_ERRORS.has(label));
}

/**
 * Diff DeBug results vs TeleCaller stock results for active AI error labels.
 * Prefer index pairing (same leads / same batch order); fall back to rowKey.
 * @returns {{agreement, onlyDebug, onlyTele, rows, unmatched}}
 */
export function compareDebugVsTelecaller(debugRows,teleRows,activeErrorTypes){
  const active=normalizeActiveErrorTypes(activeErrorTypes);
  const activeSet=new Set(active);
  const teleList=Array.isArray(teleRows)?teleRows:[];
  const teleByKey=new Map();
  teleList.forEach((row,index)=>{
    const key=rowKey(row);
    if(key&&!teleByKey.has(key))teleByKey.set(key,row);
    teleByKey.set(`#${index}`,row);
  });
  let agreement=0,onlyDebug=0,onlyTele=0,unmatched=0;
  const rows=[];
  (debugRows||[]).forEach((debugRow,index)=>{
    // Index-first: both runs share lead order when batched identically.
    let teleRow=teleList[index]??null;
    if(!teleRow){
      teleRow=teleByKey.get(rowKey(debugRow))||null;
      if(!teleRow)unmatched++;
    }
    const dSet=new Set(activeIntersection(debugRow?.errorTypes,activeSet));
    const tSet=new Set(activeIntersection(teleRow?.errorTypes,activeSet));
    const both=[...dSet].filter(label=>tSet.has(label));
    const debugOnly=[...dSet].filter(label=>!tSet.has(label));
    const teleOnly=[...tSet].filter(label=>!dSet.has(label));
    if(!debugOnly.length&&!teleOnly.length)agreement++;
    else{
      if(debugOnly.length)onlyDebug++;
      if(teleOnly.length)onlyTele++;
    }
    if(debugOnly.length||teleOnly.length){
      rows.push({
        mobile:debugRow?.mobile||"",
        project:debugRow?.project||"",
        status:debugRow?.status||"",
        connected:debugRow?.connected||"",
        debugErrors:[...dSet],
        teleErrors:[...tSet],
        onlyDebug:debugOnly,
        onlyTele:teleOnly,
        both,
        debugObservation:String(debugRow?.observation||"").trim(),
        teleObservation:String(teleRow?.observation||"").trim()
      });
    }
  });
  return{agreement,onlyDebug,onlyTele,active,rows,total:debugRows?.length||0,unmatched,teleTotal:teleList.length};
}

/** Strip DeBug-only keys so stock handbook path cannot pick up composed prompts. */
function stockAuditSettings(rawSettings){
  const settings=normalizeSettings(rawSettings&&typeof rawSettings==="object"?rawSettings:{});
  delete settings.errorPrompts;
  delete settings.activeErrorTypes;
  delete settings.focusErrorType;
  delete settings.customPrompt;
  return settings;
}

/** Run stock TeleCaller auditBatch over the same leads (does not mutate production settings). */
export async function telecallerAuditBatch(apiKey,rawSettings,batch,signal,log,onUsage){
  return auditBatch(apiKey,stockAuditSettings(rawSettings),batch,signal,log,onUsage);
}

export{
  APP_VERSION,
  requestDebugAudit,
  LAB_ERROR_TYPES,
  SHARED_PREAMBLE,
  DEFAULT_ERROR_PROMPTS,
  LOCAL_OWNED_ERRORS
};

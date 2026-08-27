/**
 * DeBug Mode engine — CSV batches + custom prompt + TeleCaller Structured Outputs schema.
 */
import {
  APP_VERSION,
  SERVER_API_KEY,
  AUDIT_RESPONSE_SCHEMA,
  buildChatCompletionBody,
  normalizeSettings,
  auditBatch,
} from "./audit.js?v=5.1.1";

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
  // Fallback manual CSV escape when SheetJS is unavailable.
  const escape=value=>{
    const text=csvCell(value);
    if(/[",\n\r]/.test(text))return`"${text.replace(/"/g,'""')}"`;
    return text;
  };
  return aoa.map(line=>line.map(escape).join(",")).join("\n");
}

async function requestDebugAudit(apiKey,settings,leads,signal,log,onUsage){
  const customPrompt=String(settings.customPrompt||"").trim();
  if(!customPrompt)throw new Error("Custom prompt is required in DeBug Settings.");
  const csv=leadsToCsv(leads);
  const auditBody=buildChatCompletionBody(settings.model,{
    temperature:0,
    maxTokens:Math.max(500,leads.length*140),
    messages:[
      {role:"system",content:customPrompt},
      {role:"user",content:`Audit ${leads.length} call(s). Echo each id.\n\n${csv}`}
    ],
    response_format:{type:"json_schema",json_schema:{name:"ll_audit",strict:true,schema:AUDIT_RESPONSE_SCHEMA}}
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
  const input=usage?.prompt_tokens??usage?.input_tokens??0;
  const cached=usage?.prompt_tokens_details?.cached_tokens??usage?.input_tokens_details?.cached_tokens??0;
  const output=usage?.completion_tokens??usage?.output_tokens??0;
  if(usage&&onUsage)onUsage({input,cached,output});
  if(usage&&log)log(`Tokens: ${input} in (${cached} cached, ${Math.max(0,input-cached)} billable), ${output} out.`,"info");
  return parsed.a;
}

/** Same merge/retry as TeleCaller auditBatch; uses customPrompt + CSV request builder. */
export async function debugAuditBatch(apiKey,rawSettings,batch,signal,log,onUsage){
  const settings=normalizeSettings(rawSettings);
  settings.customPrompt=String(rawSettings?.customPrompt??settings.customPrompt??"");
  return auditBatch(apiKey,settings,batch,signal,log,onUsage,requestDebugAudit);
}

export{APP_VERSION,requestDebugAudit};

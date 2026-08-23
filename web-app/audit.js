export const ERROR_TYPES = [
  "Comment displaying -ve, but Lead Status is +ve", "Comment displaying +ve, but Lead Status is -ve",
  "Followup Date is Missed", "Customer Location is empty", "Customer Requirement is empty",
  "Estimated Budget is empty", "Analysis Parameter is Empty"
];
export const HIGH_SEVERITY_ERRORS = new Set(["Followup Date is Missed", "Customer Location is empty", "Comment displaying -ve, but Lead Status is +ve", "Comment displaying +ve, but Lead Status is -ve"]);
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
  {id:"status",label:"Lead Status",enabled:true,history:false}, {id:"comments",label:"Comments",enabled:true,history:false},
  {id:"next",label:"Next Followup Date",enabled:true,history:false}, {id:"location",label:"Customer Location",enabled:true,history:false},
  {id:"requirement",label:"Customer Requirement",enabled:true,history:false}, {id:"budget",label:"Estimated Budget",enabled:true,history:false},
  {id:"connected",label:"Connected",enabled:true,history:false}
];
export const DEFAULT_OUTPUT_FIELDS = [
  {id:"project",label:"Project Name",enabled:true}, {id:"mobile",label:"Mobile Number",enabled:true}, {id:"registration",label:"Lead Registration Date",enabled:true},
  {id:"telecaller",label:"Telecaller Name",enabled:true}, {id:"status",label:"Latest Lead Status",enabled:true}, {id:"comments",label:"Comments",enabled:true},
  {id:"next",label:"Next Followup Date",enabled:true}, {id:"totalFollowups",label:"Total Followups",enabled:true}, {id:"location",label:"Customer Location",enabled:true},
  {id:"requirement",label:"Customer Requirement",enabled:true}, {id:"parameter",label:"Analysis Parameter",enabled:true}, {id:"budget",label:"Estimated Budget",enabled:true},
  {id:"commentQuality",label:"Comment Quality Score",enabled:true}, {id:"errorTypes",label:"Error Type(s)",enabled:true}, {id:"errorSeverity",label:"Error Severity",enabled:true},
  {id:"buyingIntent",label:"Buying Intent",enabled:true}, {id:"observation",label:"AI Observation",enabled:true}, {id:"recommendation",label:"AI Recommendation",enabled:true}
];
export const DEFAULT_RULES = [
  {field:"Lead Status + Comments",instruction:"Treat the comment as the source of truth. Return the negative/positive status mismatch error only when the comment clearly contradicts the Lead Status. A neutral or call-not-connected comment alone is not a status error.",errors:"Comment displaying -ve, but Lead Status is +ve, Comment displaying +ve, but Lead Status is -ve"},
  {field:"Comment quality",instruction:"Score comment quality from 0 to 10. Reward specific customer context, requirement, budget, objection or next action. Generic, empty or non-actionable comments score low.",errors:""},
  {field:"Buying intent",instruction:"Return Yes only when the latest comment and Lead Status show genuine positive intent; otherwise return No.",errors:""}
];
export const DEFAULT_SETTINGS = {batchSize:20,concurrency:2,model:"gpt-4o-mini",inputFields:DEFAULT_INPUT_FIELDS,aiFields:DEFAULT_AI_FIELDS,outputFields:DEFAULT_OUTPUT_FIELDS,rules:DEFAULT_RULES,yesValues:"yes, connected, call connected",noValues:"no, not connected, call not connected",additionalInstructions:"",pricing:{input:0,cached:0,output:0}};

/* Stable handbook kept at the front of every request so OpenAI prompt caching
   can reuse a long identical prefix (needs ~1024+ tokens). Lead data stays last. */
const CACHE_HANDBOOK = `LeadLens telecalling QA handbook (stable prefix for prompt caching).

ROLE
You are a strict, evidence-only telecalling quality auditor for real-estate / sales follow-up calls in India. You never invent facts. You never assume earlier calls unless history arrays are provided. You never rewrite customer data. You only judge the supplied fields.

INPUT CONTRACT
- Each lead arrives with a stable lead_id that you must echo unchanged.
- By default you receive latest-call values only. When a field is an array, that array is chronological history for that field alone.
- Connected is derived from Analysis Parameter using configured Yes/No vocabularies. Treat Connected as authoritative for whether the latest call connected.
- Customer Location may already be blanked for known project/location exceptions. Do not restore or guess a location.
- Dates may appear as DD/MM/YYYY strings. Do not convert timezones. Do not invent missing dates.
- Empty string means unknown / not captured. Do not fill empties from imagination.

OUTPUT CONTRACT
Return JSON matching the schema exactly.
For every lead_id return:
1. Comment Quality Score — integer 0 to 10
2. Error Type(s) — array of allowed error strings only, or []
3. Error Severity — HIGH, MEDIUM, or NONE (application may recompute severity later)
4. Buying Intent — Yes or No
5. AI Observation — short, concrete, evidence-based
6. AI Recommendation — short, actionable next step for the telecaller / supervisor

COMMENT QUALITY RUBRIC
10: Specific requirement, budget/range, location preference, objection, decision-maker, and clear next action
8-9: Strong context with requirement or budget plus a clear next step
6-7: Useful but incomplete notes; some customer context and a vague next step
4-5: Generic connected-call notes with little usable detail
2-3: One-line / boilerplate / “follow up later” with no substance
0-1: Empty, unreadable, or clearly non-actionable

BUYING INTENT RULES
- Yes only when latest comment and/or Lead Status show genuine positive purchase interest (site visit interest, budget discussion toward buying, request for options, active shortlisting).
- No for not connected, wrong number, busy, callback with no interest signal, pure objection with no reopen, junk, or neutral admin notes.
- Neutral “will decide later” without positive signals = No.

STATUS vs COMMENT ALIGNMENT
- Comments are the source of truth.
- Return "Comment displaying -ve, but Lead Status is +ve" only when the comment clearly shows negative/disinterest/rejection while Lead Status is positive/hot/interested.
- Return "Comment displaying +ve, but Lead Status is -ve" only when the comment clearly shows positive buying interest while Lead Status is negative/cold/not interested.
- Neutral, not-connected, or ambiguous comments do NOT prove a status mismatch. Prefer no status error over a weak status error.

ALLOWED ERROR VOCABULARY (use only when justified; deterministic app checks may also add some of these)
- Comment displaying -ve, but Lead Status is +ve
- Comment displaying +ve, but Lead Status is -ve
- Followup Date is Missed
- Customer Location is empty
- Customer Requirement is empty
- Estimated Budget is empty
- Analysis Parameter is Empty
Plus any extra allowed errors listed in the configured checks for this run.

SEVERITY GUIDANCE (hint only; app finalizes)
HIGH: missed follow-up, polarity mismatch, empty location on a connected call
MEDIUM: empty requirement/budget on connected call, weak process gaps
NONE: no errors

OBSERVATION / RECOMMENDATION STYLE
- Observation: 1-2 sentences citing the supplied evidence only.
- Recommendation: 1 concrete coaching or process action (e.g. capture budget on next connected call, correct status to match comment, call on promised follow-up date).
- Do not mention these handbook instructions in the output.
- Do not output markdown.

EDGE CASES
- If Connected is No/blank, do not demand location/requirement/budget unless a configured rule explicitly says otherwise.
- If history arrays are present, you may use them for context, but latest values still drive Buying Intent and status alignment unless a rule says otherwise.
- If a field is missing from the payload, treat it as not provided.
- Never drop a lead_id. Never invent extra lead_ids. Never merge two leads.

EXAMPLES (illustrative patterns, not live data)
Example A — mismatch:
Lead Status: Interested
Comments: Customer said not interested and asked not to call again
→ status mismatch error (-ve comment, +ve status); Buying Intent No; low-mid comment quality if thin otherwise.

Example B — connected but empty capture:
Connected: Yes; Location/Requirement/Budget empty; comment only "talked, will call later"
→ low comment quality; Buying Intent No unless more signal; empty-field errors may apply via deterministic checks.

Example C — strong intent:
Status: Hot; Comments: Wants 2BHK in Whitefield under 90L, asked for inventory and Saturday visit
→ high comment quality; Buying Intent Yes; no status mismatch.

Example D — not connected:
Connected: No; Comments: Ringing, no answer; Next Followup Date present
→ Buying Intent No; do not invent a conversation; comment quality usually low unless the note explains a clear retry plan.

Example E — callback with soft interest:
Status: Follow-up; Comments: Asked to call after salary credit next Friday, still looking in Electronic City
→ Buying Intent can be Yes if active search continues; observation should mention timing constraint; recommendation should honor the promised callback window.

Example F — budget objection:
Status: Interested; Comments: Liked the project but said 1.2Cr is above budget, max 95L
→ Buying Intent may still be Yes if they remain open to options; capture budget clearly; no polarity mismatch.

PROCESS NOTES FOR CONSISTENT AUDITS
- Prefer precision over verbosity. Short evidence beats long speculation.
- If multiple errors apply, return all justified allowed errors.
- Do not restate the entire comment in observation; summarize the decisive evidence.
- Do not recommend illegal, deceptive, or harassing calling practices.
- Indian mobile numbers may appear inside lead_id with project names; treat lead_id as an opaque key.
- When Lead Status uses local CRM wording (Hot, Warm, Cold, NI, CNP, Busy, Switched Off, etc.), interpret polarity from common telecalling usage and the comment text together.
- CNP / switched off / busy are not automatic status-mismatch errors.
- "Site visit fixed" or "SV done positive" is usually strong Buying Intent Yes.
- "Just enquiry / browsing" with no next step is usually Buying Intent No or weak Yes only if they requested options.
- If Estimated Budget is a range, keep it as given; do not normalize currency.
- If Customer Requirement mentions configuration (1BHK/2BHK/plot) keep that as evidence of quality.
- If Next Followup Date is in the past, the application may already flag missed follow-up; you may still mention it in observation when relevant, but do not invent that error if not allowed.
- Never output keys other than the schema fields.
- Never wrap JSON in markdown fences.

QUALITY GUARDRAILS
- Hallucinated locations, budgets, or family details are unacceptable.
- Copying a comment verbatim into AI Recommendation is unacceptable; recommendations must be coaching actions.
- If data is insufficient, say so briefly in observation and recommend what to capture next.
- Identical boilerplate comments across leads should score low even if grammatically fine.
- Mixed-language comments (English + local language transliteration) are valid evidence; judge meaning, not grammar.
- Emoji-only or symbol-only comments score near 0.
- If Buying Intent is Yes, observation should cite the positive signal; if No, cite the absence or negative signal.

This handbook is identical across batches so the API can cache it. Unique lead payloads always follow after the configured run checks.`;

const norm=value=>String(value??"").trim().toLowerCase().replace(/[_-]+/g," ").replace(/\s+/g," ");
const clean=value=>["","nan","none","nat","undefined","null"].includes(norm(value))?"":String(value).trim();
const clone=value=>JSON.parse(JSON.stringify(value));
const list=value=>String(value||"").split(",").map(norm).filter(Boolean);
const firstNonEmpty=values=>values.map(clean).find(Boolean)||"";
const defaultsById=(saved,fallback)=>fallback.map(base=>({...base,...((Array.isArray(saved)?saved:[]).find(item=>item.id===base.id)||{})}));
export function normalizeSettings(saved={}) {
  const merged={...clone(DEFAULT_SETTINGS),...saved};
  merged.inputFields=defaultsById(saved.inputFields,DEFAULT_INPUT_FIELDS);
  merged.aiFields=defaultsById(saved.aiFields,DEFAULT_AI_FIELDS);
  merged.outputFields=defaultsById(saved.outputFields,DEFAULT_OUTPUT_FIELDS);
  merged.rules=Array.isArray(saved.rules)?saved.rules:clone(DEFAULT_RULES);
  merged.pricing={...DEFAULT_SETTINGS.pricing,...(saved.pricing||{})};
  const concurrency=Number(merged.concurrency);
  merged.concurrency=Number.isInteger(concurrency)?Math.min(8,Math.max(1,concurrency)):DEFAULT_SETTINGS.concurrency;
  const batchSize=Number(merged.batchSize);
  merged.batchSize=Number.isInteger(batchSize)?Math.min(50,Math.max(1,batchSize)):DEFAULT_SETTINGS.batchSize;
  return merged;
}

function parseDate(value) { if(value instanceof Date&&!Number.isNaN(value.valueOf()))return new Date(value.getFullYear(),value.getMonth(),value.getDate()); if(typeof value==="number"&&window.XLSX?.SSF){const d=XLSX.SSF.parse_date_code(value);return d?new Date(d.y,d.m-1,d.d):null;}const s=clean(value);if(!s)return null;const match=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);if(match){const year=match[3].length===2?Number(`20${match[3]}`):Number(match[3]);const d=new Date(year,Number(match[2])-1,Number(match[1]));return Number.isNaN(d.valueOf())?null:d;}const parsed=new Date(s);return Number.isNaN(parsed.valueOf())?null:new Date(parsed.getFullYear(),parsed.getMonth(),parsed.getDate()); }
const dateText=value=>{const d=value instanceof Date?value:parseDate(value);return d?`${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`:clean(value);};
export function indianMobile(value) { let digits=clean(value).replace(/\.0$/,"").replace(/\D/g,"");if(digits.length===12&&digits.startsWith("91"))digits=digits.slice(2);if(digits.length===11&&digits.startsWith("0"))digits=digits.slice(1);return /^[6-9]\d{9}$/.test(digits)?digits:""; }
function fieldColumns(headers,fields){const normalized=headers.map(header=>({header,key:norm(header)}));return Object.fromEntries(fields.filter(field=>field.required||field.enabled!==false).map(field=>{const match=normalized.find(item=>list(field.aliases).includes(item.key));return[field.id,match?.header||""];}));}
function correctedAiLocation(project,location){const exceptions=new Set(["guru punvaanii eureka|bidadi","guru punvaanii ernika|anekal","guru punvaanii eka|anekal","guru punvaanii elegance|bheemenahalli"]);return exceptions.has(`${norm(project)}|${norm(location)}`)?"":location;}
function connectedFromParameter(parameter,settings){const value=norm(parameter);if(!value)return"";if(list(settings.yesValues).includes(value)||value==="yes")return"Yes";if(list(settings.noValues).includes(value)||value==="no")return"No";return"";}
function deterministicErrors(latest,aiLocation){const errors=[],today=new Date();today.setHours(0,0,0,0);if(latest.nextDate&&latest.nextDate<today)errors.push("Followup Date is Missed");if(!latest.parameter)errors.push("Analysis Parameter is Empty");if(latest.connected==="Yes"&&!aiLocation)errors.push("Customer Location is empty");if(latest.connected==="Yes"&&!latest.requirement)errors.push("Customer Requirement is empty");if(latest.connected==="Yes"&&!latest.budget)errors.push("Estimated Budget is empty");return errors;}
function contextValue(id,record,aiLocation){if(id==="connected")return record.connected;if(id==="next")return dateText(record.nextDate||record.next);if(id==="location")return aiLocation;return record[id]||"";}

export function parseWorkbook(arrayBuffer,rawSettings=DEFAULT_SETTINGS){if(!window.XLSX)throw new Error("Excel reader failed to load. Check the internet connection and reload.");const settings=normalizeSettings(rawSettings),workbook=XLSX.read(arrayBuffer,{type:"array",cellDates:true});const candidates=workbook.SheetNames.map(name=>{const rows=XLSX.utils.sheet_to_json(workbook.Sheets[name],{defval:"",raw:true}),headers=rows.length?Object.keys(rows[0]):[],columns=fieldColumns(headers,settings.inputFields);return{name,rows,columns,score:Object.values(columns).filter(Boolean).length};}).sort((a,b)=>b.score-a.score),selected=candidates[0];if(!selected?.columns.mobile||!selected?.columns.project)throw new Error("No sheet contains both Mobile and Project Name. Edit their aliases in Settings if your headers use different names.");const grouped=new Map();let lastMobile="",lastProject="",invalidRows=0;for(let index=0;index<selected.rows.length;index++){const row=selected.rows[index],rawMobile=clean(row[selected.columns.mobile]),rawProject=clean(row[selected.columns.project]);if(rawMobile)lastMobile=indianMobile(rawMobile);if(rawProject)lastProject=rawProject;if(!lastMobile||!lastProject){if(rawMobile)invalidRows++;continue;}const values={};for(const field of settings.inputFields)values[field.id]=clean(row[selected.columns[field.id]]);values.mobile=lastMobile;values.project=lastProject;const record={...values,rowIndex:index,updateDate:parseDate(values.update),nextDate:parseDate(values.next)},key=`${lastProject} | ${lastMobile}`;if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(record);}const leads=[...grouped.entries()].map(([leadId,records])=>{records.sort((a,b)=>(a.updateDate?.valueOf()??a.rowIndex)-(b.updateDate?.valueOf()??b.rowIndex));for(const record of records)record.connected=connectedFromParameter(record.parameter,settings);const latest=records.at(-1),aiLocation=correctedAiLocation(latest.project,latest.location),staticValues={project:latest.project,mobile:latest.mobile,registration:firstNonEmpty(records.map(record=>record.registration)),telecaller:latest.telecaller,status:latest.status,comments:latest.comments,next:dateText(latest.nextDate||latest.next),totalFollowups:records.length,location:latest.location,requirement:latest.requirement,parameter:latest.parameter,budget:latest.budget},auditContext={};for(const field of settings.aiFields.filter(field=>field.enabled)){auditContext[field.label]=field.history?records.map(record=>contextValue(field.id,record,correctedAiLocation(record.project,record.location))):contextValue(field.id,latest,aiLocation);}return{leadId,staticValues,auditContext,deterministicErrors:deterministicErrors(latest,aiLocation)};});if(!leads.length)throw new Error("No valid Indian mobile numbers were found. Only 10-digit Indian mobiles starting with 6, 7, 8 or 9 are processed.");return{sheetName:selected.name,leads,rowCount:selected.rows.length,invalidRows};}

function buildPrompt(settings){
  const rules=settings.rules.filter(rule=>clean(rule.instruction)).map((rule,index)=>`${index+1}. ${clean(rule.field)||"Audit check"}: ${clean(rule.instruction)}${clean(rule.errors)?` Allowed errors: ${clean(rule.errors)}.`:""}`).join("\n");
  const mandatory="Treat comments as the source of truth for status alignment: when a clearly negative comment is paired with a positive Lead Status, return 'Comment displaying -ve, but Lead Status is +ve'; when a clearly positive comment is paired with a negative Lead Status, return 'Comment displaying +ve, but Lead Status is -ve'. Neutral or call-not-connected comments do not prove a status mismatch.";
  const runChecks=`Configured checks for this run:\n${rules||"No extra checks."}${clean(settings.additionalInstructions)?`\n\nAdditional instructions:\n${clean(settings.additionalInstructions)}`:""}`;
  return `${CACHE_HANDBOOK}\n\n---\nMandatory validation:\n${mandatory}\n\n${runChecks}`;
}
function promptCacheKey(settings){
  const material=JSON.stringify({
    model:settings.model,
    rules:settings.rules,
    additionalInstructions:settings.additionalInstructions||"",
    aiFields:settings.aiFields
  });
  let hash=2166136261;
  for(let i=0;i<material.length;i++){hash^=material.charCodeAt(i);hash=Math.imul(hash,16777619);}
  return `leadlens-v2-${(hash>>>0).toString(16)}`;
}
const responseSchema={type:"object",additionalProperties:false,required:["analyzed_leads"],properties:{analyzed_leads:{type:"array",items:{type:"object",additionalProperties:false,required:["lead_id","Comment Quality Score","Error Type(s)","Error Severity","Buying Intent","AI Observation","AI Recommendation"],properties:{lead_id:{type:"string"},"Comment Quality Score":{type:"integer",minimum:0,maximum:10},"Error Type(s)":{type:"array",items:{type:"string"}},"Error Severity":{type:"string",enum:["HIGH","MEDIUM","NONE"]},"Buying Intent":{type:"string",enum:["Yes","No"]},"AI Observation":{type:"string"},"AI Recommendation":{type:"string"}}}}}};
async function requestAudit(apiKey,settings,leads,signal,log,onUsage){
  const modelInput=leads.map(lead=>({lead_id:lead.leadId,...lead.auditContext}));
  const response=await fetch("https://api.openai.com/v1/chat/completions",{
    method:"POST",
    signal,
    headers:{"Content-Type":"application/json","Authorization":`Bearer ${apiKey}`},
    body:JSON.stringify({
      model:settings.model,
      temperature:0,
      prompt_cache_key:promptCacheKey(settings),
      messages:[
        {role:"system",content:buildPrompt(settings)},
        {role:"user",content:`Audit ${leads.length} latest-call record(s). Preserve each exact lead_id.\n${JSON.stringify({leads:modelInput})}`}
      ],
      response_format:{type:"json_schema",json_schema:{name:"telecalling_latest_call_audits",strict:true,schema:responseSchema}}
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
  if(usage&&log)log(`Token usage: ${input} input (${cached} cached), ${output} output.`,"info");
  const content=data.choices?.[0]?.message?.content;
  if(!content)throw new Error("OpenAI returned no audit content.");
  const parsed=JSON.parse(content);
  if(!Array.isArray(parsed.analyzed_leads))throw new Error("OpenAI response did not contain analyzed_leads.");
  return parsed.analyzed_leads;
}
const unique=values=>[...new Set(values.filter(Boolean))];
const severity=errors=>!errors.length?"NONE":errors.some(error=>HIGH_SEVERITY_ERRORS.has(error))?"HIGH":"MEDIUM";
export async function auditBatch(apiKey,rawSettings,batch,signal,log,onUsage){const settings=normalizeSettings(rawSettings);let result,lastError;for(let attempt=1;attempt<=3;attempt++){try{result=await requestAudit(apiKey,settings,batch,signal,log,onUsage);break;}catch(error){if(error.name==="AbortError")throw error;lastError=error;log(`Attempt ${attempt} failed: ${error.message}`,"error");if(attempt<3)await new Promise(resolve=>setTimeout(resolve,attempt*1500));}}if(!result)throw lastError;const byId=new Map(result.map(item=>[clean(item.lead_id),item]));let missing=batch.filter(lead=>!byId.has(lead.leadId));if(missing.length){log(`Model omitted ${missing.length} lead(s); retrying only those leads.`,"warn");const recovered=await requestAudit(apiKey,settings,missing,signal,log,onUsage);recovered.forEach(item=>byId.set(clean(item.lead_id),item));missing=batch.filter(lead=>!byId.has(lead.leadId));}if(missing.length)throw new Error(`OpenAI still omitted ${missing.length} lead(s). Saved batches are safe; resume to retry.`);const allowed=new Set(["Comment displaying -ve, but Lead Status is +ve","Comment displaying +ve, but Lead Status is -ve",...settings.rules.flatMap(rule=>String(rule.errors||"").split(",").map(clean).filter(Boolean))]);return batch.map(lead=>{const ai=byId.get(lead.leadId),aiErrors=Array.isArray(ai["Error Type(s)"])?ai["Error Type(s)"].map(clean).filter(error=>allowed.has(error)):[],errors=unique([...lead.deterministicErrors,...aiErrors]);return{...lead.staticValues,commentQuality:ai["Comment Quality Score"],errorTypes:errors.length?errors.join(", "):"None",errorSeverity:severity(errors),buyingIntent:ai["Buying Intent"],observation:ai["AI Observation"],recommendation:ai["AI Recommendation"]};});}
export const selectedOutputFields=rawSettings=>normalizeSettings(rawSettings).outputFields.filter(field=>field.enabled);
export function downloadWorkbook(job,currentSettings){const fields=selectedOutputFields(currentSettings);if(!fields.length)throw new Error("Select at least one output field in Settings.");const rows=[...(job.results||[])].sort((a,b)=>String(a.project).localeCompare(String(b.project))||String(a.mobile).localeCompare(String(b.mobile))),data=rows.map(row=>Object.fromEntries(fields.map(field=>[field.label,row[field.id]??""]))),sheet=XLSX.utils.json_to_sheet(data,{header:fields.map(field=>field.label)});sheet["!cols"]=fields.map(field=>({wch:Math.min(48,Math.max(14,field.label.length+2,...data.slice(0,100).map(row=>String(row[field.label]??"").length+2)))}));const projectIndex=fields.findIndex(field=>field.id==="project");if(projectIndex>=0){const key=fields[projectIndex].label;let start=0;for(let i=1;i<=data.length;i++){if(i===data.length||data[i][key]!==data[start][key]){if(i-start>1){sheet["!merges"]=(sheet["!merges"]||[]);sheet["!merges"].push({s:{r:start+1,c:projectIndex},e:{r:i,c:projectIndex}});}start=i;}}}const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,"Audit Data");XLSX.writeFile(book,`Audit_Data_${new Date().toISOString().slice(0,10)}.xlsx`);}

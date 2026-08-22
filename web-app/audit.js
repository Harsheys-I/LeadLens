export const DEFAULT_PROMPT = `You are a senior real-estate telecalling QA auditor. Produce exactly one audit for every supplied lead.

The input includes chronological history and PRECOMPUTED deterministic audit facts. These facts are authoritative: copy follow_up_compliance and deterministic_errors exactly. Do not remove, rename, or invent deterministic errors. Assess only evidence in comments/history; never fabricate calls, budgets, dates, requirements, or outcomes.

Generic comments such as "called", "follow up", "sent details", or "no response" are Low quality unless they state an outcome and next action. Comment Quality: High = specific requirement/budget/objection/intent plus next action; Medium = some useful context; Low = generic, repeated, empty, or non-actionable. Lead Health: Hot = active/high intent; Warm = engaged but undecided; Cold = weak engagement; Dead = explicitly lost/not interested/invalid/unreachable after repeated meaningful attempts. Buying Intent is High, Moderate, Low, or None. Journey Score and TQI are integer 0–10. TQI measures timely execution, useful non-repetitive notes, status/parameter alignment and clear next actions—not whether the customer buys.

Error Severity is None when errors are ["None"]; High for a missed follow-up plus weak/missing audit data or a materially misleading journey; Medium for a missed follow-up or multiple data-quality errors; Low for one isolated data-quality error. Write a concise 1–3 sentence evidence-based journey summary and a concrete next action. Dead leads should be closed or cleaned up, not called again.`;

export const DEFAULT_SETTINGS = { batchSize: 20, model: "gpt-4o-mini", systemPrompt: DEFAULT_PROMPT };
export const OUTPUT_COLUMNS = ["Project Name", "Mobile Number", "Customer Name", "Telecaller Name", "Latest Lead Status", "Total Follow-ups", "Comment Quality Score", "Follow-up Compliance", "Error Type(s)", "Error Severity", "Lead Health", "Buying Intent", "Journey Score", "Telecaller Quality Index (TQI)", "AI Observation (Lead Journey Summary)", "AI Recommendation (Next Best Action)"];

const ALIASES = {
  mobile: ["mobile", "mobile number", "mobile no", "phone", "phone number"],
  project: ["project name", "project"], update: ["lead update date", "update date"],
  status: ["lead status", "status"], comments: ["comments", "comment", "remarks"],
  next: ["next followup date", "next follow-up date", "next follow up date"],
  location: ["customer location", "location"], requirement: ["customer requirement", "requirement"],
  budget: ["estimated budget", "budget"], parameter: ["analysis parameter", "analysis parameters"],
  telecaller: ["tellecaller name", "telecaller name", "caller name", "agent name"],
  customer: ["customer name", "lead name", "name"], registration: ["lead registration date", "registration date"]
};

const norm = value => String(value ?? "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
const clean = value => ["", "nan", "none", "nat", "undefined", "null"].includes(norm(value)) ? "" : String(value).trim();
const findColumns = headers => Object.fromEntries(Object.entries(ALIASES).map(([key, aliases]) => [key, headers.find(h => aliases.includes(norm(h)))]));

function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  if (typeof value === "number" && window.XLSX?.SSF) { const d = XLSX.SSF.parse_date_code(value); return d ? new Date(d.y, d.m - 1, d.d) : null; }
  const s = clean(value); if (!s) return null;
  const dm = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
  if (dm) return new Date(Number(dm[3].length === 2 ? `20${dm[3]}` : dm[3]), Number(dm[2]) - 1, Number(dm[1]));
  const parsed = new Date(s); return Number.isNaN(parsed.valueOf()) ? null : new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}
const dateText = d => d ? `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}` : "";
const first = values => values.map(clean).find(Boolean) || "";

export function parseWorkbook(arrayBuffer) {
  if (!window.XLSX) throw new Error("Excel reader failed to load. Check the internet connection and reload.");
  const workbook = XLSX.read(arrayBuffer, { type: "array", cellDates: true });
  const candidates = workbook.SheetNames.map(name => {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: "", raw: true });
    const headers = rows.length ? Object.keys(rows[0]) : [];
    const columns = findColumns(headers);
    const score = ["mobile","project","update","status","comments","next"].filter(k => columns[k]).length;
    return { name, rows, columns, score };
  }).sort((a,b) => b.score-a.score);
  const selected = candidates[0];
  if (!selected || selected.score < 6) throw new Error("No sheet contains the required lead columns: Mobile, Project Name, Lead Update Date, Lead Status, Comments and Next Followup Date.");
  const c = selected.columns; let lastMobile = "", lastProject = ""; const grouped = new Map();
  for (const row of selected.rows) {
    if (clean(row[c.mobile])) lastMobile = clean(row[c.mobile]).replace(/\.0$/, "");
    if (clean(row[c.project])) lastProject = clean(row[c.project]);
    if (!/^\d+$/.test(lastMobile) || !lastProject) continue;
    const key = `${lastProject} | ${lastMobile}`;
    const record = { update: parseDate(row[c.update]), status: clean(row[c.status]), comment: clean(row[c.comments]), next: parseDate(row[c.next]), parameter: clean(row[c.parameter]), location: clean(row[c.location]), requirement: clean(row[c.requirement]), budget: clean(row[c.budget]), telecaller: clean(row[c.telecaller]), customer: clean(row[c.customer]) };
    if (!grouped.has(key)) grouped.set(key, []); grouped.get(key).push(record);
  }
  const today = new Date(); today.setHours(0,0,0,0);
  const leads = [...grouped.entries()].map(([leadId, records]) => {
    records.sort((a,b) => (a.update?.valueOf() ?? Infinity) - (b.update?.valueOf() ?? Infinity));
    const statuses = records.map(r => r.status).filter(Boolean); const latestStatus = statuses.at(-1) || "";
    const location = first(records.map(r => r.location)), requirement = first(records.map(r => r.requirement)), budget = first(records.map(r => r.budget));
    let delayed = false, unknown = false;
    for (let i=1;i<records.length;i++) { const due=records[i-1].next, done=records[i].update; if (!due || !done) unknown=true; else if (done>due) delayed=true; }
    const active = new Set(["hot","warm","cold","open","new","follow up","follow-up","in progress"]);
    if (active.has(latestStatus.toLowerCase()) && records.at(-1).next && records.at(-1).next < today) delayed=true;
    const errors=[]; if(delayed) errors.push("Delayed Follow-up / Missed Schedule"); if(!budget) errors.push("Estimated Budget Missing in Master"); if(records.some(r=>!r.parameter)) errors.push("Analysis Parameter Missing"); if(!location) errors.push("Customer Location Missing in Master");
    return { lead_id: leadId, static: { "Project Name": leadId.slice(0, leadId.lastIndexOf(" | ")), "Mobile Number": leadId.slice(leadId.lastIndexOf(" | ")+3), "Customer Name": first(records.map(r=>r.customer)), "Telecaller Name": first(records.map(r=>r.telecaller)), "Latest Lead Status": latestStatus, "Total Follow-ups": records.length }, audit_facts: { customer_location: location, customer_requirement: requirement, estimated_budget: budget, deterministic_errors: errors.length ? errors : ["None"], follow_up_compliance: delayed ? "Delayed" : unknown ? "Unknown" : "Compliant" }, history: records.map(r=>({ lead_update_date:dateText(r.update), lead_status:r.status, comment:r.comment, next_followup_date:dateText(r.next), analysis_parameter:r.parameter })) };
  });
  if (!leads.length) throw new Error("No valid leads were found after grouping Project Name + numeric Mobile Number.");
  return { sheetName: selected.name, leads, rowCount: selected.rows.length };
}

const itemSchema = { type:"object", additionalProperties:false, required:["lead_id","Comment Quality Score","Follow-up Compliance","Error Type(s)","Error Severity","Lead Health","Buying Intent","Journey Score","Telecaller Quality Index (TQI)","AI Observation (Lead Journey Summary)","AI Recommendation (Next Best Action)"], properties:{ lead_id:{type:"string"}, "Comment Quality Score":{type:"string",enum:["High","Medium","Low"]}, "Follow-up Compliance":{type:"string",enum:["Compliant","Delayed","Unknown"]}, "Error Type(s)":{type:"string"}, "Error Severity":{type:"string",enum:["High","Medium","Low","None"]}, "Lead Health":{type:"string",enum:["Hot","Warm","Cold","Dead"]}, "Buying Intent":{type:"string",enum:["High","Moderate","Low","None"]}, "Journey Score":{type:"integer",minimum:0,maximum:10}, "Telecaller Quality Index (TQI)":{type:"integer",minimum:0,maximum:10}, "AI Observation (Lead Journey Summary)":{type:"string"}, "AI Recommendation (Next Best Action)":{type:"string"} } };

async function requestAudit(apiKey, settings, leads, signal, log, onUsage) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", { method:"POST", signal, headers:{"Content-Type":"application/json","Authorization":`Bearer ${apiKey}`}, body:JSON.stringify({ model:settings.model, temperature:0, messages:[{role:"system",content:settings.systemPrompt},{role:"user",content:`Audit all ${leads.length} leads and preserve each exact lead_id.\n${JSON.stringify({leads})}`}], response_format:{type:"json_schema",json_schema:{name:"telecalling_audits",strict:true,schema:{type:"object",additionalProperties:false,required:["analyzed_leads"],properties:{analyzed_leads:{type:"array",items:itemSchema}}}}} }) });
  if (!response.ok) { let detail=""; try { detail=(await response.json()).error?.message||""; } catch {} throw new Error(`OpenAI ${response.status}: ${detail || response.statusText}`); }
  const data=await response.json(); const usage=data.usage; const input=usage?.prompt_tokens ?? usage?.input_tokens ?? 0; const cached=usage?.prompt_tokens_details?.cached_tokens ?? usage?.input_tokens_details?.cached_tokens ?? 0; const output=usage?.completion_tokens ?? usage?.output_tokens ?? 0; if (usage && onUsage) onUsage({input,cached,output}); if (usage && log) log(`Token usage: ${input} input (${cached} cached), ${output} output.`,"info"); const content=data.choices?.[0]?.message?.content; if(!content) throw new Error("OpenAI returned no audit content.");
  const parsed=JSON.parse(content); if(!Array.isArray(parsed.analyzed_leads)) throw new Error("OpenAI response did not contain analyzed_leads."); return parsed.analyzed_leads;
}

export async function auditBatch(apiKey, settings, batch, signal, log, onUsage) {
  let result, lastError;
  for(let attempt=1;attempt<=3;attempt++){ try{ result=await requestAudit(apiKey,settings,batch,signal,log,onUsage); break; }catch(e){ if(e.name==="AbortError") throw e; lastError=e; log(`Attempt ${attempt} failed: ${e.message}`,"error"); if(attempt<3) await new Promise(r=>setTimeout(r,attempt*1500)); } }
  if(!result) throw lastError;
  const byId=new Map(result.map(r=>[clean(r.lead_id),r])); let missing=batch.filter(l=>!byId.has(l.lead_id));
  if(missing.length){ log(`Model omitted ${missing.length} lead(s); retrying only those leads.`,"warn"); const recovered=await requestAudit(apiKey,settings,missing,signal,log,onUsage); recovered.forEach(r=>byId.set(clean(r.lead_id),r)); missing=batch.filter(l=>!byId.has(l.lead_id)); }
  if(missing.length) throw new Error(`OpenAI still omitted ${missing.length} lead(s). Saved batches are safe; resume to retry.`);
  return batch.map(lead=>{ const ai=byId.get(lead.lead_id), f=lead.audit_facts; return {...lead.static,"Comment Quality Score":ai["Comment Quality Score"],"Follow-up Compliance":f.follow_up_compliance,"Error Type(s)":f.deterministic_errors.join(", "),"Error Severity":f.deterministic_errors[0]==="None"?"None":ai["Error Severity"],"Lead Health":ai["Lead Health"],"Buying Intent":ai["Buying Intent"],"Journey Score":ai["Journey Score"],"Telecaller Quality Index (TQI)":ai["Telecaller Quality Index (TQI)"],"AI Observation (Lead Journey Summary)":ai["AI Observation (Lead Journey Summary)"],"AI Recommendation (Next Best Action)":ai["AI Recommendation (Next Best Action)"]}; });
}

export function downloadWorkbook(job) {
  const rows=job.results.map(row=>Object.fromEntries(OUTPUT_COLUMNS.map(col=>[col,row[col]??""]))); const sheet=XLSX.utils.json_to_sheet(rows,{header:OUTPUT_COLUMNS});
  const widths=OUTPUT_COLUMNS.map(col=>({wch:Math.min(48,Math.max(14,col.length+2,...rows.slice(0,100).map(r=>String(r[col]??"").length+2)))})); sheet["!cols"]=widths;
  const book=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book,sheet,"Audit Data"); XLSX.writeFile(book,`Audit_Data_${new Date(job.createdAt).toISOString().slice(0,10)}.xlsx`);
}

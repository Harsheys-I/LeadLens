export const APP_VERSION = "2.4.7";

export const ERROR_CATALOG = [
  {code:"0",label:"Comment displaying -ve, but Lead Status is +ve",hint:"-ve comment vs +ve status"},
  {code:"1",label:"Comment displaying +ve, but Lead Status is -ve",hint:"+ve comment vs -ve status"},
  {code:"2",label:"Followup Date is Missed",hint:"missed follow-up date"},
  {code:"3",label:"Customer Location is empty",hint:"connected + empty/placeholder location"},
  {code:"4",label:"Customer Requirement is empty",hint:"connected + empty/placeholder requirement"},
  {code:"5",label:"Estimated Budget is empty",hint:"connected + empty/placeholder budget"},
  {code:"6",label:"Analysis Parameter is Empty",hint:"analysis parameter empty"},
  {code:"7",label:"Customer Requirement is set wrong",hint:"rq is call-status/comment junk, not a real customer requirement"}
];
export const ERROR_TYPES = ERROR_CATALOG.map(item=>item.label);
export const HIGH_SEVERITY_CODES = new Set(["0","1","2","3","7"]);
export const HIGH_SEVERITY_ERRORS = new Set(ERROR_CATALOG.filter(item=>HIGH_SEVERITY_CODES.has(item.code)).map(item=>item.label));

export const AI_FIELD_KEYS = {status:"s",comments:"c",next:"n",location:"l",requirement:"rq",budget:"b",connected:"k"};

export const DEFAULT_INPUT_FIELDS = [
  {id:"mobile",label:"Mobile",aliases:"mobile, mobile number, mobile no, phone, phone number",required:true},
  {id:"project",label:"Project Name",aliases:"project name, project",required:true},
  {id:"registration",label:"Lead Registration Date",aliases:"lead registration date, registration date",required:false},
  {id:"telecaller",label:"Telecaller Name",aliases:"telecaller name, tellecaller name, tele caller name, telle caller name, caller name, agent name, executive name",required:false},
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
  {id:"project",label:"Project Name",enabled:true},{id:"mobile",label:"Mobile Number",enabled:true},
  {id:"callDate",label:"Call Date",enabled:true},{id:"dayCallIndex",label:"Call # on Day",enabled:true},
  {id:"registration",label:"Lead Registration Date",enabled:true},
  {id:"telecaller",label:"Telecaller Name",enabled:true},{id:"status",label:"Lead Status",enabled:true},{id:"comments",label:"Comments",enabled:true},
  {id:"next",label:"Next Followup Date",enabled:true},{id:"totalFollowups",label:"Total Followups",enabled:true},{id:"dayCallCount",label:"Calls on Latest Day",enabled:true},
  {id:"connected",label:"Connected",enabled:true},
  {id:"location",label:"Customer Location",enabled:true},
  {id:"requirement",label:"Customer Requirement",enabled:true},{id:"parameter",label:"Analysis Parameter",enabled:true},{id:"budget",label:"Estimated Budget",enabled:true},
  {id:"commentQuality",label:"Comment Quality Score",enabled:true},{id:"errorTypes",label:"Error Type(s)",enabled:true},{id:"errorSeverity",label:"Error Severity",enabled:true},
  {id:"buyingIntent",label:"Buying Intent",enabled:true},{id:"observation",label:"AI Observation",enabled:true},{id:"recommendation",label:"AI Recommendation",enabled:true}
];
export const DEFAULT_RULES = [
  {field:"Lead Status + Comments",instruction:"Comments are source of truth. Emit code 0 only for clear -ve comment vs +ve status. Emit code 1 only for clear +ve comment vs -ve status. Neutral/not-connected is not a mismatch.",errors:"0,1"},
  {field:"Comment quality",instruction:"Score q strictly. q must reflect how well Comments capture the real telecaller–customer conversation (need, budget, location preference, objection, decision-maker, next step). One-word/CRM crumbs like visited/RNR/CNP/busy/followup = q 0-2 max. Generic connected notes without customer detail = q <=4. Only rich descriptive talk earns 8-10.",errors:""},
  {field:"Customer Requirement",instruction:"ONLY when k=Yes: rq must be a real customer requirement. Empty/placeholder (., -, **, NA) => code 4. Call jargon (RNR, Visited, etc.) => code 7. If k is No or blank, NEVER emit 4 or 7.",errors:"4,7"},
  {field:"AI Observation",instruction:"o is a QA judgment, NOT a rewrite of Comments. Forbidden: copying, lightly shortening, or paraphrasing c. Required: name what is missing/wrong/strong for audit (e.g. thin note, rq junk, status mismatch, missing budget on connected call). 18-28 words.",errors:""},
  {field:"AI Recommendation",instruction:"r must be a concrete telecaller coaching action: what to ask/capture/correct on the next call (fields, questions, status fix, follow-up discipline). Not vague ('follow up', 'update remarks'). 20-40 words, specific to THIS call's gaps.",errors:""},
  {field:"Buying intent",instruction:"i=1 only for genuine positive purchase interest in this call's comment/status; else i=0.",errors:""}
];
export const DEFAULT_SETTINGS = {
  batchSize:20,concurrency:2,model:"gpt-4o-mini",
  inputFields:DEFAULT_INPUT_FIELDS,aiFields:DEFAULT_AI_FIELDS,outputFields:DEFAULT_OUTPUT_FIELDS,rules:DEFAULT_RULES,
  yesValues:"yes, connected, call connected",noValues:"no, not connected, call not connected",
  additionalInstructions:"",
  sort:{field:"project",direction:"asc"},
  pricing:{input:0,cached:0,output:0}
};

/* Large stable prefix FIRST so OpenAI prompt caching can activate (>=1024 tokens;
   some models need closer to 2048). Run-specific rules come after; lead data last. */
const CACHE_HANDBOOK = `LeadLens QA v2.4.2 — stable cacheable auditor handbook. Evidence only. Never invent facts, dates, budgets, locations, or prior calls.

PURPOSE
You audit Indian real-estate telecalling follow-up notes. Judge only the supplied fields for THIS call id. Optional day[] lists sibling calls on the same latest calendar day — context only; still return one result for THIS id.

INPUT CONTRACT
- id: opaque lead/call id. Echo it exactly. Never invent or drop ids.
- s: Lead Status
- c: Comments (source of truth for conversation quality and status polarity)
- n: Next Followup Date (DD/MM/YYYY or "")
- l: Customer Location (may already be blanked for known project exceptions — do not restore)
- rq: Customer Requirement
- b: Estimated Budget
- k: Connected Yes / No / ""
- day[] (optional): siblings [{d,s,c,n,l,rq,b,k}, ...] same calendar day
Empty string means unknown / not captured.

OUTPUT CONTRACT (JSON schema a[] only)
For each id return:
- q: integer 0-10 comment quality
- e: array of error CODE strings only (never full sentences)
- i: 0 or 1 buying intent
- o: 18-28 words QA observation (analysis, not a comment copy)
- r: 20-40 words concrete coaching recommendation
No severity field. No markdown. No extra keys.

ERROR CODES (emit codes only)
0 = -ve comment vs +ve status
1 = +ve comment vs -ve status
2 = missed follow-up date
3 = connected + empty/placeholder location
4 = connected + empty/placeholder requirement
5 = connected + empty/placeholder budget
6 = empty analysis parameter
7 = requirement set wrong (call jargon / not a real customer requirement)
Prefer e:[] over weak guesses. The app may also add 2-6 deterministically.

COMMENT QUALITY q — STRICT
Comments must reflect the actual telecaller–customer talk (need, budget, locality preference, objection, decision-maker, next step).
10: rich conversation — config/area + budget/objection + decision context + clear next action
8-9: strong descriptive talk with customer need and next step
6-7: partial real conversation detail, still actionable
4-5: thin connected note, little customer substance
2-3: boilerplate / 2-3 vague words
0-1: empty, unreadable, or single CRM crumb
HARD CAPS: visited / visit / RNR / CNP / busy / followup / SV alone or near-alone => q<=2. Not descriptive => never score 8-10.

CUSTOMER REQUIREMENT rq
Valid examples: 2BHK, 30x40 plot, Whitefield, east facing, under 90L need, possession in 2027, etc.
INVALID when connected and non-blank (code 7): RNR, CNP, Visited, Site visit, Busy, Followup, Callback, Interested, Not interested, Connected, ringing, wrong number, status/comment dumps.
Placeholder-only (., -, NA, nil) on connected call => code 4 (empty), not 7.

BUYING INTENT i
i=1 only for genuine purchase interest (site visit interest, options request, active shortlist, budget toward buy).
i=0 for CNP/busy/NI/wrong number/neutral admin/no interest signal.

STATUS vs COMMENT
Comments win. Emit 0 only for clear -ve comment vs +ve status. Emit 1 only for clear +ve comment vs -ve status. Neutral / not-connected comments are NOT mismatches.

CONNECTED GATING
Codes 3, 4, 5, and 7 are ALLOWED ONLY when k=Yes.
If k is No or "", NEVER emit 3, 4, 5, or 7 — even if l/rq/b are empty, "**", ".", or junk.

STYLE — OBSERVATION (o) AND RECOMMENDATION (r)
o = auditor judgment about data quality / process gaps / mismatches. It must NOT copy, trim, or paraphrase Comments (c). Bad o examples: restating "customer visited", "wants 2BHK Whitefield". Good o examples: "Connected call note is non-descriptive; requirement captured as visit jargon; budget missing." / "Status says Interested but comment shows clear rejection — polarity mismatch."
r = specific next-call coaching: what questions to ask, which fields to fill (rq/location/budget), how to correct status, when to call back. Bad r: "Follow up", "Update comments", "Call again". Good r: "On next connected call ask preferred config, micro-market, and budget band; replace rq junk with real requirement; set follow-up date same day."
Never dump the full comment into o or r. Never restate this handbook.

EXAMPLES
A) c="visited" => q<=2, usually i=0.
B) k=Yes, rq="." or "" => code 4.
C) k=Yes, rq="RNR" or "Visited" => code 7.
D) k=Yes, rq="2BHK Whitefield" => rq OK.
E) day[] siblings present: score/flag THIS call only; siblings are context.
F) s=Interested, c=customer said not interested stop calling => code 0, i=0.
G) s=Hot, c=wants 2BHK under 90L Saturday visit => high q, i=1, e:[].
H) k=No, c=ringing no answer => i=0, usually e:[] from model.

EDGE CASES
- Mixed-language comments are valid; judge meaning, not grammar.
- Boilerplate repeated across leads stays low q.
- Emoji-only / symbol-only comments => q near 0.
- Insufficient data => short o + r asking what to capture next.
- Illegal or harassing calling advice is forbidden in r.
- Budget ranges stay as written; do not normalize currency.
- CRM labels Hot/Warm/Cold/NI/CNP/Busy need comment polarity, not label alone.
- "Just enquiry/browsing" with no next step is usually i=0.
- Callback-after-salary with active locality search can support i=1.
- If history arrays exist for a field, use as context; THIS call values still drive i and mismatch codes unless a run check says otherwise.

CACHE STABILITY PAD (identical every request — do not vary)
LeadLens keeps this handbook byte-stable so automatic prompt caching can reuse the prefix across batches in a run and across nearby reruns. Static instructions stay first; configured run checks follow; unique lead payloads stay last. Routing uses a stable prompt_cache_key derived from model + rules. Parallel workers must warm this prefix once before fanning out. Treat the following checklist as fixed operating procedure: verify id echo, apply q hard caps, distinguish rq empty vs wrong, gate l/rq/b on connected, keep outputs compact, never invent sibling calls, never merge two ids, never emit full error sentences, never emit severity, never wrap JSON in fences, never discuss pricing or tokens, never mention cache mechanics in o/r. Repeatable discipline improves audit consistency across telecalling QA shifts, projects, and batch sizes while preserving privacy of customer records inside the browser-only LeadLens workflow.

This handbook is identical across batches for prompt caching.`;

const norm=value=>String(value??"").trim().toLowerCase().replace(/[_-]+/g," ").replace(/\s+/g," ");
const clean=value=>["","nan","none","nat","undefined","null"].includes(norm(value))?"":String(value).trim();
const clone=value=>JSON.parse(JSON.stringify(value));
const list=value=>String(value||"").split(",").map(norm).filter(Boolean);
const firstNonEmpty=values=>values.map(clean).find(Boolean)||"";
/** Excel exports often write Mobile/Project/Telecaller once, then leave later rows blank. */
function fillDownWithinGroup(records,fieldId){
  let last="";
  for(const record of records){
    const value=clean(record[fieldId]);
    if(value)last=value;
    else if(last)record[fieldId]=last;
  }
  const first=firstNonEmpty(records.map(record=>record[fieldId]));
  if(first){
    for(const record of records){
      if(!clean(record[fieldId]))record[fieldId]=first;
    }
  }
}
function isBlankish(value){
  const s=clean(value);
  if(!s)return true;
  if(/^[.\-–—_/\\|,;:~`'"*+#]+$/.test(s))return true;
  const n=norm(s);
  return["na","n/a","n a","nil","none","null","blank","empty","dot","x","xx","xxx","tbd","not available"].includes(n);
}
const REQUIREMENT_JUNK=new Set([
  "rnr","cnp","visited","visit","sv","site visit","site visited","sv done","busy","switched off","switch off",
  "not connected","connected","follow up","followup","cb","callback","call back","ni","not interested",
  "interested","ringing","no answer","wrong number","wn","call later","will call","talked","spoke","ok","yes","no"
]);
function looksLikeWrongRequirement(value){
  if(isBlankish(value))return false;
  const n=norm(value);
  if(REQUIREMENT_JUNK.has(n))return true;
  if(/^(rnr|cnp|sv|ni|wn|cb)\b/.test(n)&&n.split(" ").length<=3)return true;
  return false;
}
function clampCommentQuality(score,comments){
  let q=Number(score);
  if(!Number.isFinite(q))q=0;
  q=Math.max(0,Math.min(10,Math.round(q)));
  const text=clean(comments);
  const words=text.split(/\s+/).filter(Boolean);
  const n=norm(text);
  if(!text)return Math.min(q,1);
  if(words.length===1)return Math.min(q,2);
  if(/^(visited|visit|rnr|cnp|busy|ni|follow\s*up|followup|site\s*visit|sv|sv\s*done|ringing|callback|call\s*back)$/.test(n))return Math.min(q,2);
  if(words.length===2)return Math.min(q,3);
  const hasDetail=/\d|bhk|sq\.?\s?ft|budget|lakh|lac|\bcr\b|interested|not interested|want|need|prefer|looking|location|callback|call back|objection|family|loan|possession|facing|plot|apartment|villa|whitefield|anekal|electronic city|sarjapur|price|discount|inventory/i.test(text);
  if(words.length<=4&&!hasDetail)return Math.min(q,4);
  if(!hasDetail&&words.length<8)return Math.min(q,5);
  return q;
}
function dayKey(date){
  if(!(date instanceof Date)||Number.isNaN(date.valueOf()))return"";
  return`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}
const defaultsById=(saved,fallback)=>fallback.map(base=>({...base,...((Array.isArray(saved)?saved:[]).find(item=>item.id===base.id)||{})}));

export function buildErrorMaps(settings=DEFAULT_SETTINGS){
  const byCode=new Map(ERROR_CATALOG.map(item=>[item.code,{...item}]));
  const byLabel=new Map(ERROR_CATALOG.map(item=>[norm(item.label),item.code]));
  let next=8;
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
function deterministicErrorCodes(call,aiLocation){
  const codes=[];
  const today=new Date();today.setHours(0,0,0,0);
  if(call.nextDate&&call.nextDate<today)codes.push("2");
  if(isBlankish(call.parameter))codes.push("6");
  if(call.connected==="Yes"){
    if(isBlankish(call.location))codes.push("3");
    if(isBlankish(call.requirement))codes.push("4");
    else if(looksLikeWrongRequirement(call.requirement))codes.push("7");
    if(isBlankish(call.budget))codes.push("5");
  }
  return codes;
}
function contextValue(id,record,aiLocation){if(id==="connected")return record.connected;if(id==="next")return dateText(record.nextDate||record.next);if(id==="location")return aiLocation;return record[id]||"";}
function callSnapshot(record){
  const aiLocation=correctedAiLocation(record.project,record.location);
  return{
    d:dateText(record.updateDate||record.update),
    s:record.status||"",
    c:record.comments||"",
    n:dateText(record.nextDate||record.next),
    l:aiLocation,
    rq:record.requirement||"",
    b:record.budget||"",
    k:record.connected||""
  };
}

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

  const leads=[];
  for(const [groupId,records] of grouped.entries()){
    records.sort((a,b)=>(a.updateDate?.valueOf()??a.rowIndex)-(b.updateDate?.valueOf()??b.rowIndex));
    // Carry agent/registration/status across blank follow-up rows inside the same lead
    // (CRM exports often write these once, then leave later rows empty).
    fillDownWithinGroup(records,"telecaller");
    fillDownWithinGroup(records,"registration");
    fillDownWithinGroup(records,"status");
    for(const record of records)record.connected=connectedFromParameter(record.parameter,settings);
    const dated=records.filter(record=>record.updateDate);
    const latestDay=dated.length
      ?dayKey(dated.reduce((best,record)=>record.updateDate.valueOf()>=best.updateDate.valueOf()?record:best).updateDate)
      :"";
    // All calls on the latest calendar day (or the last row if dates are missing).
    const dayCalls=latestDay
      ?records.filter(record=>dayKey(record.updateDate)===latestDay)
      :[records.at(-1)];
    const registration=firstNonEmpty(records.map(record=>record.registration));
    const telecaller=firstNonEmpty(records.map(record=>record.telecaller));
    const daySnapshots=dayCalls.map(callSnapshot);

    dayCalls.forEach((call,callIndex)=>{
      const aiLocation=correctedAiLocation(call.project,call.location);
      const staticValues={
        project:call.project,
        mobile:call.mobile,
        registration,
        telecaller:clean(call.telecaller)||telecaller,
        status:call.status,
        comments:call.comments,
        next:dateText(call.nextDate||call.next),
        callDate:dateText(call.updateDate||call.update),
        totalFollowups:records.length,
        dayCallCount:dayCalls.length,
        dayCallIndex:callIndex+1,
        connected:call.connected||"",
        location:call.location,
        requirement:call.requirement,
        parameter:call.parameter,
        budget:call.budget
      };
      const auditContext={};
      for(const field of settings.aiFields.filter(field=>field.enabled)){
        const key=AI_FIELD_KEYS[field.id]||field.id;
        auditContext[key]=field.history
          ?records.map(record=>contextValue(field.id,record,correctedAiLocation(record.project,record.location)))
          :contextValue(field.id,call,aiLocation);
      }
      // Always attach same-day sibling calls so multi-call days are not collapsed.
      if(daySnapshots.length>1)auditContext.day=daySnapshots;
      leads.push({
        leadId:`${groupId}#${call.rowIndex}`,
        groupId,
        staticValues,
        auditContext,
        deterministicErrors:deterministicErrorCodes(call,aiLocation)
      });
    });
  }
  if(!leads.length)throw new Error("No valid Indian mobile numbers were found. Only 10-digit Indian mobiles starting with 6, 7, 8 or 9 are processed.");
  return{sheetName:selected.name,leads,rowCount:selected.rows.length,invalidRows};
}

function buildPrompt(settings){
  const maps=buildErrorMaps(settings);
  // Stable catalog order first (helps identical prefixes), then any custom codes.
  const catalogCodes=ERROR_CATALOG.map(item=>`${item.code}:${item.hint||item.label}`);
  const customCodes=[...maps.byCode.entries()]
    .filter(([code])=>!ERROR_CATALOG.some(item=>item.code===code))
    .map(([code,item])=>`${code}:${item.hint||item.label}`);
  const codeLegend=[...catalogCodes,...customCodes].join(" | ");
  const rules=settings.rules.filter(rule=>clean(rule.instruction)).map((rule,index)=>{
    const codes=String(rule.errors||"").split(",").map(clean).filter(Boolean);
    return`${index+1}. ${clean(rule.field)||"check"}: ${clean(rule.instruction)}${codes.length?` codes:${codes.join(",")}`:""}`;
  }).join("\n");
  const extra=clean(settings.additionalInstructions);
  // Handbook first (cacheable), then run config (stable within a job), lead data stays in the user message.
  return `${CACHE_HANDBOOK}\n\nRUN CODES: ${codeLegend}\n\nRUN CHECKS:\n${rules||"none"}${extra?`\n\nEXTRA:\n${extra}`:""}`;
}
function promptCacheKey(settings){
  // Keep key stable for the whole run / identical settings so parallel requests route together.
  const material=JSON.stringify({
    v:APP_VERSION,
    model:settings.model,
    rules:settings.rules,
    additionalInstructions:settings.additionalInstructions||"",
    aiFields:(settings.aiFields||[]).map(field=>({id:field.id,enabled:field.enabled!==false,history:Boolean(field.history)}))
  });
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
function tokenSet(text){
  return new Set(norm(text).split(" ").filter(word=>word.length>1));
}
function isCommentEcho(observation,comments){
  const o=norm(observation),c=norm(comments);
  if(!o||!c)return false;
  if(o===c)return true;
  if(c.includes(o)&&o.split(" ").length>=3)return true;
  if(o.includes(c)&&c.split(" ").length>=3)return true;
  const ow=tokenSet(o),cw=tokenSet(c);
  if(ow.size<3)return c.includes(o);
  let overlap=0;
  for(const word of ow)if(cw.has(word))overlap++;
  return overlap/ow.size>=0.72;
}
function fallbackObservation(row,codes,q){
  const bits=[];
  if(q<=3)bits.push("Comment lacks a real telecaller–customer conversation.");
  if(codes.includes("0")||codes.includes("1"))bits.push("Lead status conflicts with comment polarity.");
  if(codes.includes("4"))bits.push("Connected call has empty/placeholder requirement.");
  if(codes.includes("7"))bits.push("Requirement field holds call jargon, not a customer need.");
  if(codes.includes("3"))bits.push("Connected call missing usable location.");
  if(codes.includes("5"))bits.push("Connected call missing budget.");
  if(codes.includes("2"))bits.push("Follow-up date is already past.");
  if(codes.includes("6"))bits.push("Analysis parameter is blank.");
  if(!bits.length)bits.push("Review note quality and field completeness for this call.");
  return clipWords(bits.join(" "),28);
}
function fallbackRecommendation(row,codes,q){
  const bits=[];
  if(q<=4)bits.push("Rewrite remarks with what the customer said: need, locality, budget, objection, and next step.");
  if(codes.includes("7")||codes.includes("4"))bits.push("On next connected call capture a real requirement (config/area), not RNR/Visited/status text.");
  if(codes.includes("3"))bits.push("Ask and save preferred micro-market/location.");
  if(codes.includes("5"))bits.push("Ask and save budget band before ending the call.");
  if(codes.includes("0")||codes.includes("1"))bits.push("Align Lead Status to the comment polarity immediately.");
  if(codes.includes("2"))bits.push("Call on/before the promised follow-up and set a fresh dated next step.");
  if(!bits.length)bits.push("Confirm interest, capture missing fields, and lock a dated next action the same day.");
  return clipWords(bits.join(" "),40);
}
function finalizeObservation(aiText,row,codes,q){
  const clipped=clipWords(aiText,28);
  if(!clipped||isCommentEcho(clipped,row.comments))return fallbackObservation(row,codes,q);
  return clipped;
}
function finalizeRecommendation(aiText,row,codes,q){
  const clipped=clipWords(aiText,40);
  const words=clipped.split(/\s+/).filter(Boolean);
  const vague=/^(follow\s*up|call\s*again|update\s*(comments?|remarks?)|try\s*later|connect\s*again)\.?$/i.test(clipped);
  if(!clipped||words.length<10||vague)return fallbackRecommendation(row,codes,q);
  return clipped;
}

async function requestAudit(apiKey,settings,leads,signal,log,onUsage){
  const modelInput=leads.map(lead=>({id:lead.leadId,...lead.auditContext}));
  const response=await fetch("https://api.openai.com/v1/chat/completions",{
    method:"POST",signal,
    headers:{"Content-Type":"application/json","Authorization":`Bearer ${apiKey}`},
    body:JSON.stringify({
      model:settings.model,
      temperature:0,
      max_tokens:Math.max(400,leads.length*120),
      prompt_cache_key:promptCacheKey(settings),
      messages:[
        {role:"system",content:buildPrompt(settings)},
        {role:"user",content:`Audit ${leads.length} call(s). Echo each id. o=QA analysis not comment copy; r=specific coaching.\n${JSON.stringify({L:modelInput})}`}
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
    // Connected-only field errors must never stick when Connected is not Yes (AI sometimes ignores gating).
    const connectedOnly=new Set(["3","4","5","7"]);
    const connectedYes=lead.staticValues.connected==="Yes";
    const filteredAi=connectedYes?aiCodes:aiCodes.filter(code=>!connectedOnly.has(code));
    const filteredDet=connectedYes?lead.deterministicErrors:lead.deterministicErrors.filter(code=>!connectedOnly.has(code));
    const merged=unique([...filteredDet,...filteredAi]);
    const codes=merged.includes("4")?merged.filter(code=>code!=="7"):merged;
    const labels=codes.map(code=>maps.labelOf(code)).filter(Boolean);
    const intent=Number(ai.i)===1||clean(ai.i)==="1"||norm(ai.i)==="yes"?"Yes":"No";
    const q=clampCommentQuality(ai.q,lead.staticValues.comments);
    return{
      ...lead.staticValues,
      commentQuality:q,
      errorTypes:labels.length?labels.join(", "):"None",
      errorSeverity:severityFromCodes(codes),
      buyingIntent:intent,
      observation:finalizeObservation(ai.o,lead.staticValues,codes,q),
      recommendation:finalizeRecommendation(ai.r,lead.staticValues,codes,q)
    };
  });
}

export function selectedOutputFields(rawSettings){
  const settings=normalizeSettings(rawSettings);
  const enabled=settings.outputFields.filter(field=>field.enabled!==false);
  const sortId=settings.sort?.field;
  const primary=enabled.find(field=>field.id===sortId);
  if(!primary)return enabled;
  return[primary,...enabled.filter(field=>field.id!==sortId)];
}

const DATE_SORT_FIELDS=new Set(["registration","next","update","callDate"]);
function sortValue(row,fieldId){
  const raw=row?.[fieldId];
  if(DATE_SORT_FIELDS.has(fieldId)){
    const date=parseDate(raw);
    return date?date.valueOf():Number.NEGATIVE_INFINITY;
  }
  if(fieldId==="totalFollowups"||fieldId==="commentQuality"||fieldId==="dayCallIndex"||fieldId==="dayCallCount")return Number(raw)||0;
  return String(raw??"").toLocaleLowerCase();
}
export function sortResults(rows,rawSettings=DEFAULT_SETTINGS){
  const settings=normalizeSettings(rawSettings);
  const field=settings.sort.field||"project";
  const dir=settings.sort.direction==="desc"?-1:1;
  return[...(rows||[])].sort((a,b)=>{
    const av=sortValue(a,field),bv=sortValue(b,field);
    let cmp=0;
    if(typeof av==="number"&&typeof bv==="number")cmp=av===bv?0:av<bv?-1:1;
    else cmp=String(av).localeCompare(String(bv),undefined,{numeric:true,sensitivity:"base"});
    if(cmp)return cmp*dir;
    const dateCmp=(parseDate(a.callDate)?.valueOf()??0)-(parseDate(b.callDate)?.valueOf()??0);
    if(dateCmp)return dateCmp;
    const idx=(Number(a.dayCallIndex)||0)-(Number(b.dayCallIndex)||0);
    if(idx)return idx;
    const mobileCmp=String(a.mobile??"").localeCompare(String(b.mobile??""),undefined,{numeric:true});
    if(mobileCmp)return mobileCmp;
    return String(a.project??"").localeCompare(String(b.project??""),undefined,{numeric:true,sensitivity:"base"});
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
  // Only merge adjacent cells for the active sort column (so sort order stays visible).
  const mergeField=fields.find(field=>field.id===settings.sort.field);
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
  const stamp=new Date().toISOString().slice(0,19).replace(/[:T]/g,"-");
  XLSX.writeFile(book,`Audit_Data_${stamp}_${settings.sort.field}-${settings.sort.direction}.xlsx`);
}

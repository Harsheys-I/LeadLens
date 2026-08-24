export const APP_VERSION = "3.2.3";
/** Bump when default AI rules / field defaults must refresh existing localStorage settings. */
export const SETTINGS_SEED = 12;

/** Settings limits — batch size is leads per request; concurrency is parallel requests. */
export const MAX_BATCH_SIZE = 20;
export const MAX_CONCURRENCY = 50;

export const ERROR_TYPES = [
  "Lead Status Not Aligned With Comments",
  "Fresh Call TAT Missed",
  "Follow-up Missed",
  "Estimate Budget Empty",
  "Customer Requirement Empty",
  "Customer Location Empty",
  "Analysis Parameter Empty",
  "Incorrect Customer Requirement"
];
export const HIGH_SEVERITY_ERRORS = new Set([
  "Lead Status Not Aligned With Comments",
  "Fresh Call TAT Missed",
  "Follow-up Missed",
  "Customer Location Empty",
  "Incorrect Customer Requirement"
]);
const STATUS_HISTORY_ERROR = "Lead Status Not Aligned With Comments";
const MISSED_30MIN_ERROR = "Fresh Call TAT Missed";
const FOLLOWUP_MISSED_ERROR = "Follow-up Missed";
const EMPTY_LOCATION = "Customer Location Empty";
const EMPTY_REQUIREMENT = "Customer Requirement Empty";
const EMPTY_BUDGET = "Estimate Budget Empty";
const EMPTY_PARAMETER = "Analysis Parameter Empty";
const WRONG_REQUIREMENT = "Incorrect Customer Requirement";
const CONNECTED_ONLY_ERRORS = new Set([
  EMPTY_LOCATION,
  EMPTY_REQUIREMENT,
  EMPTY_BUDGET,
  WRONG_REQUIREMENT
]);
/** Old numeric codes → labels (ignored in prompts; kept only to normalize leftover saved settings). */
const LEGACY_ERROR_CODES = {
  "2":FOLLOWUP_MISSED_ERROR,
  "3":EMPTY_LOCATION,
  "4":EMPTY_REQUIREMENT,
  "5":EMPTY_BUDGET,
  "6":EMPTY_PARAMETER,
  "7":WRONG_REQUIREMENT
};
/** Renamed / alias labels → canonical ERROR_TYPES text. */
const LEGACY_ERROR_LABELS = {
  "followup date is missed": FOLLOWUP_MISSED_ERROR,
  "follow up date is missed": FOLLOWUP_MISSED_ERROR,
  "follow-up date is missed": FOLLOWUP_MISSED_ERROR,
  "lead status not reflecting comment history": STATUS_HISTORY_ERROR,
  "comment displaying -ve, but lead status is +ve": STATUS_HISTORY_ERROR,
  "comment displaying +ve, but lead status is -ve": STATUS_HISTORY_ERROR,
  "missed 30min talk before": MISSED_30MIN_ERROR,
  "lead update not matching prior follow-up": FOLLOWUP_MISSED_ERROR,
  "customer location is empty": EMPTY_LOCATION,
  "customer requirement is empty": EMPTY_REQUIREMENT,
  "estimated budget is empty": EMPTY_BUDGET,
  "analysis parameter is empty": EMPTY_PARAMETER,
  "customer requirement is set wrong": WRONG_REQUIREMENT
};
export const AI_FIELD_KEYS = {status:"s",comments:"c",next:"n",location:"l",requirement:"rq",budget:"b",connected:"k"};

export const DEFAULT_INPUT_FIELDS = [
  {id:"mobile",label:"Mobile",aliases:"mobile, mobile number, mobile no, phone, phone number",required:true},
  {id:"project",label:"Project Name",aliases:"project name, project",required:true},
  {id:"registration",label:"Lead Registration Date",aliases:"lead registration date, registration date",required:false},
  {id:"telecaller",label:"Telecaller Name",aliases:"telecaller name, tellecaller name, tele caller name, telle caller name, caller name, agent name, executive name",required:false},
  {id:"update",label:"Lead Update Date",aliases:"lead update date, call date, update date, lead update, call / lead update date",required:false},
  {id:"status",label:"Lead Status",aliases:"lead status, status",required:false},
  {id:"comments",label:"Comments",aliases:"comments, comment, remarks, remark",required:false},
  {id:"next",label:"Next Followup Date",aliases:"next followup date, next follow-up date, next follow up date",required:false},
  {id:"location",label:"Customer Location",aliases:"customer location, location",required:false},
  {id:"requirement",label:"Customer Requirement",aliases:"customer requirement, requirement",required:false},
  {id:"parameter",label:"Analysis Parameter",aliases:"analysis parameter, analysis parameters",required:false},
  {id:"budget",label:"Estimated Budget",aliases:"estimated budget, budget",required:false}
];
export const DEFAULT_AI_FIELDS = [
  {id:"status",label:"Lead Status",enabled:true,history:false},
  {id:"comments",label:"Comments",enabled:true,history:true},
  {id:"next",label:"Next Followup Date",enabled:true,history:false},{id:"location",label:"Customer Location",enabled:true,history:false},
  {id:"requirement",label:"Customer Requirement",enabled:true,history:false},{id:"budget",label:"Estimated Budget",enabled:true,history:false},
  {id:"connected",label:"Connected",enabled:true,history:false}
];

/** Allowed Lead Status labels (case-insensitive). Rank: Prospect highest → Lost lowest. */
export const LEAD_STATUS_LADDER = [
  {label:"Prospect",rank:6},
  {label:"Hot",rank:5},
  {label:"Warm",rank:4},
  {label:"Cold",rank:3},
  {label:"Beyond Budget",rank:2},
  {label:"Lost",rank:1}
];
const STATUS_LADDER_TEXT = LEAD_STATUS_LADDER.map(item=>item.label).join(" > ") + " (highest → lowest)";
export const DEFAULT_OUTPUT_FIELDS = [
  {id:"mobile",label:"Mobile Number",enabled:true},{id:"project",label:"Project Name",enabled:true},
  {id:"callDate",label:"Lead Update Date",enabled:true},
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
  {field:"Lead Status + Comments",instruction:`Allowed Lead Status labels only (case-insensitive): Prospect, Hot, Warm, Cold, Beyond Budget, Lost. Heat ladder highest→lowest: ${STATUS_LADDER_TEXT}. c is ALWAYS the FULL chronological comment history (oldest→newest). HARD RULE — all-RNR / not connected: if EVERY non-empty comment in c is RNR-like (RNR, CNP, busy, ringing, WhatsApp follow-up/WA FU, no answer, switched off) AND k=No, then s MUST be lesser than Warm (only Cold, Beyond Budget, or Lost). If s is Warm, Hot, or Prospect in that case → emit "${STATUS_HISTORY_ERROR}". Trajectory: if early comments were highly positive but later entries cool to RNR/neutral/negative, s must step down; more than 2 continuous trailing RNR-like notes ⇒ s cannot be Prospect — emit "${STATUS_HISTORY_ERROR}". Opposite warm-up with cold status ⇒ same error. Do not emit any other status/comment polarity labels.`,errors:STATUS_HISTORY_ERROR},
  {field:"First talk SLA",instruction:`Inputs reg = Lead Registration DateTime, fu = FIRST Lead Update DateTime after near-duplicate filtering (oldest call, NOT the latest). Only when reg has a clock time AND falls between 09:30 and 17:00 inclusive: fu must be within 30 minutes after reg. If fu is missing, earlier than reg, or more than 30 minutes later → emit "${MISSED_30MIN_ERROR}". If reg is outside 09:30–17:00, or reg is date-only (no usable time), do nothing for this check.`,errors:MISSED_30MIN_ERROR},
  {field:"Follow-up Missed",instruction:`If n (this call's Next Followup) is a past calendar date before today → emit "${FOLLOWUP_MISSED_ERROR}". Do not emit any other follow-up timing errors.`,errors:FOLLOWUP_MISSED_ERROR},
  {field:"Comment quality",instruction:"Score q strictly. q must reflect how well Comments capture the real telecaller–customer conversation (need, budget, location preference, objection, decision-maker, next step). One-word/CRM crumbs like visited/RNR/CNP/busy/followup = q 0-2 max. Generic connected notes without customer detail = q <=4. Only rich descriptive talk earns 8-10. When c is an array, score THIS call's latest comment (last entry), using earlier entries only as context.",errors:""},
  {field:"Customer Requirement",instruction:`Only review the Customer Requirement when the call actually connected (Connected / k = Yes). On a connected call, rq should describe what the customer genuinely wants — for example a home configuration (2BHK/3BHK/plot), a budget, a preferred location/locality, facing, or a possession timeline. If rq is blank or only a placeholder such as ".", "-", "**", "NA" or "nil", raise "${EMPTY_REQUIREMENT}". If rq instead holds call notes or jargon rather than a real need — for example RNR, CNP, Visited, Site visit, Busy, Follow-up, Callback, Interested/Not interested — raise "${WRONG_REQUIREMENT}". When the call did not connect (Connected / k = No or blank), leave the requirement alone and never raise either of these two errors.`,errors:`${EMPTY_REQUIREMENT} | ${WRONG_REQUIREMENT}`},
  {field:"AI Observation",instruction:"o is a QA judgment, NOT a rewrite of Comments. Forbidden: copying, lightly shortening, or paraphrasing c. Required: name what is missing/wrong/strong for audit (e.g. thin note, status too high for all-RNR/not-connected, missed first-talk SLA, missing budget on connected call). 18-28 words.",errors:""},
  {field:"AI Recommendation",instruction:"r must be a concrete telecaller coaching action: what to ask/capture/correct on the next call (fields, questions, status fix down/up the Prospect→Lost ladder, follow-up discipline). Not vague ('follow up', 'update remarks'). 20-40 words, specific to THIS call's gaps.",errors:""},
  {field:"Buying intent",instruction:"i=1 only for genuine positive purchase interest in THIS call's latest comment/status; else i=0. Earlier history alone does not set i=1 if the latest comment cooled. All-RNR / k=No ⇒ i=0.",errors:""}
];
/* gpt-5-nano OpenAI list price (USD/1M): $0.05 input, $0.005 cached, $0.40 output.
   Defaults stored as ₹/1M using ₹87/USD (OpenAI publishes USD only).
   https://developers.openai.com/api/docs/models/gpt-5-nano */
export const DEFAULT_REVIEW_PRICING={input:4.35,cached:0.435,output:34.8};
export const DEFAULT_SETTINGS = {
  batchSize:20,concurrency:2,model:"gpt-4o-mini",reviewModel:"gpt-5-nano",
  inputFields:DEFAULT_INPUT_FIELDS,aiFields:DEFAULT_AI_FIELDS,outputFields:DEFAULT_OUTPUT_FIELDS,rules:DEFAULT_RULES,
  yesValues:"Booked In Other GPP Project, Booked in other project, Channel Partner Enquiry, Cross Pitched to Other GPP Project, Didnt Disclose, Immediate Possession, In Progress, Inventory Issue, Investment, Location Mismatch, Looking for commercial property, Not Interested, Plan Dropped, Pre Launch, Price mismatch, Property Mismatch, Site Visited",
  noValues:"1st RNR, 2nd RNR, 3rd RNR, Call Disconnected, Continues RNR, Duplicate Lead, Junk Lead, Marketing Enquiry, RNR, Re-Open, Wrong Number",
  additionalInstructions:"",
  sort:{field:"callDate",direction:"asc"},
  pricing:{input:0,cached:0,output:0},
  reviewPricing:{...DEFAULT_REVIEW_PRICING}
};

/** GPT-5 / o-series Chat Completions: use max_completion_tokens; omit non-default temperature. */
export function needsMaxCompletionTokens(model){
  const id=String(model||"").trim().toLowerCase();
  if(!id)return false;
  if(id.includes("gpt-5-chat"))return false;
  return /(^|[^a-z])(gpt-5|o1|o3|o4)([.-]|$)/.test(id)||/^o[134]/.test(id);
}
export function buildChatCompletionBody(model,{temperature,maxTokens,messages,...rest}){
  const body={model,messages,...rest};
  if(needsMaxCompletionTokens(model)){
    body.max_completion_tokens=maxTokens;
    // Reasoning models only accept default temperature — omit the field entirely.
  }else{
    body.max_tokens=maxTokens;
    if(temperature!==undefined)body.temperature=temperature;
  }
  return body;
}

/* Large stable prefix FIRST so OpenAI prompt caching can activate (>=1024 tokens;
   some models need closer to 2048). Run-specific rules come after; lead data last. */
const CACHE_HANDBOOK = `LeadLens QA v3.2.3 — stable cacheable auditor handbook. Evidence only. Never invent facts, dates, budgets, locations, or prior calls.

PURPOSE
You audit Indian real-estate telecalling follow-up notes. Judge only the supplied fields for THIS call id. Optional day[] lists sibling calls on the same latest calendar day — context only; still return one result for THIS id.

INPUT CONTRACT
- id: opaque lead/call id. Echo it exactly. Never invent or drop ids.
- s: Lead Status on THIS call
- c: Comments — ALWAYS full chronological history array for the lead (oldest→newest). Status trajectory uses the entire array; q/i focus on the last entry
- n: Next Followup Date for THIS call (DD/MM/YYYY or DD/MM/YYYY HH:MM or "")
- u: THIS call's Lead Update DateTime
- pn: previous call's Next Followup DateTime (empty on the lead's first call)
- l: Customer Location (may already be blanked for known project exceptions — do not restore)
- rq: Customer Requirement
- b: Estimated Budget
- k: Connected Yes / No / ""
- reg: Lead Registration DateTime (DD/MM/YYYY or DD/MM/YYYY HH:MM) — lead-level
- fu: FIRST Lead Update DateTime after near-duplicate filtering (oldest call only — NOT the latest)
- day[] (optional): siblings [{d,s,c,n,l,rq,b,k}, ...] same calendar day
Empty string means unknown / not captured.

OUTPUT CONTRACT (JSON schema a[] only)
For each id return:
- q: integer 0-10 comment quality
- e: array of exact Error Type labels from the allowed list (full text, never numeric codes)
- i: 0 or 1 buying intent
- o: 18-28 words QA observation (analysis, not a comment copy)
- r: 20-40 words concrete coaching recommendation
No severity field. No markdown. No extra keys.

ERROR TYPES (emit exact labels only — no codes, no paraphrases, no other labels)
- Lead Status Not Aligned With Comments
- Fresh Call TAT Missed
- Follow-up Missed
- Estimate Budget Empty
- Customer Requirement Empty
- Customer Location Empty
- Analysis Parameter Empty
- Incorrect Customer Requirement
Prefer e:[] over weak guesses. The app may also add some empty-field / SLA / history errors deterministically. NEVER invent labels outside this list.

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
INVALID when connected and non-blank ("Incorrect Customer Requirement"): RNR, CNP, Visited, Site visit, Busy, Followup, Callback, Interested, Not interested, Connected, ringing, wrong number, status/comment dumps.
Placeholder-only (., -, NA, nil) on connected call => "Customer Requirement Empty", not "Incorrect Customer Requirement".

BUYING INTENT i
i=1 only for genuine purchase interest (site visit interest, options request, active shortlist, budget toward buy).
i=0 for CNP/busy/NI/wrong number/neutral admin/no interest signal. All-RNR history with k=No ⇒ i=0.

STATUS vs FULL COMMENT HISTORY
Allowed Lead Status labels (case-insensitive): Prospect, Hot, Warm, Cold, Beyond Budget, Lost.
Heat ladder highest→lowest: Prospect > Hot > Warm > Cold > Beyond Budget > Lost.
c is the full chronological timeline — read ALL entries, then judge CURRENT s.
HARD RULE — all RNR + not connected: if every non-empty comment in c is RNR-like (RNR, CNP, busy, ringing, no answer, switched off, WhatsApp follow-up / WA FU) AND k=No, then s MUST be lesser than Warm (Cold, Beyond Budget, or Lost only). Warm/Hot/Prospect in that case → emit "Lead Status Not Aligned With Comments".
If early comments were hot/positive but later notes cool to RNR/neutral/negative, s must decrease. More than 2 continuous trailing RNR-like notes ⇒ s cannot be Prospect — emit "Lead Status Not Aligned With Comments".
Opposite: history warms from cold/RNR to clear positive interest but s stays Cold/Beyond Budget/Lost ⇒ emit "Lead Status Not Aligned With Comments".
Do not emit any other status/comment polarity labels.
RNR/CNP/busy alone does not justify keeping/upgrading to Prospect/Hot/Warm when the whole history is RNR and k=No.

FIRST TALK SLA (reg + fu)
reg = registration datetime; fu = FIRST update datetime (oldest after near-dupe filter), never the latest call.
ONLY when reg includes a usable clock time AND is between 09:30 and 17:00 inclusive: fu must be within 30 minutes after reg.
If fu is blank, before reg, or >30 minutes after reg → emit "Fresh Call TAT Missed".
If reg is outside 09:30–17:00, or reg is date-only with no clock time, skip this check entirely.

FOLLOW-UP MISSED (n)
If n (this call next follow-up) is a calendar date before today → emit "Follow-up Missed".
Do not emit prior-follow-up timing / ±5min mismatch labels.

CONNECTED GATING
"Customer Location Empty", "Customer Requirement Empty", "Estimate Budget Empty", and "Incorrect Customer Requirement" are ALLOWED ONLY when k=Yes.
If k is No or "", NEVER emit those four — even if l/rq/b are empty, "**", ".", or junk.

STYLE — OBSERVATION (o) AND RECOMMENDATION (r)
o = auditor judgment about data quality / process gaps / mismatches. It must NOT copy, trim, or paraphrase Comments (c). Bad o examples: restating "customer visited", "wants 2BHK Whitefield". Good o examples: "All comments are RNR with Connected=No but status still Warm." / "First talk missed the daytime TAT window."
r = specific next-call coaching: what questions to ask, which fields to fill (rq/location/budget), how to correct status, when to call back. Bad r: "Follow up", "Update comments", "Call again". Good r: "On next connected call ask preferred config, micro-market, and budget band; replace rq junk with real requirement; set follow-up date same day."
Never dump the full comment into o or r. Never restate this handbook.

EXAMPLES
A) c="visited" => q<=2, usually i=0.
B) k=Yes, rq="." or "" => "Customer Requirement Empty".
C) k=Yes, rq="RNR" or "Visited" => "Incorrect Customer Requirement".
D) k=Yes, rq="2BHK Whitefield" => rq OK.
E) day[] siblings present: score/flag THIS call only; siblings are context.
F) s=Hot, c=wants 2BHK under 90L Saturday visit => high q, i=1, e:[].
G) k=No, c all RNR-like, s=Warm => "Lead Status Not Aligned With Comments", i=0.
H) c history [hot interest, RNR, RNR, WA followup] and s=Prospect => "Lead Status Not Aligned With Comments".
I) reg=12/03/2026 10:00, fu=12/03/2026 11:00 => "Fresh Call TAT Missed". reg=12/03/2026 18:00 => skip SLA.
J) n is yesterday's date => "Follow-up Missed".

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
- For Comments history arrays, status must weigh the full timeline then the latest tone; q and i still focus on THIS call's latest comment unless a run check says otherwise.

CACHE STABILITY PAD (identical every request — do not vary)
LeadLens keeps this handbook byte-stable so automatic prompt caching can reuse the prefix across batches in a run and across nearby reruns. Static instructions stay first; configured run checks follow; unique lead payloads stay last. Routing uses a stable prompt_cache_key derived from model + rules. Parallel workers must warm this prefix once before fanning out. Treat the following checklist as fixed operating procedure: verify id echo, apply q hard caps, distinguish rq empty vs wrong, gate l/rq/b on connected, apply history trajectory + first-talk SLA + Follow-up Missed, keep outputs compact, never invent sibling calls, never merge two ids, never invent error labels outside the eight allowed types, never emit severity, never wrap JSON in fences, never discuss pricing or tokens, never mention cache mechanics in o/r. Repeatable discipline improves audit consistency across telecalling QA shifts, projects, and batch sizes while preserving privacy of customer records inside the browser-only LeadLens workflow.

This handbook is identical across batches for prompt caching.`;

const norm=value=>String(value??"").trim().toLowerCase().replace(/[_-]+/g," ").replace(/\s+/g," ");
const clean=value=>["","nan","none","nat","undefined","null"].includes(norm(value))?"":String(value).trim();
const clone=value=>JSON.parse(JSON.stringify(value));
const list=value=>String(value||"").split(",").map(norm).filter(Boolean);
const firstNonEmpty=values=>values.map(clean).find(Boolean)||"";
/** Excel exports often write Mobile/Project/Telecaller once, then leave later rows blank. */
function fillDownWithinGroup(records,fieldId,{backward=true}={}){
  let last="";
  for(const record of records){
    const value=clean(record[fieldId]);
    if(value)last=value;
    else if(last)record[fieldId]=last;
  }
  // Status is chronological — never leak a later status backward onto earlier blank calls.
  if(!backward)return;
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

export function slugFieldId(label,used=new Set()){
  let base=norm(label).replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"")||"field";
  if(/^\d/.test(base))base=`f_${base}`;
  let id=base,n=2;
  while(used.has(id)||["leadId","groupId","staticValues","auditContext","deterministicErrors","rowIndex","updateDate","nextDate"].includes(id)){
    id=`${base}_${n++}`;
  }
  return id;
}

/** Preserve user order and custom fields; always keep required Mobile + Project. */
export function normalizeInputFields(saved,seedFresh=false){
  const defaults=clone(DEFAULT_INPUT_FIELDS);
  const defaultById=new Map(defaults.map(field=>[field.id,field]));
  if(!Array.isArray(saved)||!saved.length)return defaults;
  const used=new Set();
  const out=[];
  for(const field of saved){
    let id=clean(field.id);
    if(!id)id=slugFieldId(field.label||"field",used);
    if(used.has(id))continue;
    used.add(id);
    const base=defaultById.get(id);
    out.push({
      id,
      label:clean(field.label)||base?.label||id,
      aliases:clean(field.aliases)||base?.aliases||clean(field.label)||id,
      required:Boolean(base?.required),
      enabled:base?.required?true:field.enabled!==false
    });
  }
  for(const req of defaults.filter(field=>field.required)){
    if(used.has(req.id))continue;
    out.unshift(clone(req));
    used.add(req.id);
  }
  if(seedFresh){
    for(const def of defaults){
      if(!used.has(def.id)){
        out.push(clone(def));
        used.add(def.id);
        continue;
      }
      if(def.id==="update"){
        const row=out.find(field=>field.id==="update");
        if(row){
          row.label=def.label;
          const aliasSet=new Set([...list(row.aliases),...list(def.aliases)]);
          row.aliases=[...aliasSet].join(", ");
        }
      }
    }
  }
  return out;
}

/** Preserve enabled flags and custom pass-through columns; keep known defaults present. */
export function normalizeOutputFields(saved,seedFresh=false){
  const defaults=clone(DEFAULT_OUTPUT_FIELDS);
  const defaultById=new Map(defaults.map(field=>[field.id,field]));
  const removedIds=new Set(["dayCallIndex"]); // dropped columns — strip from saved settings
  if(!Array.isArray(saved)||!saved.length)return defaults;
  const used=new Set();
  const out=[];
  for(const field of saved){
    const id=clean(field.id);
    if(!id||used.has(id)||removedIds.has(id))continue;
    used.add(id);
    const base=defaultById.get(id);
    out.push({
      id,
      label:clean(field.label)||base?.label||id,
      enabled:field.enabled!==false
    });
  }
  for(const def of defaults){
    if(used.has(def.id)){
      if(seedFresh&&def.id==="callDate"){
        const row=out.find(field=>field.id==="callDate");
        if(row)row.label=def.label;
      }
      continue;
    }
    out.push(clone(def));
    used.add(def.id);
  }
  // Mobile + Project first so lead identity is obvious in Settings and Excel.
  if(seedFresh){
    const leadIds=["mobile","project"];
    const leadRows=leadIds.map(id=>out.find(field=>field.id===id)).filter(Boolean);
    const rest=out.filter(field=>!leadIds.includes(field.id));
    return[...leadRows,...rest];
  }
  return out;
}

export function splitErrorList(value){
  return String(value||"")
    .split("|")
    .flatMap(part=>part.includes(",")&&/^\s*\d+(\s*,\s*\d+)*\s*$/.test(part)?part.split(","):[part])
    .map(part=>clean(part))
    .filter(Boolean);
}

export function buildErrorMaps(settings=DEFAULT_SETTINGS){
  const byNorm=new Map(ERROR_TYPES.map(label=>[norm(label),label]));
  for(const [alias,label] of Object.entries(LEGACY_ERROR_LABELS))byNorm.set(alias,label);
  for(const rule of settings.rules||[]){
    for(const token of splitErrorList(rule.errors)){
      const legacy=LEGACY_ERROR_CODES[token]||LEGACY_ERROR_LABELS[norm(token)];
      const label=legacy||token;
      const canonical=ERROR_TYPES.find(item=>norm(item)===norm(label));
      if(canonical&&!byNorm.has(norm(canonical)))byNorm.set(norm(canonical),canonical);
    }
  }
  const resolve=token=>{
    const raw=clean(token);
    if(!raw)return"";
    if(LEGACY_ERROR_CODES[raw])return LEGACY_ERROR_CODES[raw];
    if(LEGACY_ERROR_LABELS[norm(raw)])return LEGACY_ERROR_LABELS[norm(raw)];
    const hit=byNorm.get(norm(raw))||"";
    return ERROR_TYPES.includes(hit)?hit:"";
  };
  const allowed=new Set(ERROR_TYPES);
  return{resolve,allowed,labels:[...ERROR_TYPES]};
}

function normalizeRuleErrors(rules,maps){
  return (rules||[]).map(rule=>{
    const labels=splitErrorList(rule.errors).map(part=>maps.resolve(part)).filter(Boolean);
    return{...rule,errors:[...new Set(labels)].join(" | ")};
  });
}

/** Ensure every default rule field exists; on seed bump, refresh default rule text. Keep custom user rules. */
function mergeRules(savedRules,seedFresh){
  const saved=Array.isArray(savedRules)?savedRules:[];
  const renamedFields={"prior follow up timing":"Follow-up Missed"};
  const byField=new Map();
  for(const rule of saved){
    const rawField=clean(rule.field);
    const field=renamedFields[norm(rawField)]||rawField;
    const key=norm(field)||`custom-${byField.size}`;
    if(!byField.has(key))byField.set(key,{...rule,field});
  }
  const merged=DEFAULT_RULES.map(def=>{
    const key=norm(def.field);
    const existing=byField.get(key);
    byField.delete(key);
    if(!existing)return clone(def);
    if(seedFresh)return{field:def.field,instruction:def.instruction,errors:def.errors};
    return{field:def.field||existing.field,instruction:clean(existing.instruction)?existing.instruction:def.instruction,errors:existing.errors??def.errors};
  });
  for(const leftover of byField.values())merged.push({field:leftover.field||"Custom",instruction:leftover.instruction||"",errors:leftover.errors||""});
  return merged;
}

export function normalizeSettings(saved={}){
  const merged={...clone(DEFAULT_SETTINGS),...saved};
  const previousSeed=Number(saved.settingsSeed)||0;
  const seedFresh=previousSeed<SETTINGS_SEED;
  merged.inputFields=normalizeInputFields(saved.inputFields,seedFresh);
  merged.aiFields=defaultsById(saved.aiFields,DEFAULT_AI_FIELDS);
  merged.outputFields=normalizeOutputFields(saved.outputFields,seedFresh);
  merged.rules=mergeRules(saved.rules,seedFresh||!Array.isArray(saved.rules)||!saved.rules.length);
  if(seedFresh){
    const comments=merged.aiFields.find(field=>field.id==="comments");
    if(comments)comments.history=true;
    const dayCount=merged.outputFields.find(field=>field.id==="dayCallCount");
    if(dayCount)dayCount.label="Calls on Latest Day";
    if(merged.sort?.field==="dayCallIndex")merged.sort.field="callDate";
    // Refresh Connected Yes/No disposition lists to the shipped defaults on seed bumps.
    merged.yesValues=DEFAULT_SETTINGS.yesValues;
    merged.noValues=DEFAULT_SETTINGS.noValues;
  }
  // Comments history is required for trajectory checks — always on.
  const commentsField=merged.aiFields.find(field=>field.id==="comments");
  if(commentsField){commentsField.enabled=true;commentsField.history=true;}
  merged.settingsSeed=SETTINGS_SEED;
  merged.pricing={...DEFAULT_SETTINGS.pricing,...(saved.pricing||{})};
  merged.reviewPricing={...DEFAULT_SETTINGS.reviewPricing,...(saved.reviewPricing||{})};
  if(seedFresh&&previousSeed<11){
    // Seed 11: ship gpt-5-nano review rates (₹) for users who never set reviewPricing.
    merged.reviewPricing={...DEFAULT_SETTINGS.reviewPricing,...(saved.reviewPricing||{})};
  }
  // Force Lead Update Date ascending on first upgrade to seed 4; keep user sort afterward.
  if(seedFresh&&previousSeed<4)merged.sort={field:"callDate",direction:"asc"};
  else merged.sort={...DEFAULT_SETTINGS.sort,...(saved.sort||{})};
  if(!merged.outputFields.some(field=>field.id===merged.sort.field)||merged.sort.field==="dayCallIndex")merged.sort.field="callDate";
  merged.sort.direction=merged.sort.direction==="desc"?"desc":"asc";
  const concurrency=Number(merged.concurrency);
  merged.concurrency=Number.isInteger(concurrency)?Math.min(MAX_CONCURRENCY,Math.max(1,concurrency)):DEFAULT_SETTINGS.concurrency;
  const batchSize=Number(merged.batchSize);
  merged.batchSize=Number.isInteger(batchSize)?Math.min(MAX_BATCH_SIZE,Math.max(1,batchSize)):DEFAULT_SETTINGS.batchSize;
  merged.model=String(merged.model||"").trim()||DEFAULT_SETTINGS.model;
  merged.reviewModel=String(merged.reviewModel||"").trim()||DEFAULT_SETTINGS.reviewModel;
  const maps=buildErrorMaps(merged);
  merged.rules=normalizeRuleErrors(merged.rules,maps);
  return merged;
}

/**
 * Rough wall-clock audit seconds (gpt-4o-mini). Parallel batches share one "round".
 * Calibrated to observed ~1–3s/request with high concurrency — not per-row latency.
 */
const RUN_BASE_SECONDS_PER_BATCH=3.5;
const RUN_SECONDS_PER_AUDIT=0.18;
export function estimateRunSeconds(rawSettings,leadCount,auditCount){
  const settings=normalizeSettings(rawSettings);
  const leads=Math.max(0,Math.floor(Number(leadCount)||0));
  if(!leads)return 0;
  const audits=Math.max(leads,Math.floor(Number(auditCount)||0)||leads);
  const batchSize=Math.max(1,Number(settings.batchSize)||1);
  const concurrency=Math.max(1,Number(settings.concurrency)||1);
  const batches=Math.ceil(leads/batchSize);
  const rounds=Math.ceil(batches/concurrency);
  const auditsPerBatch=audits/batches;
  const secondsPerBatch=RUN_BASE_SECONDS_PER_BATCH+RUN_SECONDS_PER_AUDIT*auditsPerBatch;
  return Math.max(1,Math.round(rounds*secondsPerBatch));
}

/**
 * gpt-5-nano review pass on a compact summary (one request) — typically a few seconds.
 */
const REVIEW_PASS_BASE_SECONDS=9;
const REVIEW_PASS_SECONDS_PER_ROW=0.02;
export function estimateReviewPassSeconds(resultRows=0){
  const rows=Math.max(0,Math.floor(Number(resultRows)||0));
  return Math.max(5,Math.round(REVIEW_PASS_BASE_SECONDS+rows*REVIEW_PASS_SECONDS_PER_ROW));
}
/** @deprecated Prefer estimateReviewPassSeconds(rows); kept as a typical mid-size default. */
export const REVIEW_PASS_SECONDS = estimateReviewPassSeconds(80);

/** Audit + one TeleCaller review pass (Separate-file job, or legacy single-file estimate). */
export function estimateReviewRunSeconds(rawSettings,leadCount,auditCount){
  const audit=estimateRunSeconds(rawSettings,leadCount,auditCount);
  if(!audit)return 0;
  return audit+estimateReviewPassSeconds(auditCount||leadCount);
}

/**
 * Wall time for N jobs on a fixed worker pool (greedy: longest jobs first into least-loaded lane).
 * Used for Combined review waves and Separate multi-file pools (max REVIEW_JOB_CONCURRENCY).
 */
export function estimatePooledSeconds(jobSecondsList,poolSize=10){
  const pool=Math.max(1,Math.floor(Number(poolSize)||1));
  const sorted=[...(jobSecondsList||[])]
    .map(value=>Math.max(0,Number(value)||0))
    .filter(value=>value>0)
    .sort((a,b)=>b-a);
  if(!sorted.length)return 0;
  const lanes=Array(Math.min(pool,sorted.length)).fill(0);
  for(const sec of sorted){
    let minI=0;
    for(let i=1;i<lanes.length;i++)if(lanes[i]<lanes[minI])minI=i;
    lanes[minI]+=sec;
  }
  return Math.max(1,Math.round(Math.max(...lanes)));
}

/** Combined session: one full-file audit + pooled TeleCaller reviews (no per-telecaller re-audit). */
export function estimateCombinedReviewSessionSeconds(rawSettings,leadCount,auditCount,telecallerCallCounts,poolSize=10){
  const audit=estimateRunSeconds(rawSettings,leadCount,auditCount);
  const counts=Array.isArray(telecallerCallCounts)&&telecallerCallCounts.length
    ?telecallerCallCounts
    :[auditCount||leadCount||0];
  const reviewSecs=counts.map(count=>estimateReviewPassSeconds(count));
  return audit+estimatePooledSeconds(reviewSecs,poolSize);
}

/**
 * Partition audited call-rows by Telecaller Name (in memory).
 * Blank / missing names bucket as "Unknown". Case-insensitive grouping; display name preserved.
 */
export function splitLeadsByTelecaller(leads){
  const buckets=new Map();
  for(const lead of leads||[]){
    const raw=clean(lead?.staticValues?.telecaller??lead?.telecaller??"");
    const display=raw||"Unknown";
    const key=norm(display)||"unknown";
    if(!buckets.has(key))buckets.set(key,{telecallerName:display,leads:[],unknown:!raw});
    const bucket=buckets.get(key);
    bucket.leads.push(lead);
    if(!raw)bucket.unknown=true;
    // Prefer a non-empty display casing if we started with Unknown then got a name (shouldn't happen).
    if(raw&&bucket.telecallerName==="Unknown")bucket.telecallerName=display;
  }
  return[...buckets.values()].map(bucket=>{
    const groupIds=new Set();
    for(const lead of bucket.leads){
      if(lead.groupId)groupIds.add(lead.groupId);
      else groupIds.add(`${lead.staticValues?.project||""} | ${lead.staticValues?.mobile||""}`);
    }
    return{
      telecallerName:bucket.telecallerName,
      leads:bucket.leads,
      leadCount:groupIds.size,
      callCount:bucket.leads.length,
      latestDayCalls:bucket.leads.length,
      unknown:Boolean(bucket.unknown)
    };
  }).sort((a,b)=>a.telecallerName.localeCompare(b.telecallerName,undefined,{sensitivity:"base"}));
}

/**
 * Partition finished audit result rows by telecaller / telecallerName (post-audit Combined split).
 * Blank names → Unknown. Does not mutate the parent results array.
 */
export function splitResultsByTelecaller(results){
  const buckets=new Map();
  for(const row of results||[]){
    const raw=clean(row?.telecaller??row?.telecallerName??"");
    const display=raw||"Unknown";
    const key=norm(display)||"unknown";
    if(!buckets.has(key))buckets.set(key,{telecallerName:display,results:[],unknown:!raw});
    const bucket=buckets.get(key);
    bucket.results.push(row);
    if(!raw)bucket.unknown=true;
    if(raw&&bucket.telecallerName==="Unknown")bucket.telecallerName=display;
  }
  return[...buckets.values()].map(bucket=>{
    const leadKeys=new Set();
    for(const row of bucket.results){
      leadKeys.add(`${row.project||""} | ${row.mobile||""}`);
    }
    return{
      telecallerName:bucket.telecallerName,
      results:bucket.results,
      leadCount:leadKeys.size,
      callCount:bucket.results.length,
      unknown:Boolean(bucket.unknown)
    };
  }).sort((a,b)=>a.telecallerName.localeCompare(b.telecallerName,undefined,{sensitivity:"base"}));
}

function sanitizeFilePart(name){
  return String(name||"Unknown").trim().replace(/[<>:"/\\|?*\u0000-\u001f]+/g,"_").replace(/\s+/g,"_").slice(0,80)||"Unknown";
}

/** Compact manager-facing summary from audit results (not raw Excel). */
export function buildReviewSummary(job){
  const rows=job.results||[];
  const qualities=[];
  const qualityBuckets={"0-2":0,"3-4":0,"5-6":0,"7-8":0,"9-10":0};
  const errorTallies={};
  const severityMix={NONE:0,MEDIUM:0,HIGH:0};
  const intentMix={Yes:0,No:0};
  const observations=[];
  const recommendations=[];
  for(const row of rows){
    const q=Number(row.commentQuality);
    if(Number.isFinite(q)){
      qualities.push(q);
      if(q<=2)qualityBuckets["0-2"]++;
      else if(q<=4)qualityBuckets["3-4"]++;
      else if(q<=6)qualityBuckets["5-6"]++;
      else if(q<=8)qualityBuckets["7-8"]++;
      else qualityBuckets["9-10"]++;
    }
    const severity=String(row.errorSeverity||"NONE").toUpperCase();
    if(severity in severityMix)severityMix[severity]++;
    else severityMix.MEDIUM++;
    const intent=String(row.buyingIntent||"No");
    if(intent==="Yes")intentMix.Yes++;else intentMix.No++;
    const rawErrors=String(row.errorTypes||"").trim();
    if(rawErrors&&!/^none$/i.test(rawErrors)){
      // Labels themselves contain commas, so match known types instead of splitting.
      let matched=false;
      for(const label of ERROR_TYPES){
        if(rawErrors.includes(label)){
          errorTallies[label]=(errorTallies[label]||0)+1;
          matched=true;
        }
      }
      if(!matched)errorTallies[rawErrors]=(errorTallies[rawErrors]||0)+1;
    }
    if(observations.length<12&&clean(row.observation))observations.push(clean(row.observation));
    if(recommendations.length<12&&clean(row.recommendation))recommendations.push(clean(row.recommendation));
  }
  const avgQuality=qualities.length?Math.round((qualities.reduce((sum,n)=>sum+n,0)/qualities.length)*10)/10:0;
  const topErrors=Object.entries(errorTallies).sort((a,b)=>b[1]-a[1]).slice(0,12).map(([label,count])=>({label,count}));
  return{
    telecallerName:job.telecallerName||job.fileName||"Unknown",
    leadCount:job.leadCount||0,
    callCount:job.callCount||rows.length,
    auditedRows:rows.length,
    avgCommentQuality:avgQuality,
    qualityDistribution:qualityBuckets,
    errorTallies:topErrors,
    severityMix,
    buyingIntentMix:intentMix,
    sampleObservations:observations,
    sampleRecommendations:recommendations
  };
}

const reviewResponseSchema={
  type:"object",additionalProperties:false,
  required:["headline","summary","strengths","risks","coachingFocus"],
  properties:{
    headline:{type:"string"},
    summary:{type:"string"},
    strengths:{type:"array",items:{type:"string"}},
    risks:{type:"array",items:{type:"string"}},
    coachingFocus:{type:"array",items:{type:"string"}}
  }
};

/** Normalize model JSON (or plain text) into reviewText + reviewReport. */
export function parseReviewModelContent(raw){
  const text=clean(raw);
  if(!text)return{reviewText:"",reviewReport:null};
  let parsed=null;
  try{
    parsed=JSON.parse(text);
  }catch{
    const fenced=text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if(fenced){
      try{parsed=JSON.parse(fenced[1].trim());}catch{/* plain text */}
    }else{
      const start=text.indexOf("{");
      const end=text.lastIndexOf("}");
      if(start>=0&&end>start){
        try{parsed=JSON.parse(text.slice(start,end+1));}catch{/* plain text */}
      }
    }
  }
  if(parsed&&typeof parsed==="object"&&!Array.isArray(parsed)){
    const asList=value=>{
      if(Array.isArray(value))return value.map(item=>clean(item)).filter(Boolean);
      if(typeof value==="string"&&clean(value))return[clean(value)];
      return[];
    };
    const summary=clean(parsed.summary||parsed.reviewText||parsed.narrative||"");
    const reviewReport={
      headline:clean(parsed.headline||parsed.title||""),
      summary:summary||text,
      strengths:asList(parsed.strengths||parsed.strength),
      risks:asList(parsed.risks||parsed.risk||parsed.concerns),
      coachingFocus:asList(parsed.coachingFocus||parsed.coaching_focus||parsed.coaching||parsed.focus)
    };
    return{reviewText:reviewReport.summary,reviewReport};
  }
  return{
    reviewText:text,
    reviewReport:{headline:"",summary:text,strengths:[],risks:[],coachingFocus:[]}
  };
}

/**
 * Second AI pass: structured TeleCaller review for managers (PDF report).
 * Uses settings.reviewModel (default gpt-5-nano). Does not change audit results.
 */
export async function requestTelecallerReview(apiKey,rawSettings,job,signal,log){
  const settings=normalizeSettings(rawSettings);
  const model=settings.reviewModel||DEFAULT_SETTINGS.reviewModel;
  const summary=buildReviewSummary(job);
  const system=`You are a telecalling QA coach writing for a sales manager. Using only the supplied audit summary, return JSON with keys: headline (short), summary (100–500 words plain prose coach narrative), strengths (string array), risks (string array), coachingFocus (string array). Cover comment quality, error patterns, strengths, and coaching focus. No markdown in summary. No invented leads or quotes beyond the samples.`;
  const user=`TeleCaller review request. Respond with JSON only.\nSummary JSON:\n${JSON.stringify(summary)}`;
  // Higher max for reasoning models (thinking tokens + structured review).
  const reviewBody=buildChatCompletionBody(model,{
      temperature:0.3,
      maxTokens:4000,
      messages:[
        {role:"system",content:system},
        {role:"user",content:user}
      ],
      response_format:{type:"json_schema",json_schema:{name:"ll_telecaller_review",strict:true,schema:reviewResponseSchema}}
    });
  if(log)log(`Review API params (${model}): keys=${Object.keys(reviewBody).join(",")} · max_tokens=${"max_tokens" in reviewBody} · max_completion_tokens=${"max_completion_tokens" in reviewBody} · temperature=${"temperature" in reviewBody}`,"info");
  let response=await fetch("https://api.openai.com/v1/chat/completions",{
    method:"POST",signal,
    headers:{"Content-Type":"application/json","Authorization":`Bearer ${apiKey}`},
    body:JSON.stringify(reviewBody)
  });
  if(!response.ok&&response.status===400){
    // Some model variants reject json_schema — retry with plain prompt + graceful parse.
    const{response_format:_omit,...fallbackBody}=reviewBody;
    if(log)log("Review json_schema rejected — retrying without response_format.","info");
    response=await fetch("https://api.openai.com/v1/chat/completions",{
      method:"POST",signal,
      headers:{"Content-Type":"application/json","Authorization":`Bearer ${apiKey}`},
      body:JSON.stringify(fallbackBody)
    });
  }
  if(!response.ok){
    let detail="";
    try{
      const errJson=await response.json();
      detail=errJson.error?.message||"";
    }catch{/* ignore */}
    throw new Error(`OpenAI review ${response.status}: ${detail||response.statusText}`);
  }
  const data=await response.json();
  const choice=data.choices?.[0];
  const text=clean(choice?.message?.content||"");
  if(!text)throw new Error(`OpenAI returned an empty TeleCaller review (finish_reason=${choice?.finish_reason||"unknown"}).`);
  const{reviewText,reviewReport}=parseReviewModelContent(text);
  if(!reviewText)throw new Error(`OpenAI returned an empty TeleCaller review (finish_reason=${choice?.finish_reason||"unknown"}).`);
  const usage=data.usage||{};
  const tokenUsage={
    input:usage.prompt_tokens??usage.input_tokens??0,
    cached:usage.prompt_tokens_details?.cached_tokens??usage.input_tokens_details?.cached_tokens??0,
    output:usage.completion_tokens??usage.output_tokens??0
  };
  if(log)log(`Review tokens (${model}): ${tokenUsage.input} in (${tokenUsage.cached} cached), ${tokenUsage.output} out.`,"info");
  return{reviewText,reviewReport,tokenUsage,model};
}

/**
 * Validate an OpenAI key WITHOUT spending tokens by listing models (a free GET).
 * A 200 confirms the key is real and active; 401/403 mean invalid/unauthorized.
 * OpenAI does not expose a plain balance endpoint, so an insufficient-quota state
 * only surfaces at audit time — this still catches the common "bad/expired key" case.
 */
export async function validateApiKey(key,signal){
  const trimmed=String(key||"").trim();
  if(!trimmed)return{ok:false,reason:"empty",message:"Enter an OpenAI API key."};
  if(!/^sk-[A-Za-z0-9_-]{20,}$/.test(trimmed))return{ok:false,reason:"format",message:"That does not look like an OpenAI API key (it should start with \"sk-\")."};
  try{
    const response=await fetch("https://api.openai.com/v1/models",{
      method:"GET",
      headers:{"Authorization":`Bearer ${trimmed}`},
      signal
    });
    if(response.ok)return{ok:true,message:"Key is valid and active."};
    let detail="";
    try{detail=(await response.json())?.error?.message||"";}catch{/* ignore */}
    if(response.status===401)return{ok:false,reason:"unauthorized",status:401,message:detail||"Invalid API key — OpenAI rejected it (401)."};
    if(response.status===403)return{ok:false,reason:"forbidden",status:403,message:detail||"This key is not authorized (403)."};
    if(response.status===429)return{ok:false,reason:"quota",status:429,message:detail||"Key reached a rate/quota limit (429). It may have no remaining balance."};
    return{ok:false,reason:"http",status:response.status,message:detail||`OpenAI returned ${response.status}.`};
  }catch(error){
    if(error?.name==="AbortError")return{ok:false,reason:"aborted",message:"Key check cancelled."};
    return{ok:false,reason:"network",message:"Could not reach OpenAI to verify the key. Check the internet connection and try again."};
  }
}

function parseDate(value){
  const full=parseDateTime(value);
  return full?new Date(full.getFullYear(),full.getMonth(),full.getDate()):null;
}
function parseDateTime(value){
  if(value instanceof Date&&!Number.isNaN(value.valueOf()))return new Date(value.getTime());
  if(typeof value==="number"&&window.XLSX?.SSF){
    const d=XLSX.SSF.parse_date_code(value);
    if(!d)return null;
    return new Date(d.y,d.m-1,d.d,d.H||0,d.M||0,Math.floor(d.S||0));
  }
  const s=clean(value);if(!s)return null;
  // YYYY-MM-DD / YYYY/MM/DD first — otherwise the DD/MM regex can misread year-leading strings.
  const iso=s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if(iso){
    const d=new Date(Number(iso[1]),Number(iso[2])-1,Number(iso[3]),Number(iso[4]||0),Number(iso[5]||0),Number(iso[6]||0));
    return Number.isNaN(d.valueOf())?null:d;
  }
  const match=s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if(match){
    const day=Number(match[1]),month=Number(match[2]),year=match[3].length===2?Number(`20${match[3]}`):Number(match[3]);
    // Reject impossible months so MM/DD strings do not silently wrap via Date().
    if(month>=1&&month<=12&&day>=1&&day<=31){
      const d=new Date(year,month-1,day,Number(match[4]||0),Number(match[5]||0),Number(match[6]||0));
      if(!Number.isNaN(d.valueOf())&&d.getFullYear()===year&&d.getMonth()===month-1&&d.getDate()===day)return d;
    }
  }
  const parsed=new Date(s);
  return Number.isNaN(parsed.valueOf())?null:parsed;
}
const dateText=value=>{const d=value instanceof Date?value:parseDateTime(value)||parseDate(value);return d?`${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`:clean(value);};
const hasClockTime=d=>d instanceof Date&&!Number.isNaN(d.valueOf())&&(d.getHours()!==0||d.getMinutes()!==0||d.getSeconds()!==0);
const dateTimeText=value=>{
  const d=value instanceof Date?value:parseDateTime(value);
  if(!d)return clean(value);
  const base=`${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
  if(!hasClockTime(d))return base;
  return`${base} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
};
function isBusinessHoursRegistration(d){
  if(!(d instanceof Date)||Number.isNaN(d.valueOf())||!hasClockTime(d))return false;
  const mins=d.getHours()*60+d.getMinutes();
  return mins>=(9*60+30)&&mins<=(17*60);
}
function missedThirtyMinTalk(registrationAt,firstUpdateAt){
  if(!registrationAt||!firstUpdateAt||!isBusinessHoursRegistration(registrationAt))return false;
  // Date-only Lead Update parses to midnight — skip SLA unless fu has a real clock.
  if(!hasClockTime(firstUpdateAt))return false;
  const delta=firstUpdateAt.valueOf()-registrationAt.valueOf();
  return delta<0||delta>30*60*1000;
}
function isRnrLikeComment(value){
  const n=norm(value);
  if(!n)return false;
  if(/\b(whats?\s*app|wa)\b/.test(n)&&/\b(follow\s*up|followup|fu|msg|message|ping|text)\b/.test(n))return true;
  if(/^(rnr|cnp|ni|busy|ringing|no answer|not reachable|switched off|switch off|not connected|call not connected|wrong number|wn|callback|call back|follow\s*up|followup|whatsapp|wa)(\b|[\s.,_-]|$)/.test(n))return true;
  if(/\b(rnr|cnp)\b/.test(n)&&n.split(/\s+/).length<=5)return true;
  return false;
}
function isStrongPositiveComment(value){
  const n=norm(value);
  if(!n||isRnrLikeComment(n))return false;
  if(/\b(not interested|\bni\b|don't|dont|do not|no need|stop calling)\b/.test(n))return false;
  // Bare CRM crumbs (visited/SV alone) are not positive interest — quality caps already treat them as q<=2.
  if(/^(visited|visit|sv|sv done|site visit|site visited)$/.test(n))return false;
  return/\b(interested|site visit|sv done|want(s|ed)?|looking for|budget|2bhk|3bhk|call me|send(ing)? details|shortlist|book(ing)?|come(s)? for visit)\b/.test(n)
    ||(/\bvisit(ed)?\b/.test(n)&&n.split(/\s+/).length>=3);
}
function trailingRnrStreak(comments){
  let streak=0;
  for(let i=comments.length-1;i>=0;i--){
    if(isRnrLikeComment(comments[i]))streak++;
    else break;
  }
  return streak;
}
function allCommentsRnrLike(comments){
  const list=Array.isArray(comments)?comments.map(clean).filter(Boolean):[clean(comments)].filter(Boolean);
  return list.length>0&&list.every(isRnrLikeComment);
}
function historyStatusErrors(status,comments,connected=""){
  const errors=[];
  const list=Array.isArray(comments)?comments.map(clean).filter(Boolean):[clean(comments)].filter(Boolean);
  if(!list.length)return errors;
  const statusNorm=norm(status);
  const warmOrHigher=["prospect","hot","warm"];
  // All RNR-like comments + Connected=No ⇒ status must be lesser than Warm.
  if(allCommentsRnrLike(list)&&norm(connected)==="no"&&warmOrHigher.includes(statusNorm)){
    errors.push(STATUS_HISTORY_ERROR);
  }
  const streak=trailingRnrStreak(list);
  if(streak>2&&statusNorm==="prospect"&&!errors.includes(STATUS_HISTORY_ERROR))errors.push(STATUS_HISTORY_ERROR);
  if(["prospect","hot"].includes(statusNorm)&&streak>=2){
    const earlier=list.slice(0,-streak);
    if(earlier.some(item=>isStrongPositiveComment(item)||/\b(interested|hot|prospect|site visit|want)\b/.test(norm(item)))){
      if(!errors.includes(STATUS_HISTORY_ERROR))errors.push(STATUS_HISTORY_ERROR);
    }
  }
  const last=list[list.length-1];
  if(isStrongPositiveComment(last)&&["cold","beyond budget","lost"].includes(statusNorm)){
    if(!errors.includes(STATUS_HISTORY_ERROR))errors.push(STATUS_HISTORY_ERROR);
  }
  return errors;
}
export function indianMobile(value){let digits=clean(value).replace(/\.0$/,"").replace(/\D/g,"");if(digits.length===12&&digits.startsWith("91"))digits=digits.slice(2);if(digits.length===11&&digits.startsWith("0"))digits=digits.slice(1);return /^[6-9]\d{9}$/.test(digits)?digits:"";}
function fieldColumns(headers,fields){const normalized=headers.map(header=>({header,key:norm(header)}));return Object.fromEntries(fields.filter(field=>field.required||field.enabled!==false).map(field=>{const match=normalized.find(item=>list(field.aliases).includes(item.key));return[field.id,match?.header||""];}));}
function correctedAiLocation(project,location){const exceptions=new Set(["guru punvaanii eureka|bidadi","guru punvaanii ernika|anekal","guru punvaanii eka|anekal","guru punvaanii elegance|bheemenahalli"]);return exceptions.has(`${norm(project)}|${norm(location)}`)?"":location;}
function connectedFromParameter(parameter,settings){const value=norm(parameter);if(!value)return"";if(list(settings.yesValues).includes(value)||value==="yes")return"Yes";if(list(settings.noValues).includes(value)||value==="no")return"No";return"";}
function deterministicErrors(call,aiLocation,{commentHistory=[],registrationAt=null,firstUpdateAt=null}={}){
  const errors=[];
  const today=new Date();today.setHours(0,0,0,0);
  if(call.nextDate&&call.nextDate<today)errors.push(FOLLOWUP_MISSED_ERROR);
  if(isBlankish(call.parameter))errors.push(EMPTY_PARAMETER);
  if(call.connected==="Yes"){
    if(isBlankish(call.location))errors.push(EMPTY_LOCATION);
    if(isBlankish(call.requirement))errors.push(EMPTY_REQUIREMENT);
    else if(looksLikeWrongRequirement(call.requirement))errors.push(WRONG_REQUIREMENT);
    if(isBlankish(call.budget))errors.push(EMPTY_BUDGET);
  }
  if(missedThirtyMinTalk(registrationAt,firstUpdateAt))errors.push(MISSED_30MIN_ERROR);
  for(const label of historyStatusErrors(call.status,commentHistory.length?commentHistory:[call.comments],call.connected)){
    if(!errors.includes(label))errors.push(label);
  }
  return errors;
}
function contextValue(id,record,aiLocation){if(id==="connected")return record.connected;if(id==="next")return dateText(record.nextDate||record.next);if(id==="location")return aiLocation;return record[id]||"";}
function callSnapshot(record){
  const aiLocation=correctedAiLocation(record.project,record.location);
  return{
    d:dateText(record.updateAt||record.updateDate||record.update),
    s:record.status||"",
    c:record.comments||"",
    n:dateText(record.nextDate||record.next),
    l:aiLocation,
    rq:record.requirement||"",
    b:record.budget||"",
    k:record.connected||""
  };
}

const ONE_HOUR_MS=60*60*1000;
/** Drop CRM twin rows: same lead content within <1 hour (timestamp glitches / double-writes). */
function dedupeNearDuplicateCalls(records,inputFields){
  if(records.length<=1)return records;
  const compareIds=(inputFields||[])
    .filter(field=>field.required||field.enabled!==false)
    .map(field=>field.id)
    .filter(id=>id!=="update");
  const signature=record=>compareIds.map(id=>norm(record[id]??"")).join("\u0001");
  const stamp=record=>record.updateAt?.valueOf()??record.updateDate?.valueOf()??null;
  const sorted=[...records].sort((a,b)=>{
    const av=stamp(a),bv=stamp(b);
    if(av!=null&&bv!=null&&av!==bv)return av-bv;
    if(av!=null&&bv==null)return -1;
    if(av==null&&bv!=null)return 1;
    return a.rowIndex-b.rowIndex;
  });
  const kept=[];
  for(const record of sorted){
    const prev=kept[kept.length-1];
    if(!prev){kept.push(record);continue;}
    const t1=stamp(prev),t2=stamp(record);
    const withinHour=t1!=null&&t2!=null&&Math.abs(t2-t1)<ONE_HOUR_MS;
    if(withinHour&&signature(prev)===signature(record))continue;
    kept.push(record);
  }
  return kept;
}

export function parseWorkbook(arrayBuffer,rawSettings=DEFAULT_SETTINGS){
  if(!window.XLSX)throw new Error("Excel reader failed to load. Check the internet connection and reload.");
  const settings=normalizeSettings(rawSettings),workbook=XLSX.read(arrayBuffer,{type:"array",cellDates:true});
  const candidates=workbook.SheetNames.map(name=>{
    const rows=XLSX.utils.sheet_to_json(workbook.Sheets[name],{defval:"",raw:true}),headers=rows.length?Object.keys(rows[0]):[],columns=fieldColumns(headers,settings.inputFields);
    return{name,rows,headers,columns,score:Object.values(columns).filter(Boolean).length};
  }).sort((a,b)=>b.score-a.score),selected=candidates[0];
  if(!selected?.columns.mobile||!selected?.columns.project)throw new Error("No sheet contains both Mobile and Project Name. Edit their aliases in Settings if your headers use different names.");
  const grouped=new Map();let lastMobile="",lastProject="",invalidRows=0;
  for(let index=0;index<selected.rows.length;index++){
    const row=selected.rows[index],rawMobile=clean(row[selected.columns.mobile]),rawProject=clean(row[selected.columns.project]);
    const normalizedMobile=rawMobile?indianMobile(rawMobile):"";
    // Invalid non-empty mobile must not wipe fill-down or poison lastProject.
    if(rawMobile){
      if(!normalizedMobile){invalidRows++;continue;}
      lastMobile=normalizedMobile;
    }
    if(rawProject)lastProject=rawProject;
    if(!lastMobile||!lastProject)continue;
    // Skip rows where every mapped input cell is blank (trailing CRM empties).
    const mappedEmpty=settings.inputFields.every(field=>{
      const header=selected.columns[field.id];
      return!header||!clean(row[header]);
    });
    if(mappedEmpty)continue;
    const values={};
    for(const field of settings.inputFields)values[field.id]=clean(row[selected.columns[field.id]]);
    values.mobile=lastMobile;values.project=lastProject;
    const updateAt=parseDateTime(values.update);
    const updateDate=updateAt?new Date(updateAt.getFullYear(),updateAt.getMonth(),updateAt.getDate()):parseDate(values.update);
    const nextAt=parseDateTime(values.next);
    const nextDate=nextAt?new Date(nextAt.getFullYear(),nextAt.getMonth(),nextAt.getDate()):parseDate(values.next);
    const record={...values,rowIndex:index,updateAt,updateDate,nextAt,nextDate},key=`${lastProject} | ${lastMobile}`;
    if(!grouped.has(key))grouped.set(key,[]);
    grouped.get(key).push(record);
  }

  const leads=[];
  let dedupedRows=0;
  for(const [groupId,rawRecords] of grouped.entries()){
    rawRecords.sort((a,b)=>(a.updateAt?.valueOf()??a.updateDate?.valueOf()??a.rowIndex)-(b.updateAt?.valueOf()??b.updateDate?.valueOf()??b.rowIndex));
    // Carry agent/registration/status across blank follow-up rows inside the same lead
    // (CRM exports often write these once, then leave later rows empty).
    fillDownWithinGroup(rawRecords,"telecaller");
    fillDownWithinGroup(rawRecords,"registration");
    fillDownWithinGroup(rawRecords,"status",{backward:false});
    for(const record of rawRecords)record.connected=connectedFromParameter(record.parameter,settings);
    const before=rawRecords.length;
    // Near-dupe filter first; only latest-day rows go to AI/export. Calls metric = Excel rows.
    const records=dedupeNearDuplicateCalls(rawRecords,settings.inputFields);
    dedupedRows+=Math.max(0,before-records.length);
    const dated=records.filter(record=>record.updateDate);
    const latestDay=dated.length
      ?dayKey(dated.reduce((best,record)=>(record.updateAt?.valueOf()??record.updateDate.valueOf())>=(best.updateAt?.valueOf()??best.updateDate.valueOf())?record:best).updateDate)
      :"";
    const dayCalls=latestDay
      ?records.filter(record=>dayKey(record.updateDate)===latestDay)
      :[records.at(-1)];
    const registration=firstNonEmpty(records.map(record=>record.registration));
    const telecaller=firstNonEmpty(records.map(record=>record.telecaller));
    const registrationAt=records.map(record=>parseDateTime(record.registration)).find(Boolean)||null;
    const firstRecord=records.find(record=>record.updateAt||record.updateDate)||records[0];
    const firstUpdateAt=firstRecord?.updateAt||(firstRecord?.updateDate?new Date(firstRecord.updateDate.getFullYear(),firstRecord.updateDate.getMonth(),firstRecord.updateDate.getDate()):null)||null;
    const commentHistory=records.map(record=>record.comments||"");
    const daySnapshots=dayCalls.map(callSnapshot);

    dayCalls.forEach((call,callIndex)=>{
      const aiLocation=correctedAiLocation(call.project,call.location);
      const leadUpdateDate=dateText(call.updateAt||call.updateDate||call.update);
      const recordIndex=records.findIndex(record=>record.rowIndex===call.rowIndex);
      const previous=recordIndex>0?records[recordIndex-1]:null;
      const previousFollowupAt=previous?.nextAt||(previous?.nextDate?new Date(previous.nextDate.getFullYear(),previous.nextDate.getMonth(),previous.nextDate.getDate()):null)||null;
      const staticValues={
        project:call.project,
        mobile:call.mobile,
        registration:dateTimeText(registrationAt)||registration,
        telecaller:clean(call.telecaller)||telecaller,
        status:call.status,
        comments:call.comments,
        next:dateTimeText(call.nextAt)||dateText(call.nextDate||call.next),
        callDate:dateTimeText(call.updateAt)||leadUpdateDate,
        update:dateTimeText(call.updateAt)||leadUpdateDate,
        totalFollowups:records.length,
        dayCallCount:dayCalls.length,
        dayCallIndex:callIndex+1,
        connected:call.connected||"",
        location:call.location,
        requirement:call.requirement,
        parameter:call.parameter,
        budget:call.budget
      };
      // Custom input columns pass through to Excel only — never added to AI context here.
      for(const field of settings.inputFields){
        if(!field.required&&field.enabled===false)continue;
        if(staticValues[field.id]!==undefined)continue;
        staticValues[field.id]=call[field.id]||"";
      }
      const auditContext={};
      for(const field of settings.aiFields.filter(field=>field.enabled)){
        const key=AI_FIELD_KEYS[field.id]||field.id;
        // Comments always ship full chronological history for smarter status trajectory.
        if(field.id==="comments")auditContext[key]=commentHistory;
        else if(field.id==="next")auditContext[key]=dateTimeText(call.nextAt)||dateText(call.nextDate||call.next);
        else auditContext[key]=field.history
          ?records.map(record=>contextValue(field.id,record,correctedAiLocation(record.project,record.location)))
          :contextValue(field.id,call,aiLocation);
      }
      auditContext.reg=dateTimeText(registrationAt)||registration||"";
      auditContext.fu=dateTimeText(firstUpdateAt)||"";
      auditContext.u=dateTimeText(call.updateAt)||leadUpdateDate||"";
      auditContext.pn=dateTimeText(previousFollowupAt)||"";
      // Same-day siblings on the latest day are context only; each latest-day call still gets its own result.
      if(daySnapshots.length>1)auditContext.day=daySnapshots;
      leads.push({
        leadId:`${groupId}#${call.rowIndex}`,
        groupId,
        staticValues,
        auditContext,
        deterministicErrors:deterministicErrors(call,aiLocation,{commentHistory,registrationAt,firstUpdateAt})
      });
    });
  }
  if(!leads.length)throw new Error("No valid Indian mobile numbers were found. Only 10-digit Indian mobiles starting with 6, 7, 8 or 9 are processed.");
  // Compare the chosen sheet's headers against the enabled Settings fields so the UI
  // can warn when the uploaded file does not match the configured columns.
  const enabledFields=settings.inputFields.filter(field=>field.required||field.enabled!==false);
  const expectedColumns=enabledFields.map(field=>({
    id:field.id,
    label:field.label,
    required:Boolean(field.required),
    header:selected.columns[field.id]||"",
    matched:Boolean(selected.columns[field.id])
  }));
  const missingColumns=expectedColumns.filter(column=>!column.matched).map(column=>column.label);
  const matchedHeaderKeys=new Set(Object.values(selected.columns).filter(Boolean).map(header=>norm(header)));
  const unknownHeaders=(selected.headers||[]).filter(header=>clean(header)&&!matchedHeaderKeys.has(norm(header)));
  return{
    sheetName:selected.name,
    leads,
    rowCount:selected.rows.length,
    leadCount:grouped.size,
    callCount:selected.rows.length,
    latestDayCalls:leads.length,
    invalidRows,
    dedupedRows,
    expectedColumns,
    missingColumns,
    unknownHeaders
  };
}

function buildPrompt(settings){
  const maps=buildErrorMaps(settings);
  const errorLegend=maps.labels.join(" | ");
  const rules=settings.rules.filter(rule=>clean(rule.instruction)).map((rule,index)=>{
    const errors=splitErrorList(rule.errors);
    return`${index+1}. ${clean(rule.field)||"check"}: ${clean(rule.instruction)}${errors.length?` errors:${errors.join(" | ")}`:""}`;
  }).join("\n");
  const extra=clean(settings.additionalInstructions);
  return `${CACHE_HANDBOOK}\n\nALLOWED ERROR TYPES: ${errorLegend}\n\nRUN CHECKS:\n${rules||"none"}${extra?`\n\nEXTRA:\n${extra}`:""}`;
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
function fallbackObservation(row,errors,q){
  const bits=[];
  if(q<=3)bits.push("Comment lacks a real telecaller–customer conversation.");
  if(errors.includes(STATUS_HISTORY_ERROR))bits.push("Lead status does not reflect the full comment history trajectory.");
  if(errors.includes(MISSED_30MIN_ERROR))bits.push("First update missed the fresh-call TAT window after daytime registration.");
  if(errors.includes(EMPTY_REQUIREMENT))bits.push("Connected call has empty/placeholder requirement.");
  if(errors.includes(WRONG_REQUIREMENT))bits.push("Requirement field holds call jargon, not a customer need.");
  if(errors.includes(EMPTY_LOCATION))bits.push("Connected call missing usable location.");
  if(errors.includes(EMPTY_BUDGET))bits.push("Connected call missing budget.");
  if(errors.includes(FOLLOWUP_MISSED_ERROR))bits.push("Follow-up date is already past.");
  if(errors.includes(EMPTY_PARAMETER))bits.push("Analysis parameter is blank.");
  if(!bits.length)bits.push("Review note quality and field completeness for this call.");
  return clipWords(bits.join(" "),28);
}
function fallbackRecommendation(row,errors,q){
  const bits=[];
  if(q<=4)bits.push("Rewrite remarks with what the customer said: need, locality, budget, objection, and next step.");
  if(errors.includes(STATUS_HISTORY_ERROR))bits.push("Align Lead Status on the Prospect→Lost ladder to the full comment timeline (all-RNR / not connected must be below Warm).");
  if(errors.includes(MISSED_30MIN_ERROR))bits.push("Call daytime registrations within 30 minutes and log the first update promptly.");
  if(errors.includes(WRONG_REQUIREMENT)||errors.includes(EMPTY_REQUIREMENT))bits.push("On next connected call capture a real requirement (config/area), not RNR/Visited/status text.");
  if(errors.includes(EMPTY_LOCATION))bits.push("Ask and save preferred micro-market/location.");
  if(errors.includes(EMPTY_BUDGET))bits.push("Ask and save budget band before ending the call.");
  if(errors.includes(FOLLOWUP_MISSED_ERROR))bits.push("Call on/before the promised follow-up and set a fresh dated next step.");
  if(!bits.length)bits.push("Confirm interest, capture missing fields, and lock a dated next action the same day.");
  return clipWords(bits.join(" "),40);
}
function finalizeObservation(aiText,row,errors,q){
  const clipped=clipWords(aiText,28);
  if(!clipped||isCommentEcho(clipped,row.comments))return fallbackObservation(row,errors,q);
  return clipped;
}
function finalizeRecommendation(aiText,row,errors,q){
  const clipped=clipWords(aiText,40);
  const words=clipped.split(/\s+/).filter(Boolean);
  const vague=/^(follow\s*up|call\s*again|update\s*(comments?|remarks?)|try\s*later|connect\s*again)\.?$/i.test(clipped);
  if(!clipped||words.length<10||vague)return fallbackRecommendation(row,errors,q);
  return clipped;
}

async function requestAudit(apiKey,settings,leads,signal,log,onUsage){
  const modelInput=leads.map(lead=>({id:lead.leadId,...lead.auditContext}));
  const auditBody=buildChatCompletionBody(settings.model,{
      temperature:0,
      maxTokens:Math.max(500,leads.length*140),
      prompt_cache_key:promptCacheKey(settings),
      messages:[
        {role:"system",content:buildPrompt(settings)},
        {role:"user",content:`Audit ${leads.length} call(s). Echo each id. c=full history; reg+fu=fresh-call TAT; o=QA analysis not comment copy; r=specific coaching.\n${JSON.stringify({L:modelInput})}`}
      ],
      response_format:{type:"json_schema",json_schema:{name:"ll_audit",strict:true,schema:responseSchema}}
    });
  const response=await fetch("https://api.openai.com/v1/chat/completions",{
    method:"POST",signal,
    headers:{"Content-Type":"application/json","Authorization":`Bearer ${apiKey}`},
    body:JSON.stringify(auditBody)
  });
  if(!response.ok){
    let detail="";
    try{
      const errJson=await response.json();
      detail=errJson.error?.message||"";
    }catch{/* ignore */}
    throw new Error(`OpenAI ${response.status}: ${detail||response.statusText}`);
  }
  const data=await response.json(),usage=data.usage;
  const content=data.choices?.[0]?.message?.content;
  if(!content)throw new Error("OpenAI returned no audit content.");
  const parsed=JSON.parse(content);
  if(!Array.isArray(parsed.a))throw new Error("OpenAI response did not contain results array.");
  // Count tokens only after a parseable result so soft failures are not double-billed on retry.
  const input=usage?.prompt_tokens??usage?.input_tokens??0;
  const cached=usage?.prompt_tokens_details?.cached_tokens??usage?.input_tokens_details?.cached_tokens??0;
  const output=usage?.completion_tokens??usage?.output_tokens??0;
  if(usage&&onUsage)onUsage({input,cached,output});
  if(usage&&log)log(`Tokens: ${input} in (${cached} cached, ${Math.max(0,input-cached)} billable), ${output} out.`,"info");
  return parsed.a;
}

const unique=values=>[...new Set(values.filter(Boolean))];
const severityFromErrors=errors=>!errors.length?"NONE":errors.some(error=>HIGH_SEVERITY_ERRORS.has(error))?"HIGH":"MEDIUM";

export async function auditBatch(apiKey,rawSettings,batch,signal,log,onUsage){
  const settings=normalizeSettings(rawSettings);
  const maps=buildErrorMaps(settings);
  async function requestWithRetry(leads,label){
    let result,lastError;
    for(let attempt=1;attempt<=3;attempt++){
      try{result=await requestAudit(apiKey,settings,leads,signal,log,onUsage);break;}
      catch(error){
        if(error.name==="AbortError")throw error;
        lastError=error;
        log(`${label} attempt ${attempt} failed: ${error.message}`,"error");
        if(attempt<3)await new Promise(resolve=>setTimeout(resolve,attempt*1500));
      }
    }
    if(!result)throw lastError;
    return result;
  }
  const result=await requestWithRetry(batch,"Audit");
  const byId=new Map(result.map(item=>[clean(item.id),item]));
  let missing=batch.filter(lead=>!byId.has(clean(lead.leadId)));
  if(missing.length){
    log(`Model omitted ${missing.length} lead(s); retrying only those leads.`,"warn");
    const recovered=await requestWithRetry(missing,"Recovery");
    recovered.forEach(item=>byId.set(clean(item.id),item));
    missing=batch.filter(lead=>!byId.has(clean(lead.leadId)));
  }
  if(missing.length)throw new Error(`OpenAI still omitted ${missing.length} lead(s). Saved batches are safe; resume to retry.`);
  return batch.map(lead=>{
    const ai=byId.get(clean(lead.leadId));
    const aiErrors=Array.isArray(ai.e)?ai.e.map(token=>maps.resolve(token)).filter(label=>maps.allowed.has(label)):[];
    const connectedYes=lead.staticValues.connected==="Yes";
    let filteredAi=connectedYes?aiErrors:aiErrors.filter(label=>!CONNECTED_ONLY_ERRORS.has(label));
    // Exception projects blank `l` for the model but keep the city in Excel — do not keep AI empty-location.
    if(!isBlankish(lead.staticValues.location))filteredAi=filteredAi.filter(label=>label!==EMPTY_LOCATION);
    const filteredDet=connectedYes?lead.deterministicErrors:lead.deterministicErrors.filter(label=>!CONNECTED_ONLY_ERRORS.has(label));
    const merged=unique([...filteredDet,...filteredAi]).filter(label=>ERROR_TYPES.includes(label));
    const errors=merged.includes(EMPTY_REQUIREMENT)?merged.filter(label=>label!==WRONG_REQUIREMENT):merged;
    const intent=Number(ai.i)===1||clean(ai.i)==="1"||norm(ai.i)==="yes"?"Yes":"No";
    const q=clampCommentQuality(ai.q,lead.staticValues.comments);
    return{
      ...lead.staticValues,
      commentQuality:q,
      errorTypes:errors.length?errors.join(", "):"None",
      errorSeverity:severityFromErrors(errors),
      buyingIntent:intent,
      observation:finalizeObservation(ai.o,lead.staticValues,errors,q),
      recommendation:finalizeRecommendation(ai.r,lead.staticValues,errors,q)
    };
  });
}

export function selectedOutputFields(rawSettings){
  const settings=normalizeSettings(rawSettings);
  const enabled=settings.outputFields.filter(field=>field.enabled!==false&&field.id!=="dayCallIndex");
  // Lead identity columns first (Mobile, Project), then active sort column, then the rest.
  const leadIds=["mobile","project"];
  const leadCols=leadIds.map(id=>enabled.find(field=>field.id===id)).filter(Boolean);
  const rest=enabled.filter(field=>!leadIds.includes(field.id));
  const sortId=settings.sort?.field;
  if(sortId&&!leadIds.includes(sortId)){
    const primary=rest.find(field=>field.id===sortId);
    if(primary)return[...leadCols,primary,...rest.filter(field=>field.id!==sortId)];
  }
  return[...leadCols,...rest];
}

const DATE_SORT_FIELDS=new Set(["registration","next","update","callDate"]);
function sortValue(row,fieldId){
  const raw=row?.[fieldId];
  if(DATE_SORT_FIELDS.has(fieldId)){
    const date=parseDateTime(raw)||parseDate(raw);
    return date?date.valueOf():Number.NEGATIVE_INFINITY;
  }
  if(fieldId==="totalFollowups"||fieldId==="commentQuality"||fieldId==="dayCallCount")return Number(raw)||0;
  return String(raw??"").toLocaleLowerCase();
}
function leadIdentityKey(row){
  return`${String(row?.mobile??"").trim().toLowerCase()}\u0001${String(row?.project??"").trim().toLowerCase()}`;
}
export function sortResults(rows,rawSettings=DEFAULT_SETTINGS){
  const settings=normalizeSettings(rawSettings);
  const field=settings.sort.field||"callDate";
  const dir=settings.sort.direction==="desc"?-1:1;
  return[...(rows||[])].sort((a,b)=>{
    const mobileCmp=String(a.mobile??"").localeCompare(String(b.mobile??""),undefined,{numeric:true});
    const projectCmp=String(a.project??"").localeCompare(String(b.project??""),undefined,{numeric:true,sensitivity:"base"});
    // Always keep the same Mobile+Project contiguous so Excel can group the lead.
    if(field==="mobile"){
      if(mobileCmp)return mobileCmp*dir;
      if(projectCmp)return projectCmp;
    }else if(field==="project"){
      if(projectCmp)return projectCmp*dir;
      if(mobileCmp)return mobileCmp;
    }else{
      if(mobileCmp)return mobileCmp;
      if(projectCmp)return projectCmp;
      const av=sortValue(a,field),bv=sortValue(b,field);
      let cmp=0;
      if(typeof av==="number"&&typeof bv==="number")cmp=av===bv?0:av<bv?-1:1;
      else cmp=String(av).localeCompare(String(bv),undefined,{numeric:true,sensitivity:"base"});
      if(cmp)return cmp*dir;
    }
    const dateCmp=(parseDateTime(a.callDate)?.valueOf()??parseDate(a.callDate)?.valueOf()??0)-(parseDateTime(b.callDate)?.valueOf()??parseDate(b.callDate)?.valueOf()??0);
    if(dateCmp)return dateCmp*dir;
    return((Number(a.dayCallIndex)||0)-(Number(b.dayCallIndex)||0))*dir;
  });
}

function sanitizeExcelCell(value){
  if(value==null)return"";
  if(typeof value==="number"&&Number.isFinite(value))return value;
  const text=String(value);
  // Neutralize formula / CSV injection when Excel opens the download.
  return/^[=+\-@\t\r]/.test(text)?`'${text}`:text;
}

function stampFile(){
  return new Date().toISOString().slice(0,19).replace(/[:T]/g,"-");
}

function triggerBlobDownload(blob,filename){
  const url=URL.createObjectURL(blob);
  const link=document.createElement("a");
  link.href=url;
  link.download=filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Build an audit workbook (SheetJS book) from job results. */
export function buildWorkbookBook(job,currentSettings){
  const settings=normalizeSettings(currentSettings);
  const fields=selectedOutputFields(settings);
  if(!fields.length)throw new Error("Select at least one output field in Settings.");
  const rows=sortResults(job.results||[],settings);
  const data=rows.map(row=>Object.fromEntries(fields.map(field=>[field.label,sanitizeExcelCell(row[field.id]??"")])));
  const sheet=XLSX.utils.json_to_sheet(data,{header:fields.map(field=>field.label)});
  sheet["!cols"]=fields.map(field=>({wch:Math.min(48,Math.max(14,field.label.length+2,...data.slice(0,100).map(row=>String(row[field.label]??"").length+2)))}));
  const mobileCol=fields.findIndex(field=>field.id==="mobile");
  const projectCol=fields.findIndex(field=>field.id==="project");
  const groupCols=[mobileCol,projectCol].filter(col=>col>=0);
  if(groupCols.length&&rows.length>1){
    sheet["!merges"]=sheet["!merges"]||[];
    let start=0;
    for(let i=1;i<=rows.length;i++){
      const same=i<rows.length&&leadIdentityKey(rows[i])===leadIdentityKey(rows[start]);
      if(same)continue;
      if(i-start>1){
        for(const col of groupCols){
          sheet["!merges"].push({s:{r:start+1,c:col},e:{r:i,c:col}});
        }
      }
      start=i;
    }
  }
  const book=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,sheet,"Audit Data");
  return{book,settings,stamp:stampFile()};
}

export function buildWorkbookBlob(job,currentSettings){
  const{book}=buildWorkbookBook(job,currentSettings);
  const buffer=XLSX.write(book,{bookType:"xlsx",type:"array"});
  return new Blob([buffer],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
}

export function downloadWorkbook(job,currentSettings){
  const{book,settings,stamp}=buildWorkbookBook(job,currentSettings);
  XLSX.writeFile(book,`Audit_Data_${stamp}_${settings.sort.field}-${settings.sort.direction}.xlsx`);
}

/** Merge completed TeleCaller review jobs into one Excel payload (+ legacy text join). */
export function mergeReviewJobs(jobs){
  const list=(jobs||[]).filter(Boolean);
  const results=list.flatMap(job=>job.results||[]);
  const reviewText=list.map(job=>{
    const name=job.telecallerName||job.fileName||"Unknown";
    const body=clean(job.reviewText)||"(No review generated.)";
    return`=== TeleCaller: ${name} ===\n\n${body}`;
  }).join("\n\n");
  const base=list[0]||{};
  return{
    results,
    reviewText,
    job:{
      ...base,
      fileName:"TeleCaller_Reviews_combined",
      telecallerName:"Combined",
      results,
      reviewText,
      leadCount:list.reduce((sum,job)=>sum+(Number(job.leadCount)||0),0),
      callCount:list.reduce((sum,job)=>sum+(Number(job.callCount)||0),0)
    }
  };
}

export function downloadTextFile(text,filename){
  triggerBlobDownload(new Blob([String(text??"")],{type:"text/plain;charset=utf-8"}),filename);
}

export function downloadBlobFile(blob,filename){
  triggerBlobDownload(blob,filename);
}

const PDF_BRAND={
  green:"#12372a",
  green2:"#1f5d45",
  mint:"#dff4e8",
  amber:"#c57924",
  red:"#a33a32",
  ink:"#17211d",
  muted:"#6c7771",
  line:"#dfe5e1",
  paper:"#f4f6f3",
  white:"#ffffff"
};

function requirePdfLibs(){
  const jsPDF=window.jspdf?.jsPDF;
  if(typeof jsPDF!=="function")throw new Error("jsPDF failed to load. Check your network connection and reload.");
  if(typeof window.Chart!=="function")throw new Error("Chart.js failed to load. Check your network connection and reload.");
  return{jsPDF,Chart:window.Chart};
}

function jobReviewReport(job){
  if(job?.reviewReport&&typeof job.reviewReport==="object"){
    return{
      headline:clean(job.reviewReport.headline||""),
      summary:clean(job.reviewReport.summary||job.reviewText||""),
      strengths:Array.isArray(job.reviewReport.strengths)?job.reviewReport.strengths.map(clean).filter(Boolean):[],
      risks:Array.isArray(job.reviewReport.risks)?job.reviewReport.risks.map(clean).filter(Boolean):[],
      coachingFocus:Array.isArray(job.reviewReport.coachingFocus)?job.reviewReport.coachingFocus.map(clean).filter(Boolean):[]
    };
  }
  const summary=clean(job?.reviewText||"");
  return{headline:"",summary,strengths:[],risks:[],coachingFocus:[]};
}

function pdfHexRgb(hex){
  const h=String(hex||"").replace("#","");
  return{
    r:parseInt(h.slice(0,2),16),
    g:parseInt(h.slice(2,4),16),
    b:parseInt(h.slice(4,6),16)
  };
}

function pdfSetFill(doc,hex){
  const{r,g,b}=pdfHexRgb(hex);
  doc.setFillColor(r,g,b);
}
function pdfSetDraw(doc,hex){
  const{r,g,b}=pdfHexRgb(hex);
  doc.setDrawColor(r,g,b);
}
function pdfSetText(doc,hex){
  const{r,g,b}=pdfHexRgb(hex);
  doc.setTextColor(r,g,b);
}

function pdfWrap(doc,text,maxWidth){
  return doc.splitTextToSize(String(text||""),maxWidth);
}

function pdfEnsureSpace(doc,y,need,marginBottom){
  const pageH=doc.internal.pageSize.getHeight();
  if(y+need<=pageH-marginBottom)return y;
  doc.addPage();
  return 18;
}

async function renderOffscreenChart(Chart,type,data,options,width,height){
  const canvas=document.createElement("canvas");
  canvas.width=width;
  canvas.height=height;
  canvas.style.cssText="position:fixed;left:-9999px;top:0;width:"+width+"px;height:"+height+"px;pointer-events:none;opacity:0;";
  document.body.appendChild(canvas);
  const chart=new Chart(canvas,{
    type,
    data,
    options:{
      ...options,
      responsive:false,
      animation:false,
      devicePixelRatio:2
    }
  });
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const url=canvas.toDataURL("image/png");
  chart.destroy();
  canvas.remove();
  return url;
}

async function buildReviewChartImages(Chart,metrics){
  const qualityLabels=Object.keys(metrics.qualityDistribution||{});
  const qualityValues=qualityLabels.map(key=>Number(metrics.qualityDistribution[key])||0);
  const errorLabels=(metrics.errorTallies||[]).slice(0,8).map(item=>item.label.length>36?item.label.slice(0,34)+"…":item.label);
  const errorValues=(metrics.errorTallies||[]).slice(0,8).map(item=>item.count);
  const severityLabels=["NONE","MEDIUM","HIGH"];
  const severityValues=severityLabels.map(key=>Number(metrics.severityMix?.[key])||0);
  const commonPlugins={legend:{display:false},title:{display:false},tooltip:{enabled:false}};
  const [qualityImg,errorsImg,severityImg]=await Promise.all([
    renderOffscreenChart(Chart,"bar",{
      labels:qualityLabels,
      datasets:[{data:qualityValues,backgroundColor:PDF_BRAND.green2,borderWidth:0,borderRadius:3}]
    },{
      plugins:commonPlugins,
      scales:{
        x:{ticks:{color:PDF_BRAND.muted,font:{size:10}},grid:{display:false}},
        y:{beginAtZero:true,ticks:{precision:0,color:PDF_BRAND.muted,font:{size:10}},grid:{color:PDF_BRAND.line}}
      }
    },520,260),
    renderOffscreenChart(Chart,"bar",{
      labels:errorLabels.length?errorLabels:["No errors"],
      datasets:[{data:errorValues.length?errorValues:[0],backgroundColor:PDF_BRAND.amber,borderWidth:0,borderRadius:3}]
    },{
      indexAxis:"y",
      plugins:commonPlugins,
      scales:{
        x:{beginAtZero:true,ticks:{precision:0,color:PDF_BRAND.muted,font:{size:9}},grid:{color:PDF_BRAND.line}},
        y:{ticks:{color:PDF_BRAND.ink,font:{size:8}},grid:{display:false}}
      }
    },520,260),
    renderOffscreenChart(Chart,"doughnut",{
      labels:severityLabels,
      datasets:[{data:severityValues,backgroundColor:[PDF_BRAND.green2,PDF_BRAND.amber,PDF_BRAND.red],borderWidth:2,borderColor:"#ffffff"}]
    },{
      plugins:{
        legend:{display:true,position:"bottom",labels:{color:PDF_BRAND.ink,boxWidth:10,font:{size:10}}},
        title:{display:false},
        tooltip:{enabled:false}
      }
    },320,260)
  ]);
  return{qualityImg,errorsImg,severityImg};
}

function scorePercents(metrics){
  const audited=Math.max(1,Number(metrics.auditedRows)||0);
  const high=Number(metrics.severityMix?.HIGH)||0;
  const medium=Number(metrics.severityMix?.MEDIUM)||0;
  const errorRows=high+medium;
  const intentYes=Number(metrics.buyingIntentMix?.Yes)||0;
  return{
    avgQuality:Number(metrics.avgCommentQuality)||0,
    errorRate:Math.round((errorRows/audited)*1000)/10,
    highSeverity:Math.round((high/audited)*1000)/10,
    buyingIntent:Math.round((intentYes/audited)*1000)/10
  };
}

async function drawTelecallerReviewPage(doc,Chart,job,{isFirstPage=true}={}){
  const marginX=16;
  const marginBottom=16;
  const pageW=doc.internal.pageSize.getWidth();
  const contentW=pageW-marginX*2;
  if(!isFirstPage)doc.addPage();
  const startPage=doc.getNumberOfPages();

  const metrics=buildReviewSummary(job);
  const report=jobReviewReport(job);
  const scores=scorePercents(metrics);
  const runDate=job.updatedAt||job.createdAt||new Date().toISOString();
  const runLabel=(()=>{
    const d=new Date(runDate);
    return Number.isNaN(d.valueOf())?String(runDate):d.toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"});
  })();

  // Header band
  pdfSetFill(doc,PDF_BRAND.green);
  doc.rect(0,0,pageW,28, "F");
  pdfSetText(doc,PDF_BRAND.white);
  doc.setFont("helvetica","bold");
  doc.setFontSize(14);
  doc.text("LeadLens",marginX,12);
  doc.setFont("helvetica","normal");
  doc.setFontSize(10);
  doc.text("TeleCaller Performance Report",marginX,20);
  doc.setFontSize(9);
  doc.text(String(metrics.telecallerName||"Unknown"),pageW-marginX,12,{align:"right"});
  doc.text(runLabel,pageW-marginX,20,{align:"right"});

  let y=34;
  pdfSetText(doc,PDF_BRAND.muted);
  doc.setFontSize(9);
  doc.text(`Leads ${Number(metrics.leadCount||0).toLocaleString()}  ·  Calls ${Number(metrics.callCount||0).toLocaleString()}  ·  Audited ${Number(metrics.auditedRows||0).toLocaleString()}`,marginX,y);
  y+=6;

  if(report.headline){
    pdfSetText(doc,PDF_BRAND.ink);
    doc.setFont("helvetica","bold");
    doc.setFontSize(11);
    const headlineLines=pdfWrap(doc,report.headline,contentW);
    doc.text(headlineLines,marginX,y);
    y+=headlineLines.length*5+2;
    doc.setFont("helvetica","normal");
  }

  // Score strip
  const scoreCards=[
    {label:"Avg comment quality",value:String(scores.avgQuality)},
    {label:"Error rate",value:`${scores.errorRate}%`},
    {label:"High-severity",value:`${scores.highSeverity}%`},
    {label:"Buying intent",value:`${scores.buyingIntent}%`}
  ];
  const gap=4;
  const cardW=(contentW-(scoreCards.length-1)*gap)/scoreCards.length;
  const cardH=16;
  scoreCards.forEach((card,i)=>{
    const x=marginX+i*(cardW+gap);
    pdfSetFill(doc,PDF_BRAND.mint);
    doc.roundedRect(x,y,cardW,cardH,2,2,"F");
    pdfSetText(doc,PDF_BRAND.muted);
    doc.setFontSize(7);
    doc.text(card.label,x+3,y+5.5);
    pdfSetText(doc,PDF_BRAND.green);
    doc.setFont("helvetica","bold");
    doc.setFontSize(12);
    doc.text(card.value,x+3,y+12.5);
    doc.setFont("helvetica","normal");
  });
  y+=cardH+8;

  // Charts
  const charts=await buildReviewChartImages(Chart,metrics);
  const chartH=42;
  const leftW=contentW*0.48;
  const midW=contentW*0.48;
  pdfSetText(doc,PDF_BRAND.ink);
  doc.setFont("helvetica","bold");
  doc.setFontSize(9);
  doc.text("Comment quality distribution",marginX,y);
  doc.text("Top error types",marginX+leftW+4,y);
  y+=3;
  doc.addImage(charts.qualityImg,"PNG",marginX,y,leftW,chartH);
  doc.addImage(charts.errorsImg,"PNG",marginX+leftW+4,y,midW,chartH);
  y+=chartH+8;

  y=pdfEnsureSpace(doc,y,55,marginBottom);
  doc.setFont("helvetica","bold");
  doc.setFontSize(9);
  pdfSetText(doc,PDF_BRAND.ink);
  doc.text("Severity mix",marginX,y);
  y+=3;
  const sevW=Math.min(70,contentW*0.4);
  doc.addImage(charts.severityImg,"PNG",marginX,y,sevW,48);
  y+=52;

  // Narrative
  y=pdfEnsureSpace(doc,y,24,marginBottom);
  pdfSetFill(doc,PDF_BRAND.green);
  doc.rect(marginX,y,2.2,5,"F");
  pdfSetText(doc,PDF_BRAND.ink);
  doc.setFont("helvetica","bold");
  doc.setFontSize(10);
  doc.text("Coach summary",marginX+5,y+4);
  y+=9;
  doc.setFont("helvetica","normal");
  doc.setFontSize(9);
  pdfSetText(doc,PDF_BRAND.ink);
  const summaryLines=pdfWrap(doc,report.summary||"(No review generated.)",contentW);
  for(const line of summaryLines){
    y=pdfEnsureSpace(doc,y,5,marginBottom);
    doc.text(line,marginX,y);
    y+=4.4;
  }
  y+=4;

  const writeBulletSection=(title,items)=>{
    const list=items?.length?items:["None noted from this audit pass."];
    y=pdfEnsureSpace(doc,y,14,marginBottom);
    pdfSetFill(doc,PDF_BRAND.green);
    doc.rect(marginX,y,2.2,5,"F");
    pdfSetText(doc,PDF_BRAND.ink);
    doc.setFont("helvetica","bold");
    doc.setFontSize(10);
    doc.text(title,marginX+5,y+4);
    y+=8;
    doc.setFont("helvetica","normal");
    doc.setFontSize(9);
    for(const item of list){
      const lines=pdfWrap(doc,`•  ${item}`,contentW-2);
      for(const line of lines){
        y=pdfEnsureSpace(doc,y,5,marginBottom);
        doc.text(line,marginX,y);
        y+=4.4;
      }
      y+=1;
    }
    y+=3;
  };

  writeBulletSection("Strengths",report.strengths);
  writeBulletSection("Risks",report.risks);
  writeBulletSection("Coaching focus",report.coachingFocus);

  const endPage=doc.getNumberOfPages();
  const pageH=doc.internal.pageSize.getHeight();
  for(let p=startPage;p<=endPage;p++){
    doc.setPage(p);
    pdfSetDraw(doc,PDF_BRAND.line);
    doc.setLineWidth(0.2);
    doc.line(marginX,pageH-10,pageW-marginX,pageH-10);
    pdfSetText(doc,PDF_BRAND.muted);
    doc.setFontSize(7);
    doc.text(`LeadLens ${APP_VERSION} · Confidential management report`,marginX,pageH-6);
    doc.text(`${metrics.telecallerName||"TeleCaller"} · ${p}`,pageW-marginX,pageH-6,{align:"right"});
  }
}

/** Build a multi-page TeleCaller performance PDF (one section/page set per job). */
export async function buildReviewPdfBlob(jobs){
  const list=(jobs||[]).filter(job=>job&&(job.results?.length||job.reviewText||job.reviewReport));
  if(!list.length)throw new Error("No completed TeleCaller reviews to export as PDF.");
  const{jsPDF,Chart}=requirePdfLibs();
  const doc=new jsPDF({orientation:"portrait",unit:"mm",format:"a4"});
  for(let i=0;i<list.length;i++){
    await drawTelecallerReviewPage(doc,Chart,list[i],{isFirstPage:i===0});
  }
  return doc.output("blob");
}

export async function downloadReviewPdf(jobs,filename){
  const blob=await buildReviewPdfBlob(jobs);
  downloadBlobFile(blob,filename);
}

/** Download review PDF + audit Excel for one or many jobs according to packing. */
export async function downloadReviewPack(jobs,currentSettings,{packing="combined",artifact="both"}={}){
  const list=(jobs||[]).filter(job=>job&&(job.results?.length||job.reviewText||job.reviewReport));
  if(!list.length)throw new Error("No completed TeleCaller reviews to download.");
  const settings=normalizeSettings(currentSettings);
  const stamp=stampFile();
  const wantPdf=artifact==="both"||artifact==="pdf"||artifact==="txt";
  const wantExcel=artifact==="both"||artifact==="excel";
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

  if(packing==="separate"){
    for(let i=0;i<list.length;i++){
      const job=list[i];
      const part=sanitizeFilePart(job.telecallerName||job.fileName||`TeleCaller_${i+1}`);
      if(wantPdf)await downloadReviewPdf([job],`Review_${part}_${stamp}.pdf`);
      if(wantExcel){
        const blob=buildWorkbookBlob(job,settings);
        downloadBlobFile(blob,`Audit_${part}_${stamp}_${settings.sort.field}-${settings.sort.direction}.xlsx`);
      }
      if(i<list.length-1)await sleep(300);
    }
    return;
  }

  const merged=mergeReviewJobs(list);
  if(wantPdf)await downloadReviewPdf(list,`TeleCaller_Reviews_${stamp}.pdf`);
  if(wantExcel){
    const blob=buildWorkbookBlob(merged.job,settings);
    downloadBlobFile(blob,`Audit_Data_${stamp}_${settings.sort.field}-${settings.sort.direction}.xlsx`);
  }
}

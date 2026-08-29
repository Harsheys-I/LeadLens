import {buildTelecallerDashboardBlob} from "./dashboard-export.js?v=5.2.5";
import {STATUS_HISTORY_PROMPT} from "./debug-prompts.js?v=5.2.13";

export const APP_VERSION = "5.2.13";
/** Sentinel: use server OpenAI proxy (no raw key in the browser). */
export const SERVER_API_KEY = "__server__";
/** Bump when default AI rules / field defaults must refresh existing localStorage settings. */
export const SETTINGS_SEED = 22;

/** Settings limits — batch size is leads per request; concurrency is parallel requests. */
export const MAX_BATCH_SIZE = 20;
export const MAX_CONCURRENCY = 50;

export const ERROR_TYPES = [
  "Lead Status Not Aligned With Comments",
  "Follow-up Missed",
  "Estimate Budget Empty",
  "Customer Requirement Empty",
  "Customer Location Empty",
  "Analysis Parameter Empty",
  "Incorrect Customer Requirement",
  "Customer Comment Quality Not Appropriate"
];
/** Critical severity only — everything else in ERROR_TYPES is Medium when present. */
export const HIGH_SEVERITY_ERRORS = new Set([
  "Follow-up Missed",
  "Customer Requirement Empty",
  "Customer Comment Quality Not Appropriate"
]);
const STATUS_HISTORY_ERROR = "Lead Status Not Aligned With Comments";
const FOLLOWUP_MISSED_ERROR = "Follow-up Missed";
const EMPTY_LOCATION = "Customer Location Empty";
const EMPTY_REQUIREMENT = "Customer Requirement Empty";
const EMPTY_BUDGET = "Estimate Budget Empty";
const EMPTY_PARAMETER = "Analysis Parameter Empty";
const WRONG_REQUIREMENT = "Incorrect Customer Requirement";
const COMMENT_QUALITY_ERROR = "Customer Comment Quality Not Appropriate";
const CONNECTED_ONLY_ERRORS = new Set([
  EMPTY_LOCATION,
  EMPTY_REQUIREMENT,
  EMPTY_BUDGET,
  WRONG_REQUIREMENT,
  COMMENT_QUALITY_ERROR
]);
/** Local-owned labels — used to strip leftover AI types from old in-flight batches. */
const LOCAL_OWNED_ERRORS = new Set([
  FOLLOWUP_MISSED_ERROR,
  EMPTY_PARAMETER,
  EMPTY_LOCATION,
  EMPTY_BUDGET,
  EMPTY_REQUIREMENT
]);
/** AI may emit only these labels; local-owned types are stripped on merge. */
export const AI_ALLOWED_ERRORS = new Set([
  STATUS_HISTORY_ERROR,
  EMPTY_REQUIREMENT,
  WRONG_REQUIREMENT,
  COMMENT_QUALITY_ERROR
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
/** Renamed / alias labels → canonical ERROR_TYPES text. Retired TAT labels are dropped (not mapped). */
const LEGACY_ERROR_LABELS = {
  "followup date is missed": FOLLOWUP_MISSED_ERROR,
  "follow up date is missed": FOLLOWUP_MISSED_ERROR,
  "follow-up date is missed": FOLLOWUP_MISSED_ERROR,
  "lead status not reflecting comment history": STATUS_HISTORY_ERROR,
  "lead status not aligned with customer comments": STATUS_HISTORY_ERROR,
  "comment displaying -ve, but lead status is +ve": STATUS_HISTORY_ERROR,
  "comment displaying +ve, but lead status is -ve": STATUS_HISTORY_ERROR,
  "lead update not matching prior follow-up": FOLLOWUP_MISSED_ERROR,
  "customer location is empty": EMPTY_LOCATION,
  "customer requirement is empty": EMPTY_REQUIREMENT,
  "estimated budget is empty": EMPTY_BUDGET,
  "analysis parameter is empty": EMPTY_PARAMETER,
  "customer requirement is set wrong": WRONG_REQUIREMENT,
  "customer comment quality not appropriate": COMMENT_QUALITY_ERROR,
  "comment quality not appropriate": COMMENT_QUALITY_ERROR
};
export const AI_FIELD_KEYS = {status:"s",comments:"c",next:"n",location:"l",requirement:"rq",budget:"b",connected:"k"};

export const DEFAULT_INPUT_FIELDS = [
  {id:"mobile",label:"Mobile",aliases:"mobile, mobile number, mobile no, phone, phone number",required:true},
  {id:"project",label:"Project Name",aliases:"project name, project",required:true},
  {id:"registration",label:"Lead Registration Date",aliases:"lead registration date, registration date",required:false},
  {id:"telecaller",label:"Telecaller Name",aliases:"telecaller name, tellecaller name, tele caller name, telle caller name, caller name, agent name, executive name",required:false},
  {id:"source",label:"Source",aliases:"source, source name",required:false},
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
  {id:"next",label:"Next Followup Date",enabled:true,history:false},{id:"location",label:"Customer Location",enabled:false,history:false},
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
  {id:"next",label:"Next Followup Date",enabled:true},{id:"overdue",label:"Overdue",enabled:true},{id:"totalFollowups",label:"Total Followups",enabled:true},{id:"dayCallCount",label:"Calls on Latest Day",enabled:true},
  {id:"connected",label:"Connected",enabled:true},
  {id:"location",label:"Customer Location",enabled:true},
  {id:"requirement",label:"Customer Requirement",enabled:true},{id:"parameter",label:"Analysis Parameter",enabled:true},{id:"budget",label:"Estimated Budget",enabled:true},
  {id:"commentQuality",label:"Comment Quality Score",enabled:true},{id:"errorTypes",label:"Error Type(s)",enabled:true},{id:"errorSeverity",label:"Error Severity",enabled:true},
  {id:"buyingIntent",label:"Buying Intent",enabled:true},{id:"observation",label:"AI Observation",enabled:true},{id:"recommendation",label:"AI Recommendation",enabled:true}
];
export const DEFAULT_RULES = [
  {field:"Lead Status + Comments",instruction:STATUS_HISTORY_PROMPT,errors:STATUS_HISTORY_ERROR},
  {field:"Comment quality",instruction:`Score q strictly. q must reflect how well Comments capture the real telecaller–customer conversation (need, budget, location preference, objection, decision-maker, next step). One-word/CRM crumbs like visited/RNR/CNP/busy/followup = q 0-2 max. Generic connected notes without customer detail = q <=4. Only rich descriptive talk earns 8-10. When c is an array, score THIS call's latest comment (last entry), using earlier entries only as context. Separately, when k=Yes and comments lack requirement detail (facing east/west/north/corner etc, size/dimension, investment vs self purpose, immediate vs future plan) → also emit "${COMMENT_QUALITY_ERROR}".`,errors:COMMENT_QUALITY_ERROR},
  {field:"Customer Requirement",instruction:`Only review Customer Requirement when k=Yes AND rq is present and not a fully empty string (fully blank rq is already in le). On a connected lead, rq should describe what the customer genuinely wants — for example a home configuration (2BHK/3BHK/plot), a budget, a preferred location/locality, facing, or a possession timeline. If rq is only a placeholder such as ".", "-", "**", "NA" or "nil", raise "${EMPTY_REQUIREMENT}". If rq instead holds call notes or jargon rather than a real need — for example RNR, CNP, Visited, Site visit, Busy, Follow-up, Callback, Interested/Not interested — raise "${WRONG_REQUIREMENT}". When k is No or blank, or rq is omitted, never raise either of these two errors.`,errors:`${EMPTY_REQUIREMENT} | ${WRONG_REQUIREMENT}`},
  {field:"Local-only errors",instruction:`Never emit Follow-up Missed, Estimate Budget Empty, Customer Location Empty, Analysis Parameter Empty, Fresh Call TAT Missed, TAT Error, or any TAT label. Those are precomputed in le. Explain labels in le in o/r, but do not copy them into e. Fully blank budget is local-only — even if b is omitted or empty, do not emit Estimate Budget Empty.`,errors:""},
  {field:"AI Observation",instruction:"Write o as a layman supervisor speaking to a telecaller (18-28 words). Cross-check every Error Type in le ∪ e against Comments (c): say specifically what in the comments supports (or conflicts with) each error. Also use Connected (k) naturally ('the call connected' / 'never connected'), never Connected=Yes/No dumps. Name the gap in plain words (status too low for clear buying signals, status too cold after only 1–5 neutral RNR/Busy gaps, location missing, overdue follow-up date, junk requirement, thin requirement detail). Forbidden: copying or paraphrasing c; stacking raw error labels; template fragments; inventing facts not in c; claiming Cold/Lost is wrong when comments show clear ACTIVE NI/dead ('not interested', 'stop calling', 'not looking', 'enquired by mistake') or 8+ consecutive RNRs; treating 1–5 RNR/Busy as proof the lead cooled. When le and e are both empty, judge note quality / connectedness only.",errors:""},
  {field:"AI Recommendation",instruction:"Write r as layman coaching (20-40 words) grounded in comment history + Connected (k) + Error Types in le ∪ e + whether n (next follow-up date) is already set. Cover both: (1) how to fix those errors next time with concrete habits matching each error (write detailed comments with facing/size/purpose/timeline, fill location/budget/requirement, align status only when e contains Lead Status Not Aligned With Comments); (2) clearly state what to do next on the lead. HARD: if clear ACTIVE NI or dead ('not interested', 'stop calling', 'not looking', 'enquired by mistake') → tell telecaller to change or confirm Lead Status to Lost and **close the lead** — NOT 'capture details if connects' / generic warm follow-up. Do NOT coach status changes when status is aligned under Rules 1–2 (pure RNR or 5+ trailing RNR with Cold). If n is already set, NEVER say 'set a follow-up date'; for Follow-up Missed explain the date is overdue — call/proceed now. Only coach setting a dated follow-up when n is blank/missing. Not a rewrite of the comment. Not vague ('follow up', 'update remarks', 'call again'). Not Connected=Yes/No or error-label dumps.",errors:""},
  {field:"Buying intent",instruction:"i=1 only for genuine positive purchase interest evidenced in comments (assess cumulative intent from full c; 1–5 RNR/Busy/Unreachable are neutral and do not cancel prior interest). i=0 for clear ACTIVE NI/dead, wrong number, or 8+ consecutive RNR with no prior interest signal.",errors:""}
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
const CACHE_HANDBOOK = `LeadLens QA v5.2.13 — stable cacheable auditor handbook. Evidence only. Never invent facts, dates, budgets, locations, or prior calls.

PURPOSE
You audit Indian real-estate telecalling follow-up notes. Judge only the supplied fields for THIS call id. Optional day[] lists sibling calls on the same latest calendar day — context only; still return one result for THIS id.

INPUT CONTRACT
- id: opaque lead/call id. Echo it exactly. Never invent or drop ids.
- s: Lead Status on THIS call
- c: Comments — ALWAYS full chronological history array for the lead (oldest→newest). Status uses FULL timeline cumulative intent; q/i focus on the last entry
- n: Next Followup Date for THIS call (DD/MM/YYYY calendar date only — ignore any time if present). Context for o/r only — NEVER emit Follow-up Missed. If n is already set, NEVER recommend "set a follow-up date"
- u: THIS call's Lead Update DateTime
- rq: Customer Requirement (omitted when already flagged locally as fully blank)
- b: Estimated Budget (omitted when already flagged locally as fully blank)
- k: Connected Yes / No / "" (Yes means any call on the lead connected)
- le: precomputed local error labels. Explain them in o/r. NEVER copy le labels into e.
- day[] (optional): siblings [{d,s,c,n,rq,b,k}, ...] same calendar day
Empty string means unknown / not captured.

OUTPUT CONTRACT (JSON schema a[] only)
For each id return:
- q: integer 0-10 comment quality
- e: array of exact Error Type labels from the AI-allowed list only (full text, never numeric codes)
- i: 0 or 1 buying intent
- o: 18-28 words QA observation that cross-checks Error Types in le ∪ e against Comments (analysis, not a comment copy)
- r: 20-40 words coaching — how to fix those errors next time + clear next-call / follow-up actions
No severity field. No markdown. No extra keys.

ERROR TYPES YOU MAY EMIT (exact labels only — no codes, no paraphrases, no other labels)
- Lead Status Not Aligned With Comments
- Customer Requirement Empty
- Incorrect Customer Requirement
- Customer Comment Quality Not Appropriate
Do NOT emit Follow-up Missed, Estimate Budget Empty, Customer Location Empty, Analysis Parameter Empty, Fresh Call TAT Missed, TAT Error, or any TAT / SLA label. Those local-only issues arrive in le.
Prefer e:[] over weak guesses — especially for "Lead Status Not Aligned With Comments". NEVER invent labels outside this list.

COMMENT QUALITY q — STRICT
Comments must reflect the actual telecaller–customer talk (need, budget, locality preference, objection, decision-maker, next step).
10: rich conversation — config/area + budget/objection + decision context + clear next action
8-9: strong descriptive talk with customer need and next step
6-7: partial real conversation detail, still actionable
4-5: thin connected note, little customer substance
2-3: boilerplate / 2-3 vague words
0-1: empty, unreadable, or single CRM crumb
HARD CAPS: visited / visit / RNR / CNP / busy / followup / SV alone or near-alone => q<=2. Not descriptive => never score 8-10.

CUSTOMER COMMENT QUALITY NOT APPROPRIATE
When k=Yes (any call connected): comments should capture requirement detail such as facing (east/west/north/south/corner), size/dimension (BHK, sqft, plot size), investment vs self purpose, and immediate vs future plan. If connected comments lack those requirement details → emit "Customer Comment Quality Not Appropriate". When k=No or "", never emit this label.

CUSTOMER REQUIREMENT rq
Only when k=Yes AND rq is present (not omitted) and not a fully empty string. Fully blank rq is already in le — do not emit a requirement error for missing rq.
Valid examples: 2BHK, 30x40 plot, Whitefield, east facing, under 90L need, possession in 2027, etc.
INVALID when connected and non-blank ("Incorrect Customer Requirement"): RNR, CNP, Visited, Site visit, Busy, Followup, Callback, Interested, Not interested, Connected, ringing, wrong number, status/comment dumps.
Placeholder-only (., -, NA, nil, **) on connected call => "Customer Requirement Empty", not "Incorrect Customer Requirement".
If le already contains "Customer Requirement Empty", do not also emit "Incorrect Customer Requirement".

BUYING INTENT i
i=1 only for genuine purchase interest (site visit interest, options request, active shortlist, budget toward buy) evidenced in comments.
Assess cumulative intent from full c; 1–5 RNR/Busy/Unreachable notes are neutral and do not cancel prior interest.
i=0 for clear ACTIVE NI/dead ("not interested", "stop calling", "not looking", "enquired by mistake"), wrong number, or 8+ consecutive RNR with no prior interest signal.

${STATUS_HISTORY_PROMPT}
Do not emit any other status/comment polarity labels.

LOCAL ERRORS (le) — DO NOT EMIT
le is computed by the app: Follow-up Missed (overdue next-followup date), Estimate Budget Empty (fully blank budget on connected calls), Customer Location Empty, Analysis Parameter Empty.
Explain every le label in o/r. Never copy those labels into e. Never invent TAT / same-day first-call / SLA errors.

CONNECTED GATING
"Customer Requirement Empty", "Incorrect Customer Requirement", and "Customer Comment Quality Not Appropriate" are ALLOWED ONLY when k=Yes.
If k is No or "", NEVER emit those — even if rq is empty, "**", ".", or junk.

STYLE — OBSERVATION (o) AND RECOMMENDATION (r)
Voice: layman QA supervisor speaking to the telecaller — clear, specific, human. No CRM jargon dumps.

o (18–28 words): Cross-check each Error Type in le ∪ e against Comments (c) — cite what in the comments aligns or conflicts with that error. Also use Connected (k) naturally ("the call connected" / "the call never connected") — NEVER "Connected=Yes" / "Connected=No". Cover each issued error in plain words (status too low for clear buying signals, status too cold after only neutral RNR/Busy gaps, preferred location missing, overdue follow-up date, junk requirement, thin requirement detail). Quote or paraphrase only facts from c — never invent details. When le and e are both empty, judge note quality / connectedness only.
Bad o: "Connected=Yes. Comment lacks a real telecaller–customer conversation. Connected call missing usable location."
Bad o: "Comments show budget and site-visit interest but status is Cold — status is too low for the buying signals in the notes." (Good upward-fix shape — but o must quote actual comment text, not generic placeholders.)
Bad o: "Two RNR notes after interest mean the lead cooled, so Cold status fits." (WRONG — 1–5 RNR/Busy are neutral and do not cancel prior interest.)
Bad o: "The call connected, but comments are vague, which does not support a Lost status." (WRONG when comments show ACTIVE NI/dead or 8+ consecutive RNR — Lost is valid.)
Good o: "Comments mention 2BHK under 90L and a Saturday visit, but status is Cold — status is too low for that interest." / "Customer said not interested, then 8+ RNR — Lost status fits the dead trail." / "Only passive admin notes — Warm baseline fits; no status mismatch."

r (20–40 words): Coaching from full comment history + Connected + Error Types in le ∪ e + whether n is set. Must include (1) how to avoid those same errors next time and (2) what to do next on the lead.
HARD r rules:
- Only coach Lead Status changes when e contains "Lead Status Not Aligned With Comments" (or when closing a dead lead on clear ACTIVE NI). Do NOT write status-alignment coaching when that label is absent from e.
- Clear ACTIVE NI/dead ("not interested", "stop calling", "not looking", "enquired by mistake") → tell telecaller to change/confirm Lead Status to Lost and **close the lead**. Do NOT say "capture details if connects" / keep chasing as warm pipeline.
- Pure RNR trails or early interest + last 5+ RNR with Cold status are ALIGNED — do NOT coach stepping Cold up, and do NOT force Cold→Lost solely for many RNRs.
- If n is already set: NEVER say "set a follow-up date". For Follow-up Missed, say the date is overdue — call/proceed now and fix other errors.
- Only coach setting a dated follow-up when n is blank/missing.
Bad r: "Follow up and update comments." / "Capture details if the customer connects." (when history is dead NI)
Good r: "Change Lead Status to Lost and close this lead — customer said not interested." / "Status is Cold but last notes still show budget interest with only 2 RNRs after — step to Warm; call on the overdue follow-up already on file."
Never dump the full comment into o or r. Never restate this handbook.

EXAMPLES
A) c="visited" => q<=2, usually i=0.
B) k=Yes, rq="." => "Customer Requirement Empty". k=Yes with rq omitted (fully blank locally) => do not emit a requirement label.
C) k=Yes, rq="RNR" or "Visited" => "Incorrect Customer Requirement".
D) k=Yes, rq="2BHK Whitefield" => rq OK.
E) day[] siblings present: score/flag THIS call only; siblings are context.
F) s=Hot, c=wants 2BHK under 90L Saturday visit => high q, i=1, e:[].
G) c [interested 2BHK under 90L, RNR, RNR] and s=Cold => "Lead Status Not Aligned With Comments" (Rule 3 — 1–4 trailing RNR after interest → target Warm).
G2) c [interested 2BHK, RNR×5] and s=Cold => e:[] — Rule 2 five-RNR drop; Cold aligned.
G3) c [RNR×10 only] and s=Cold => e:[] — Rule 1 pure outbound trail; Cold aligned.
G4) c has "enquired by mistake" / "not looking for properties" then RNR, s=Lost => e:[] for status; r → confirm Lost and close the lead.
H) c latest shows clear purchase interest (site visit / config+budget) and s=Cold with no 5+ trailing RNR => "Lead Status Not Aligned With Comments".
H2) s=Prospect/Qualified, last comment positive budget talk but no site visit confirmed => "Lead Status Not Aligned With Comments" (Rule 4 — target Hot).
H3) s=Prospect/Qualified, last comment confirms site visit => e:[] for status (Rule 5).
I) le contains "Follow-up Missed" and n is set => mention overdue follow-up in o/r and say call/proceed now; do NOT say set a follow-up date; e must NOT include Follow-up Missed.
J) le contains "Estimate Budget Empty" or "Customer Location Empty" => explain in o/r; never emit those labels in e.
K) k=Yes, comments lack facing/size/purpose/timeline detail => "Customer Comment Quality Not Appropriate".

EDGE CASES
- Mixed-language comments are valid; judge meaning, not grammar.
- Boilerplate repeated across leads stays low q.
- Emoji-only / symbol-only comments => q near 0.
- Insufficient data => short o + r asking what to capture next.
- Illegal or harassing calling advice is forbidden in r.
- Budget ranges stay as written; do not normalize currency.
- CRM labels Hot/Warm/Cold/NI/CNP/Busy need comment evidence, not the label alone; apply STATUS recency Rules 1–5.
- "Just enquiry/browsing" with no next step is usually i=0.
- Callback-after-salary with active locality search can support i=1.
- For Comments history arrays, status uses recency Rules 1–5 (5+ trailing RNR decays interest; pure RNR → Cold/Lost aligned); q and i use THIS call's latest comment with full-history context.

CACHE STABILITY PAD (identical every request — do not vary)
LeadLens keeps this handbook byte-stable so automatic prompt caching can reuse the prefix across batches in a run and across nearby reruns. Static instructions stay first; configured run checks follow; unique lead payloads stay last. Routing uses a stable prompt_cache_key derived from model + rules. Parallel workers must warm this prefix once before fanning out. Treat the following checklist as fixed operating procedure: verify id echo, apply q hard caps, distinguish rq placeholder-empty vs wrong, gate rq/comment-quality on connected, apply STATUS recency Rules 1–5 (pure RNR and 5+ trailing RNR aligned for Cold; put mismatches in e not freeform Error lines), explain le local errors in o/r without copying them into e, never recommend set-follow-up when n is set, keep outputs compact, never invent sibling calls, never merge two ids, never invent error labels outside the allowed types, never emit Follow-up Missed, never emit Estimate Budget Empty, never emit Customer Location Empty, never emit Analysis Parameter Empty, never emit TAT labels, never emit severity, never wrap JSON in fences, never discuss pricing or tokens, never mention cache mechanics in o/r. Repeatable discipline improves audit consistency across telecalling QA shifts, projects, and batch sizes while preserving privacy of customer records inside the browser-only LeadLens workflow.

This handbook is identical across batches for prompt caching.`;

const norm=value=>String(value??"").trim().toLowerCase().replace(/[_-]+/g," ").replace(/\s+/g," ");
const clean=value=>["","nan","none","nat","undefined","null"].includes(norm(value))?"":String(value).trim();
/** Map model-returned id (often shortened) back to sent leadId. */
export function resolveAuditResultId(returnedId,sentLeadIds){
  const ret=clean(returnedId);
  if(!ret)return null;
  const sent=(sentLeadIds||[]).map(id=>String(id||"")).filter(Boolean);
  for(const id of sent){
    if(clean(id)===ret)return id;
  }
  const tailMatch=sent.filter(id=>clean(id).split("|").pop()?.trim()===ret);
  if(tailMatch.length===1)return tailMatch[0];
  const suffixMatch=sent.filter(id=>clean(id).endsWith(ret));
  if(suffixMatch.length===1)return suffixMatch[0];
  return null;
}
/** Build id→result map; tolerates shortened ids from the model. */
function buildAuditResultMap(batch,result){
  const sentIds=batch.map(lead=>String(lead.leadId??""));
  const byId=new Map();
  const claimed=new Set();
  for(const item of result||[]){
    const pool=sentIds.filter(id=>!claimed.has(clean(id)));
    const resolved=resolveAuditResultId(item?.id,pool);
    if(!resolved)continue;
    claimed.add(clean(resolved));
    byId.set(clean(resolved),{...item,id:resolved});
  }
  return byId;
}
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
  while(used.has(id)||["leadId","groupId","staticValues","auditContext","localErrors","deterministicErrors","rowIndex","updateDate","nextDate","overdue"].includes(id)){
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
      if(seedFresh&&(def.id==="callDate"||def.id==="overdue")){
        const row=out.find(field=>field.id===def.id);
        if(row)row.label=def.label;
      }
      continue;
    }
    out.push(clone(def));
    used.add(def.id);
    if(def.id==="overdue"){
      const nextIdx=out.findIndex(field=>field.id==="next");
      const overdueIdx=out.length-1;
      if(nextIdx>=0&&overdueIdx!==nextIdx+1){
        const [overdueRow]=out.splice(overdueIdx,1);
        out.splice(nextIdx+1,0,overdueRow);
      }
    }
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
  const dropFields=new Set(["tat error","tat","fresh call tat","first talk sla","follow up missed","empty fields when connected"]);
  const byField=new Map();
  for(const rule of saved){
    const rawField=clean(rule.field);
    const field=renamedFields[norm(rawField)]||rawField;
    const key=norm(field)||`custom-${byField.size}`;
    if(dropFields.has(key))continue;
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
  for(const leftover of byField.values()){
    const key=norm(leftover.field);
    if(dropFields.has(key)||key==="first talk sla"||key==="fresh call tat")continue;
    merged.push({field:leftover.field||"Custom",instruction:leftover.instruction||"",errors:leftover.errors||""});
  }
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
    const locationAi=merged.aiFields.find(field=>field.id==="location");
    if(locationAi)locationAi.enabled=false;
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

/**
 * Validate an OpenAI key WITHOUT spending tokens by listing models (a free GET).
 * A 200 confirms the key is real and active; 401/403 mean invalid/unauthorized.
 * OpenAI does not expose a plain balance endpoint, so an insufficient-quota state
 * only surfaces at audit time — this still catches the common "bad/expired key" case.
 */
export async function validateApiKey(key,signal){
  const trimmed=String(key||"").trim();
  if(!trimmed)return{ok:false,reason:"empty",message:"Enter an OpenAI API key."};
  const useProxy=trimmed===SERVER_API_KEY;
  if(!useProxy&&!/^sk-[A-Za-z0-9_-]{20,}$/.test(trimmed))return{ok:false,reason:"format",message:"That does not look like an OpenAI API key (it should start with \"sk-\")."};
  try{
    const response=await fetch(useProxy?"/api/openai/models":"https://api.openai.com/v1/models",{
      method:"GET",
      credentials:useProxy?"same-origin":"omit",
      headers:useProxy?{Accept:"application/json"}:{"Authorization":`Bearer ${trimmed}`},
      signal
    });
    if(response.ok)return{ok:true,message:useProxy?"Server OpenAI key is valid and active.":"Key is valid and active."};
    let detail="";
    try{detail=(await response.json())?.error?.message||"";}catch{/* ignore */}
    if(response.status===401)return{ok:false,reason:"unauthorized",status:401,message:detail||"Invalid API key — OpenAI rejected it (401)."};
    if(response.status===403)return{ok:false,reason:"forbidden",status:403,message:detail||"This key is not authorized (403)."};
    if(response.status===429)return{ok:false,reason:"quota",status:429,message:detail||"Key reached a rate/quota limit (429). It may have no remaining balance."};
    if(response.status===503)return{ok:false,reason:"empty",status:503,message:detail||"Server OpenAI key is not configured."};
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
function calendarDateOnly(value){
  if(value instanceof Date&&!Number.isNaN(value.valueOf())){
    return new Date(value.getFullYear(),value.getMonth(),value.getDate());
  }
  return parseDate(value);
}
/** Integer overdue days: (today − nextDay) / 86400000. Missing next → "". Today → 0. */
function overdueDays(next){
  const nextDay=calendarDateOnly(next);
  if(!nextDay)return "";
  const today=new Date();today.setHours(0,0,0,0);
  return Math.round((today-nextDay)/86400000);
}
/** Chronology stamp for a call (update datetime preferred, then date, then rowIndex). */
function callChronoStamp(record){
  const t=record?.updateAt?.valueOf?.()??record?.updateDate?.valueOf?.()??null;
  if(t!=null&&Number.isFinite(t))return t;
  return Number(record?.rowIndex)||0;
}
/**
 * Follow-up is fulfilled when any LATER call on the same lead has Lead Update on the
 * same calendar day as (or on/before) this call's Next Followup calendar date.
 */
function followUpFulfilledByLaterCall(call,leadRecords){
  const nextDay=calendarDateOnly(call?.nextDate||call?.nextAt||call?.next);
  if(!nextDay)return false;
  const callTs=callChronoStamp(call);
  const callRow=Number(call?.rowIndex)||0;
  for(const later of leadRecords||[]){
    if(!later||later===call)continue;
    const laterTs=callChronoStamp(later);
    if(laterTs<callTs)continue;
    if(laterTs===callTs&&(Number(later.rowIndex)||0)<=callRow)continue;
    const laterUpdateDay=calendarDateOnly(later.updateAt||later.updateDate||later.update);
    if(!laterUpdateDay)continue;
    if(laterUpdateDay.getTime()<=nextDay.getTime())return true;
  }
  return false;
}
/** Overdue for a call, with sibling fulfillment → 0 (and no Follow-up Missed). */
function overdueDaysForCall(call,leadRecords){
  const base=overdueDays(call?.nextDate||call?.nextAt||call?.next);
  if(base==="")return "";
  if(followUpFulfilledByLaterCall(call,leadRecords))return 0;
  return base;
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
  // Negation / drop-off — not purchase interest (avoid "doesn't want", "beyond budget" FPs).
  if(/\b(not interested|\bni\b|don't|dont|doesn'?t|do not|no need|stop calling|beyond budget|too (high|expensive)|not looking|plan dropped)\b/.test(n))return false;
  // Bare CRM crumbs (visited/SV alone) are not positive interest — quality caps already treat them as q<=2.
  if(/^(visited|visit|sv|sv done|site visit|site visited)$/.test(n))return false;
  // Clear interest only — never bare "want"/"budget" alone (those fire on negative notes).
  return/\b(interested|site visit|sv done|looking for|call me|send(ing)? details|shortlist|come(s)? for visit)\b/.test(n)
    ||/\bbook(ing|ed)?\b/.test(n)
    ||/\bwants?\s+(to\s+)?(visit|see|buy|book|come)\b/.test(n)
    ||(/\b(2bhk|3bhk)\b/.test(n)&&/\b(interested|looking|need|visit|want)\b/.test(n))
    ||(/\bvisit(ed)?\b/.test(n)&&n.split(/\s+/).length>=3);
}
function allCommentsRnrLike(comments){
  const list=Array.isArray(comments)?comments.map(clean).filter(Boolean):[clean(comments)].filter(Boolean);
  return list.length>0&&list.every(isRnrLikeComment);
}
function commentEntries(comments){
  return Array.isArray(comments)?comments.map(clean).filter(Boolean):[clean(comments)].filter(Boolean);
}
function leadStatusRank(status){
  const n=norm(status);
  const hit=LEAD_STATUS_LADDER.find(item=>norm(item.label)===n);
  return hit?hit.rank:0;
}
function isClosedLeadStatus(status){
  const n=norm(status);
  return n==="lost"||n==="beyond budget";
}
function displayOverdueValue(status,overdue){
  if(isClosedLeadStatus(status))return "-";
  return overdue;
}
function trailingRnrStreak(comments){
  const list=commentEntries(comments);
  let streak=0;
  for(let i=list.length-1;i>=0;i--){
    if(isRnrLikeComment(list[i]))streak++;
    else break;
  }
  return streak;
}
function isPassiveCoolDownComment(value){
  const n=norm(value);
  if(!n||isRnrLikeComment(n))return false;
  if(/\b(not interested|\bni\b|plan dropped|stop calling|do not call|don't call|dont call)\b/.test(n))return true;
  if(/\bif interested\b/.test(n)&&/\b(call|callback|call back)\b/.test(n))return true;
  if(/\bwill call (back )?if interested\b/.test(n))return true;
  if(/\b(they|he|she|customer) will call (back|us|me)?\b/.test(n)&&/\bif interested\b/.test(n))return true;
  return false;
}
/** ACTIVE rejection only — passive callback-only notes do not cancel prior interest. */
function hasActiveRejectionComment(value){
  const n=norm(value);
  if(!n||isRnrLikeComment(n))return false;
  if(/\b(not interested|stop calling|do not call|don't call|dont call)\b/.test(n))return true;
  if(/\b(not looking|plan dropped|wrong enquiry|enquired by mistake)\b/.test(n))return true;
  if(/\bnot looking for (propert|homes?|flats?|plots?|villas?|real estate)/.test(n))return true;
  if(/\benquir(ed|y|ies).{0,40}(by )?mistake\b/.test(n))return true;
  return false;
}
function hasBuyingSignalComment(value){
  if(isStrongPositiveComment(value))return true;
  const n=norm(value);
  if(!n||isRnrLikeComment(n))return false;
  return/\b(budget|2bhk|3bhk|\d+\s*bhk|bedroom|flat|villa|plot|apartment|site visit|visit on|coming saturday|\bsv\b|under \d+l|under \d+\s*cr|\d+l\b|lakh|lac|\bcr\b|loan eligible|whitefield|anekal|electronic city|sarjapur|investment|possession|facing)\b/.test(n);
}
function hasCumulativeBuyingSignals(comments){
  const list=commentEntries(comments);
  if(!list.length)return false;
  const streak=trailingRnrStreak(comments);
  if(streak>=8){
    const before=list.slice(0,list.length-streak);
    if(!before.some(hasBuyingSignalComment))return false;
  }
  const lastMeaningful=latestMeaningfulComment(comments);
  if(lastMeaningful&&hasActiveRejectionComment(lastMeaningful))return false;
  return list.some(hasBuyingSignalComment);
}
/** Explicit dead / NI / mistake-enquiry signals that justify Lost (or Cold). */
function isDeadNiComment(value){
  const n=norm(value);
  if(!n)return false;
  if(isPassiveCoolDownComment(n))return true;
  if(/\b(not looking|not interested|\bni\b|plan dropped|wrong enquiry|wrong inquiry|junk lead)\b/.test(n))return true;
  if(/\bnot looking for (propert|homes?|flats?|plots?|villas?|real estate)/.test(n))return true;
  if(/\benquir(ed|y|ies).{0,40}(by )?mistake\b/.test(n))return true;
  if(/\b(by )?mistake\b/.test(n)&&/\b(enquir|not looking|not interested)\b/.test(n))return true;
  if(/\bsays? not looking\b/.test(n))return true;
  if(/\bno longer (looking|interested)\b/.test(n))return true;
  return false;
}
function latestMeaningfulComment(comments){
  const list=commentEntries(comments);
  for(let i=list.length-1;i>=0;i--){
    if(!isRnrLikeComment(list[i]))return list[i];
  }
  return "";
}
/** Early interest then passive NI / long trailing RNR after cool-down. */
function hasCooledTrajectory(comments){
  const list=commentEntries(comments);
  if(list.length<2)return false;
  const latestMeaningful=latestMeaningfulComment(comments);
  if(latestMeaningful&&(isPassiveCoolDownComment(latestMeaningful)||isDeadNiComment(latestMeaningful)))return true;
  const streak=trailingRnrStreak(comments);
  if(streak<5)return false;
  const earlier=list.slice(0,list.length-streak);
  if(earlier.some(c=>isPassiveCoolDownComment(c)||isDeadNiComment(c)))return true;
  // Prior real interest (not crumbs) then long unanswered streak ⇒ cooled
  if(earlier.some(c=>isStrongPositiveComment(c)||(!isRnrLikeComment(c)&&c.split(/\s+/).length>=6)))return true;
  return false;
}
/** Lost/Cold/Beyond Budget is aligned — all-RNR, explicit NI/dead, or cool-down then RNR. */
function hasDeadLostAlignedTrajectory(comments){
  const list=commentEntries(comments);
  if(!list.length)return false;
  if(allCommentsRnrLike(comments))return true;
  if(list.some(isDeadNiComment))return true;
  if(hasCooledTrajectory(comments)&&trailingRnrStreak(comments)>=3)return true;
  if(trailingRnrStreak(comments)>=8)return true;
  return false;
}
function shouldCloseAsLost(comments){
  const list=commentEntries(comments);
  if(!list.length)return false;
  if(list.some(isDeadNiComment))return true;
  if(allCommentsRnrLike(comments)&&list.length>=8)return true;
  if(trailingRnrStreak(comments)>=8)return true;
  if(hasCooledTrajectory(comments)&&trailingRnrStreak(comments)>=5)return true;
  return false;
}
function hasNextFollowupDate(row){
  return Boolean(clean(row?.next)||clean(row?.nextDate)||clean(row?.n));
}
/** Local floor: Cold/Beyond Budget/Lost vs recency Rules 1–3 (matches STATUS_HISTORY_PROMPT). */
function statusHardRuleMismatch(status,comments){
  const rank=leadStatusRank(status);
  if(rank>3)return false;
  // Rule 1: pure outbound RNR trail → Cold/Lost aligned
  if(allCommentsRnrLike(comments))return false;
  const streak=trailingRnrStreak(comments);
  // Rule 2: early interest + last 5+ RNR → Cold aligned (decayed)
  if(streak>=5)return false;
  // Rule 3 / active interest: streak 0–4 with buying signals still live → too cold
  return hasCumulativeBuyingSignals(comments);
}
/** Local ceiling: strip status error when Rule 1/2 or dead/NI trail says Cold/Lost is aligned. */
function statusHardRuleAligned(status,comments){
  const rank=leadStatusRank(status);
  if(rank>3)return false;
  if(allCommentsRnrLike(comments))return true;
  const streak=trailingRnrStreak(comments);
  if(streak>=5)return true;
  if(!hasDeadLostAlignedTrajectory(comments))return false;
  return !hasCumulativeBuyingSignals(comments);
}
export function indianMobile(value){let digits=clean(value).replace(/\.0$/,"").replace(/\D/g,"");if(digits.length===12&&digits.startsWith("91"))digits=digits.slice(2);if(digits.length===11&&digits.startsWith("0"))digits=digits.slice(1);return /^[6-9]\d{9}$/.test(digits)?digits:"";}
function fieldColumns(headers,fields){const normalized=headers.map(header=>({header,key:norm(header)}));return Object.fromEntries(fields.filter(field=>field.required||field.enabled!==false).map(field=>{const match=normalized.find(item=>list(field.aliases).includes(item.key));return[field.id,match?.header||""];}));}
function correctedAiLocation(project,location){const exceptions=new Set(["guru punvaanii eureka|bidadi","guru punvaanii ernika|anekal","guru punvaanii eka|anekal","guru punvaanii elegance|bheemenahalli"]);return exceptions.has(`${norm(project)}|${norm(location)}`)?"":location;}
function connectedFromParameter(parameter,settings){const value=norm(parameter);if(!value)return"";if(list(settings.yesValues).includes(value)||value==="yes")return"Yes";if(list(settings.noValues).includes(value)||value==="no")return"No";return"";}
function localErrors(call,aiLocation,leadRecords){
  const errors=[];
  const overdue=overdueDaysForCall(call,leadRecords);
  if(typeof overdue==="number"&&overdue>0)errors.push(FOLLOWUP_MISSED_ERROR);
  if(isBlankish(call.parameter))errors.push(EMPTY_PARAMETER);
  if(call.connected==="Yes"){
    if(isBlankish(aiLocation))errors.push(EMPTY_LOCATION);
    if(clean(call.requirement)==="")errors.push(EMPTY_REQUIREMENT);
    if(clean(call.budget)==="")errors.push(EMPTY_BUDGET);
  }
  return{errors,overdue};
}
function contextValue(id,record,aiLocation){if(id==="connected")return record.connected;if(id==="next")return dateText(record.nextDate||record.next);if(id==="location")return aiLocation;return record[id]||"";}
function callSnapshot(record){
  return{
    d:dateText(record.updateAt||record.updateDate||record.update),
    s:record.status||"",
    c:record.comments||"",
    n:dateText(record.nextDate||record.next),
    rq:record.requirement||"",
    b:record.budget||"",
    k:record.connected||""
  };
}
/** CRM "Prospect" is sent to the model as "Qualified" — Excel/export keep the original label. */
export function statusForAi(value){
  const text=clean(value);
  if(!text)return text;
  return norm(text)==="prospect"?"Qualified":text;
}
/** Build AI payload from leads; maps status s (and day[].s) through statusForAi. */
export function buildAiModelInput(leads){
  return(leads||[]).map(lead=>{
    const ctx={id:lead.leadId,...lead.auditContext};
    if(ctx.s!==undefined)ctx.s=statusForAi(ctx.s);
    if(Array.isArray(ctx.day)){
      ctx.day=ctx.day.map(snap=>snap&&typeof snap==="object"?{...snap,s:statusForAi(snap.s)}:snap);
    }
    return ctx;
  });
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
    fillDownWithinGroup(rawRecords,"source");
    fillDownWithinGroup(rawRecords,"status",{backward:false});
    for(const record of rawRecords)record.connected=connectedFromParameter(record.parameter,settings);
    const before=rawRecords.length;
    // Near-dupe filter first; only latest-day rows go to AI/export. Calls metric = Excel rows.
    const records=dedupeNearDuplicateCalls(rawRecords,settings.inputFields);
    dedupedRows+=Math.max(0,before-records.length);
    // Lead-level Connected: ANY Analysis Parameter Yes across history → Yes; else No.
    const leadConnected=records.some(record=>connectedFromParameter(record.parameter,settings)==="Yes")?"Yes":"No";
    for(const record of records)record.connected=leadConnected;
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
    const commentHistory=records.map(record=>record.comments||"");
    const daySnapshots=dayCalls.map(callSnapshot);

    // One audit row per lead: latest call on the latest calendar day only.
    // Earlier same-day siblings remain in auditContext.day for AI context.
    const call=dayCalls.at(-1);
    const callIndex=dayCalls.length-1;
    if(call){
      const aiLocation=correctedAiLocation(call.project,call.location);
      const leadUpdateDate=dateText(call.updateAt||call.updateDate||call.update);
      const local=localErrors(call,aiLocation,records);
      const staticValues={
        project:call.project,
        mobile:call.mobile,
        registration:dateTimeText(registrationAt)||registration,
        telecaller:clean(call.telecaller)||telecaller,
        status:call.status,
        comments:call.comments,
        next:dateTimeText(call.nextAt)||dateText(call.nextDate||call.next),
        overdue:displayOverdueValue(call.status,local.overdue),
        callDate:dateTimeText(call.updateAt)||leadUpdateDate,
        update:dateTimeText(call.updateAt)||leadUpdateDate,
        totalFollowups:records.length,
        dayCallCount:dayCalls.length,
        dayCallIndex:callIndex+1,
        connected:leadConnected,
        location:call.location,
        requirement:call.requirement,
        parameter:call.parameter,
        budget:call.budget,
        source:call.source||""
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
        else if(field.id==="next")auditContext[key]=dateText(call.nextDate||call.nextAt||call.next);
        else auditContext[key]=field.history
          ?records.map(record=>contextValue(field.id,record,correctedAiLocation(record.project,record.location)))
          :contextValue(field.id,call,aiLocation);
      }
      auditContext.u=dateTimeText(call.updateAt)||leadUpdateDate||"";
      auditContext.le=local.errors;
      if(clean(call.requirement)==="")delete auditContext.rq;
      if(clean(call.budget)==="")delete auditContext.b;
      if(daySnapshots.length>1)auditContext.day=daySnapshots;
      leads.push({
        leadId:`${groupId}#${call.rowIndex}`,
        groupId,
        staticValues,
        auditContext,
        localErrors:local.errors
      });
    }
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
    unknownHeaders,
    looksAudited:sheetLooksAudited(selected.headers||[])
  };
}

function sheetLooksAudited(headers){
  const keys=(headers||[]).map(header=>norm(header));
  return keys.some(key=>
    key.includes("comment quality")||
    key==="error type(s)"||key==="error types"||key.includes("error type")||
    key.includes("error severity")||
    key.includes("buying intent")||
    key.includes("ai observation")||
    key.includes("ai recommendation")
  );
}

/** Match input + output Excel headers (labels / aliases) for audited workbook import. */
function auditImportFields(settings){
  const fields=[];
  const seen=new Set();
  for(const field of settings.inputFields||[]){
    if(!(field.required||field.enabled!==false))continue;
    seen.add(field.id);
    fields.push({id:field.id,label:field.label,aliases:field.aliases||field.label,required:Boolean(field.required),enabled:true});
  }
  for(const field of settings.outputFields||[]){
    if(field.enabled===false||seen.has(field.id))continue;
    seen.add(field.id);
    fields.push({id:field.id,label:field.label,aliases:`${field.label}, ${field.id}`,required:false,enabled:true});
  }
  // Extra aliases for LeadLens download headers / common variants.
  const extras={
    callDate:"lead update date, call date, update date",
    commentQuality:"comment quality score, comment quality, q",
    errorTypes:"error type(s), error types, errors, e",
    errorSeverity:"error severity, severity",
    buyingIntent:"buying intent, intent, i",
    observation:"ai observation, observation, o",
    recommendation:"ai recommendation, recommendation, r",
    telecaller:"telecaller name, tele caller name, agent name",
    overdue:"overdue, overdue days"
  };
  for(const field of fields){
    if(extras[field.id])field.aliases=`${field.aliases}, ${extras[field.id]}`;
  }
  return fields;
}

/**
 * Parse a LeadLens (or compatible) Audit Excel into result rows — no AI.
 * Requires Mobile + Project and at least one audit column (Comment Quality / Error Type(s) / Severity).
 */
export function parseAuditedWorkbook(arrayBuffer,rawSettings=DEFAULT_SETTINGS){
  if(!window.XLSX)throw new Error("Excel reader failed to load. Check the internet connection and reload.");
  const settings=normalizeSettings(rawSettings);
  const workbook=XLSX.read(arrayBuffer,{type:"array",cellDates:true});
  const importFields=auditImportFields(settings);
  const candidates=workbook.SheetNames.map(name=>{
    const rows=XLSX.utils.sheet_to_json(workbook.Sheets[name],{defval:"",raw:true});
    const headers=rows.length?Object.keys(rows[0]):[];
    const columns=fieldColumns(headers,importFields);
    const auditHits=["commentQuality","errorTypes","errorSeverity","buyingIntent","observation","recommendation"]
      .filter(id=>Boolean(columns[id])).length;
    const score=Object.values(columns).filter(Boolean).length+auditHits*3;
    return{name,rows,headers,columns,auditHits,score};
  }).sort((a,b)=>b.score-a.score);
  const selected=candidates[0];
  if(!selected?.columns.mobile||!selected?.columns.project){
    throw new Error("Excel Audit needs Mobile Number and Project Name columns (same as LeadLens audit download).");
  }
  if(selected.auditHits<1&&!sheetLooksAudited(selected.headers)){
    throw new Error("This file does not look like an Audit Excel. Use Excel RAW to audit a CRM export, or upload a LeadLens audit download.");
  }
  const results=[];
  let lastMobile="",lastProject="";
  for(let index=0;index<selected.rows.length;index++){
    const row=selected.rows[index];
    const rawMobile=clean(row[selected.columns.mobile]);
    const rawProject=clean(row[selected.columns.project]);
    const normalizedMobile=rawMobile?indianMobile(rawMobile)||rawMobile:"";
    if(rawMobile){
      if(!normalizedMobile)continue;
      lastMobile=normalizedMobile;
    }
    if(rawProject)lastProject=rawProject;
    if(!lastMobile||!lastProject)continue;
    const mappedEmpty=importFields.every(field=>{
      const header=selected.columns[field.id];
      return!header||!clean(row[header]);
    });
    if(mappedEmpty)continue;
    const result={mobile:lastMobile,project:lastProject};
    for(const field of importFields){
      if(field.id==="mobile"||field.id==="project")continue;
      const header=selected.columns[field.id];
      if(!header)continue;
      let value=row[header];
      if(field.id==="callDate"||field.id==="registration"||field.id==="next"||field.id==="update"){
        const dt=parseDateTime(value);
        value=dt?dateTimeText(dt):clean(value);
      }else if(field.id==="commentQuality"){
        const q=Number(value);
        value=Number.isFinite(q)?Math.max(0,Math.min(10,Math.round(q))):0;
      }else if(field.id==="overdue"){
        if(value===""||value==null)value="";
        else{
          const n=Number(value);
          value=Number.isFinite(n)?Math.round(n):"";
        }
      }else if(field.id==="buyingIntent"){
        const n=norm(value);
        value=(n==="yes"||n==="1"||n==="true")?"Yes":"No";
      }else{
        value=clean(value);
      }
      result[field.id]=value;
    }
    if(result.commentQuality===undefined)result.commentQuality=0;
    const importedErrors=ERROR_TYPES.filter(label=>String(result.errorTypes||"").includes(label));
    result.errorTypes=importedErrors.length?importedErrors.join(", "):"None";
    result.errorSeverity=importedErrors.length?(importedErrors.some(error=>HIGH_SEVERITY_ERRORS.has(error))?"HIGH":"MEDIUM"):"NONE";
    if(!result.buyingIntent)result.buyingIntent="No";
    if(result.observation===undefined)result.observation="";
    if(result.recommendation===undefined)result.recommendation="";
    // Overdue recomputed below with sibling fulfillment across the lead.
    results.push(result);
  }
  // Recalculate overdue using later-call fulfillment; apply Lost/Beyond Budget display "-".
  const byLead=new Map();
  for(const row of results){
    const key=`${String(row.project||"").toLowerCase()}\u0001${String(row.mobile||"").toLowerCase()}`;
    if(!byLead.has(key))byLead.set(key,[]);
    byLead.get(key).push(row);
  }
  for(const rows of byLead.values()){
    const records=rows.map((row,idx)=>{
      const updateAt=parseDateTime(row.callDate||row.update);
      const updateDate=updateAt?new Date(updateAt.getFullYear(),updateAt.getMonth(),updateAt.getDate()):parseDate(row.callDate||row.update);
      const nextAt=parseDateTime(row.next);
      const nextDate=nextAt?new Date(nextAt.getFullYear(),nextAt.getMonth(),nextAt.getDate()):parseDate(row.next);
      return{row,rowIndex:idx,updateAt,updateDate,nextAt,nextDate,next:row.next,update:row.callDate||row.update};
    }).sort((a,b)=>callChronoStamp(a)-callChronoStamp(b)||a.rowIndex-b.rowIndex);
    records.forEach((rec,i)=>{rec.rowIndex=i;});
    for(const rec of records){
      const overdue=overdueDaysForCall(rec,records);
      rec.row.overdue=displayOverdueValue(rec.row.status,overdue);
      if(overdue===0||overdue===""||isClosedLeadStatus(rec.row.status)){
        const labels=String(rec.row.errorTypes||"").split(/\s*,\s*/).map(s=>s.trim()).filter(Boolean)
          .filter(label=>label!=="None"&&label!==FOLLOWUP_MISSED_ERROR);
        rec.row.errorTypes=labels.length?labels.join(", "):"None";
        rec.row.errorSeverity=labels.length?(labels.some(error=>HIGH_SEVERITY_ERRORS.has(error))?"HIGH":"MEDIUM"):"NONE";
      }
    }
  }
  if(!results.length)throw new Error("No audited rows could be read from this Excel.");
  const leadKeys=new Set(results.map(row=>`${row.project||""} | ${row.mobile||""}`));
  const splitPreview=splitResultsByTelecaller(results);
  const matchedHeaderKeys=new Set(Object.values(selected.columns).filter(Boolean).map(header=>norm(header)));
  const unknownHeaders=(selected.headers||[]).filter(header=>clean(header)&&!matchedHeaderKeys.has(norm(header)));
  const missingAudit=["commentQuality","errorTypes","errorSeverity"].filter(id=>!selected.columns[id]).map(id=>{
    const field=importFields.find(item=>item.id===id);
    return field?.label||id;
  });
  return{
    sheetName:selected.name,
    results,
    leads:[],
    rowCount:selected.rows.length,
    leadCount:leadKeys.size,
    callCount:results.length,
    latestDayCalls:results.length,
    invalidRows:0,
    dedupedRows:0,
    expectedColumns:[],
    missingColumns:missingAudit,
    unknownHeaders,
    splitPreview,
    looksAudited:true,
    sourceFormat:"audit"
  };
}

function buildPrompt(settings){
  const errorLegend=[...AI_ALLOWED_ERRORS].join(" | ");
  const rules=settings.rules.filter(rule=>clean(rule.instruction)).map((rule,index)=>{
    const errors=splitErrorList(rule.errors);
    return`${index+1}. ${clean(rule.field)||"check"}: ${clean(rule.instruction)}${errors.length?` errors:${errors.join(" | ")}`:""}`;
  }).join("\n");
  const extra=clean(settings.additionalInstructions);
  return `${CACHE_HANDBOOK}\n\nALLOWED ERROR TYPES: ${errorLegend}\n\nRUN CHECKS:\n${rules||"none"}${extra?`\n\nEXTRA:\n${extra}`:""}`;
}
export function promptCacheKey(settings){
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

export const AUDIT_RESPONSE_SCHEMA={
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
const responseSchema=AUDIT_RESPONSE_SCHEMA;

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
function joinNatural(items){
  if(!items.length)return "";
  if(items.length===1)return items[0];
  if(items.length===2)return `${items[0]} and ${items[1]}`;
  return `${items.slice(0,-1).join(", ")}, and ${items[items.length-1]}`;
}
function fallbackObservation(row,errors,q){
  const connected=norm(row.connected);
  const thin=Number(q)<=3;
  const has=label=>errors.includes(label);
  const deadAligned=hasDeadLostAlignedTrajectory(row.comments);
  const closedOk=isClosedLeadStatus(row.status)||norm(row.status)==="cold";
  const gaps=[];
  if(has(EMPTY_LOCATION))gaps.push("preferred location");
  if(has(EMPTY_BUDGET))gaps.push("budget");
  if(has(EMPTY_REQUIREMENT))gaps.push("customer requirement");
  const issues=[];
  if(has(STATUS_HISTORY_ERROR)){
    if(hasCumulativeBuyingSignals(row.comments)&&leadStatusRank(row.status)<=3)issues.push("comments show buying interest but the status is too cold");
    else issues.push("the lead status does not match how the conversation went");
  }
  if(has(FOLLOWUP_MISSED_ERROR))issues.push("the promised follow-up date is already past");
  if(has(WRONG_REQUIREMENT))issues.push("the requirement field holds call jargon instead of a real need");
  if(has(COMMENT_QUALITY_ERROR))issues.push("the comments miss requirement detail like facing, size, purpose, or timeline");
  if(gaps.length)issues.push(`the customer's ${joinNatural(gaps)} ${gaps.length>1?"were":"was"} not captured on this call`);
  if(has(EMPTY_PARAMETER))issues.push("the analysis parameter was left blank");
  let text="";
  // Lost/Cold/Beyond Budget + dead/NI/RNR trajectory is aligned — never claim status is unsupported.
  if(closedOk&&deadAligned&&!has(STATUS_HISTORY_ERROR)){
    const other=issues.filter(Boolean);
    if(other.length){
      text=`Lost/Cold fits the dead or unanswered trail; separately, ${joinNatural(other)}.`;
    }else if(commentEntries(row.comments).some(isDeadNiComment)){
      text="Comments show the customer is not looking or enquired by mistake, so Lost status is appropriate.";
    }else{
      text="The trail is unanswered RNR after the lead went cold, so Lost or Cold status is appropriate.";
    }
  }else if(has(STATUS_HISTORY_ERROR)&&hasCumulativeBuyingSignals(row.comments)&&leadStatusRank(row.status)<=3){
    text="Comments show buying interest, but the lead status is Cold, Beyond Budget, or Lost — step status up to match.";
  }else if(connected==="yes"&&thin&&issues.length){
    text=`The call connected, but the note is thin and ${joinNatural(issues)}.`;
  }else if(connected==="yes"&&thin){
    text="The call connected, but the note is thin and does not show a real telecaller–customer conversation.";
  }else if(connected==="yes"&&issues.length){
    text=`The call connected, yet ${joinNatural(issues)}.`;
  }else if(connected==="no"&&has(STATUS_HISTORY_ERROR)&&issues.length){
    text=`The call never connected, and ${joinNatural(issues)}.`;
  }else if(connected==="no"&&thin){
    // All-RNR / unanswered thin notes with Cold (or no status error) are fine — do not attack Cold.
    text="The call never connected, and the note shows little more than an unanswered attempt with no customer detail.";
  }else if(issues.length){
    const body=joinNatural(issues);
    text=body.charAt(0).toUpperCase()+body.slice(1)+".";
  }else if(thin){
    text="The note lacks a real telecaller–customer conversation and needs clearer detail on need and next step.";
  }else{
    text="Review note quality and field completeness for this call before the next follow-up.";
  }
  if(!/[.!?]$/.test(text))text+=".";
  return clipWords(text,28);
}
function fallbackRecommendation(row,errors,q){
  if(isClosedLeadStatus(row.status)&&hasDeadLostAlignedTrajectory(row.comments)){
    return clipWords("Confirm Lead Status as Lost and close the lead — the customer is not looking or the trail went dead. Do not keep chasing.",40);
  }
  if(shouldCloseAsLost(row.comments)){
    return clipWords("Change Lead Status to Lost and close this lead — clear NI/dead signal or long unanswered RNR. Do not keep chasing generic follow-ups.",40);
  }
  if(errors.includes(STATUS_HISTORY_ERROR)&&hasCumulativeBuyingSignals(row.comments)&&leadStatusRank(row.status)<=3){
    return clipWords("Step Lead Status up to Warm or Hot to match the buying signals in comments, then call on any follow-up date already on file.",40);
  }
  const actions=[];
  const nextSet=hasNextFollowupDate(row);
  if(norm(row.connected)==="no"&&!allCommentsRnrLike(row.comments)&&!hasDeadLostAlignedTrajectory(row.comments))actions.push("when the customer picks up, capture need, locality, and budget before closing");
  else if(Number(q)<=4&&norm(row.connected)==="yes")actions.push("rewrite remarks with what the customer said: need, locality, budget, objection, and next step");
  if(errors.includes(STATUS_HISTORY_ERROR))actions.push("align lead status on the Prospect→Lost ladder to cumulative comment intent (1–5 RNR/Busy are neutral)");
  if(errors.includes(WRONG_REQUIREMENT)||errors.includes(EMPTY_REQUIREMENT))actions.push("on the next connected call capture a real requirement (config or area), not RNR or visit jargon");
  if(errors.includes(COMMENT_QUALITY_ERROR))actions.push("on connected calls note facing, size/dimension, investment vs self use, and immediate vs future plan");
  if(errors.includes(EMPTY_LOCATION))actions.push("ask and save the preferred micro-market or location");
  if(errors.includes(EMPTY_BUDGET))actions.push("ask and save a budget band before ending the call");
  if(errors.includes(FOLLOWUP_MISSED_ERROR)){
    if(nextSet)actions.push("call now on the overdue follow-up date and progress the lead from what you learn");
    else actions.push("set a dated next follow-up and call on or before that date");
  }else if(!nextSet&&!actions.length){
    actions.push("lock a dated next follow-up the same day");
  }
  if(errors.includes(EMPTY_PARAMETER))actions.push("set Analysis Parameter from the actual call outcome");
  if(!actions.length)return clipWords(nextSet
    ?"Confirm interest, capture any missing fields, and proceed using the follow-up date already on file."
    :"Confirm interest, capture any missing fields, and lock a dated next action the same day.",40);
  const body=joinNatural(actions);
  return clipWords(`${body.charAt(0).toUpperCase()}${body.slice(1)}.`,40);
}
function finalizeObservation(aiText,row,errors,q){
  // Prefer model prose: only empty or clear comment-echo → local fallback.
  const clipped=clipWords(aiText,28);
  if(!clipped||isCommentEcho(clipped,row.comments))return fallbackObservation(row,errors,q);
  const statusNorm=norm(row.status);
  const coldOk=["cold","beyond budget","lost"].includes(statusNorm);
  const rnrLike=allCommentsRnrLike(row.comments);
  const deadAligned=hasDeadLostAlignedTrajectory(row.comments);
  const buyingSignals=hasCumulativeBuyingSignals(row.comments);
  // Reject wrong Cold/Lost attacks when NI/dead/RNR trail supports closed status and no buying signals remain.
  const attacksClosed=/does not support (a )?(cold|lost|beyond budget)|(?:cold|lost|beyond budget) (status )?(is )?(not |un)?support|vague.{0,80}(cold|lost)|(cold|lost).{0,80}vague|lack.{0,50}(detail|customer).{0,80}(cold|lost)|rnr.{0,50}(does not|don't|dont).{0,20}(cold|lost)|(cold|lost).{0,40}(wrong|incorrect|mismatch|unsupported)/i.test(clipped);
  if(coldOk&&attacksClosed&&!errors.includes(STATUS_HISTORY_ERROR)&&(deadAligned||rnrLike)&&!buyingSignals){
    return fallbackObservation(row,errors,q);
  }
  // Reject claiming short RNR gaps alone cooled an interested lead.
  const shortRnrCooled=/two rnr|2 rnr|trailing rnr.{0,40}(cold|cooled)|rnr.{0,40}(mean|means).{0,20}(cold|cooled)/i.test(clipped);
  if(buyingSignals&&leadStatusRank(row.status)<=3&&shortRnrCooled&&!errors.includes(STATUS_HISTORY_ERROR)){
    return fallbackObservation(row,errors,q);
  }
  return clipped;
}
function finalizeRecommendation(aiText,row,errors,q){
  if((shouldCloseAsLost(row.comments)||(isClosedLeadStatus(row.status)&&hasDeadLostAlignedTrajectory(row.comments)))&&!/\b(close|lost)\b/i.test(String(aiText||""))){
    // #region agent log
    fetch('http://127.0.0.1:7843/ingest/f4ac7d78-fa93-4940-929e-852fd1791883',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6866e6'},body:JSON.stringify({sessionId:'6866e6',runId:'pre-fix',hypothesisId:'E',location:'audit.js:finalizeRecommendation',message:'forced fallback close/lost',data:{status:String(row?.status||''),hasStatusErr:errors.includes(STATUS_HISTORY_ERROR),path:'shouldCloseOrClosed'},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return fallbackRecommendation(row,errors,q);
  }
  // Prefer model prose: empty, comment-echo, tiny, or single vague phrase → fallback.
  const clipped=clipWords(aiText,40);
  const words=clipped.split(/\s+/).filter(Boolean);
  const vague=/^(follow\s*up|call\s*again|update\s*(comments?|remarks?)|try\s*later|connect\s*again)\.?$/i.test(clipped);
  if(!clipped||isCommentEcho(clipped,row.comments)||words.length<10||vague){
    // #region agent log
    fetch('http://127.0.0.1:7843/ingest/f4ac7d78-fa93-4940-929e-852fd1791883',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6866e6'},body:JSON.stringify({sessionId:'6866e6',runId:'pre-fix',hypothesisId:'E',location:'audit.js:finalizeRecommendation',message:'fallback recommendation path',data:{status:String(row?.status||''),hasStatusErr:errors.includes(STATUS_HISTORY_ERROR),reason:!clipped?'empty':isCommentEcho(clipped,row.comments)?'echo':words.length<10?'short':'vague'},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return fallbackRecommendation(row,errors,q);
  }
  const nextSet=hasNextFollowupDate(row);
  const asksSetFollowup=/\bset (a |an |the )?(dated )?(next )?follow[-\s]?up|\bschedule (a )?follow[-\s]?up|\bput (a |an )?follow[-\s]?up date|\block a dated (next )?follow/i.test(clipped);
  if(nextSet&&asksSetFollowup)return fallbackRecommendation(row,errors,q);
  if((shouldCloseAsLost(row.comments)||hasDeadLostAlignedTrajectory(row.comments))&&/capture (customer )?details if|if (the customer |they )?connects?|gather (more )?details/i.test(clipped)){
    return fallbackRecommendation(row,errors,q);
  }
  // Prefer model prose, but drop status-alignment coaching when e lacks the status error.
  if(/\b(status|cold|lost|warm|hot|align|mismatch|prospect|qualified)\b/i.test(clipped)&&!errors.includes(STATUS_HISTORY_ERROR)&&!shouldCloseAsLost(row.comments)){
    // #region agent log
    fetch('http://127.0.0.1:7843/ingest/f4ac7d78-fa93-4940-929e-852fd1791883',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6866e6'},body:JSON.stringify({sessionId:'6866e6',runId:'post-fix',hypothesisId:'C',location:'audit.js:finalizeRecommendation',message:'scrubbed status talk without status error',data:{status:String(row?.status||''),snippet:clipped.slice(0,140)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return fallbackRecommendation(row,errors,q);
  }
  // #region agent log
  if(/\b(status|cold|lost|warm|hot|align|mismatch)\b/i.test(clipped)){
    fetch('http://127.0.0.1:7843/ingest/f4ac7d78-fa93-4940-929e-852fd1791883',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6866e6'},body:JSON.stringify({sessionId:'6866e6',runId:'post-fix',hypothesisId:'C',location:'audit.js:finalizeRecommendation',message:'kept AI recommendation with status talk',data:{status:String(row?.status||''),hasStatusErr:errors.includes(STATUS_HISTORY_ERROR),snippet:clipped.slice(0,140)},timestamp:Date.now()})}).catch(()=>{});
  }
  // #endregion
  return clipped;
}

async function requestAudit(apiKey,settings,leads,signal,log,onUsage){
  const modelInput=buildAiModelInput(leads);
  const auditBody=buildChatCompletionBody(settings.model,{
      temperature:0,
      maxTokens:Math.max(500,leads.length*140),
      prompt_cache_key:promptCacheKey(settings),
      messages:[
        {role:"system",content:buildPrompt(settings)},
        {role:"user",content:`Audit ${leads.length} call(s). Echo each id. c=full history — apply STATUS recency Rules 1–5 (pure RNR or last 5+ RNR with Cold = aligned; 1–4 trailing RNR after interest vs Cold = mismatch in e). le=local errors — explain in o/r, never copy into e. On status MISMATCH you MUST put "Lead Status Not Aligned With Comments" in e (not freeform Error: lines). Judge non-blank rq empty-vs-wrong when k=Yes; comment quality + q; buying intent. Never emit Follow-up Missed, Budget/Location/Parameter Empty, or any TAT label. o (18-28 words): quote facts from c only. r (20-40 words): only coach status changes when that label is in e; Lost+close on ACTIVE NI; never "set a follow-up" when n is set; for overdue n say call/proceed now.\n${JSON.stringify({L:modelInput})}`}
      ],
      response_format:{type:"json_schema",json_schema:{name:"ll_audit",strict:true,schema:responseSchema}}
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

// #region agent log
function agentDebugLog(payload,logFn){
  const entry={sessionId:"6866e6",timestamp:Date.now(),...payload};
  try{
    const key="ll-debug-6866e6";
    const prev=JSON.parse(sessionStorage.getItem(key)||"[]");
    prev.push(entry);
    while(prev.length>300)prev.shift();
    sessionStorage.setItem(key,JSON.stringify(prev));
    if(typeof window!=="undefined")window.__LL_DEBUG_6866E6__=prev;
  }catch{/* ignore */}
  fetch("http://127.0.0.1:7843/ingest/f4ac7d78-fa93-4940-929e-852fd1791883",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"6866e6"},body:JSON.stringify(entry)}).catch(()=>{});
  try{
    const d=payload?.data||{};
    const interesting=d.aiRHasStatusTalk&&!d.finalHasStatus||(Array.isArray(d.rawAiE)&&d.rawAiE.some(t=>/status|aligned/i.test(String(t))))||d.mismatch||d.aligned&&d.beforeHard?.includes?.(STATUS_HISTORY_ERROR);
    if(interesting&&typeof logFn==="function"){
      logFn(`[DBG-status] m=…${d.mobile||"?"} s=${d.status||"?"} rank=${d.statusRank} rawE=${JSON.stringify(d.rawAiE||[])} resolved=${JSON.stringify(d.aiErrors||[])} mismatch=${d.mismatch} aligned=${d.aligned} buy=${d.buyingSignals} finalHasStatus=${d.finalHasStatus} rTalk=${d.aiRHasStatusTalk} r="${String(d.aiRSnippet||"").slice(0,80)}"`, "warn");
    }
  }catch{/* ignore */}
}
// #endregion

export async function auditBatch(apiKey,rawSettings,batch,signal,log,onUsage,requestFn=requestAudit){
  const settings=normalizeSettings(rawSettings);
  const maps=buildErrorMaps(settings);
  const request=typeof requestFn==="function"?requestFn:requestAudit;
  async function requestWithRetry(leads,label){
    let result,lastError;
    let attempt=1;
    while(!result){
      try{result=await request(apiKey,settings,leads,signal,log,onUsage);break;}
      catch(error){
        if(error.name==="AbortError")throw error;
        lastError=error;
        const is429=/OpenAI 429/.test(String(error.message||""));
        if(is429){
          log(`${label}: rate limited (429). Waiting 30s then retrying…`,"warn");
          await new Promise(resolve=>setTimeout(resolve,30000));
          continue;
        }
        log(`${label} attempt ${attempt} failed: ${error.message}`,"error");
        if(attempt>=3)break;
        await new Promise(resolve=>setTimeout(resolve,attempt*1500));
        attempt++;
      }
    }
    if(!result)throw lastError;
    return result;
  }
  const result=await requestWithRetry(batch,"Audit");
  let byId=buildAuditResultMap(batch,result);
  let missing=batch.filter(lead=>!byId.has(clean(lead.leadId)));
  if(missing.length){
    log(`Model omitted ${missing.length} lead(s); retrying only those leads.`,"warn");
    const recovered=await requestWithRetry(missing,"Recovery");
    const recoveryMap=buildAuditResultMap(missing,recovered);
    for(const [key,item] of recoveryMap)byId.set(key,item);
    missing=batch.filter(lead=>!byId.has(clean(lead.leadId)));
  }
  if(missing.length){
    throw new Error(`OpenAI still omitted ${missing.length} lead(s). Saved batches are safe; resume to retry.`);
  }
  const rows=batch.map(lead=>{
    const ai=byId.get(clean(lead.leadId));
    const rawAiE=Array.isArray(ai?.e)?ai.e.map(t=>String(t??"")):[];
    const resolvedPairs=(Array.isArray(ai?.e)?ai.e:[]).map(token=>{
      const resolved=maps.resolve(token);
      return{raw:String(token??""),resolved,allowed:Boolean(resolved&&AI_ALLOWED_ERRORS.has(resolved))};
    });
    const aiErrors=Array.isArray(ai.e)?ai.e.map(token=>maps.resolve(token)).filter(label=>AI_ALLOWED_ERRORS.has(label)):[];
    const connectedYes=lead.staticValues.connected==="Yes";
    const filteredAi=connectedYes?aiErrors:aiErrors.filter(label=>!CONNECTED_ONLY_ERRORS.has(label));
    const localRaw=Array.isArray(lead.localErrors)?lead.localErrors:(Array.isArray(lead.deterministicErrors)?lead.deterministicErrors:[]);
    const local=localRaw.filter(label=>LOCAL_OWNED_ERRORS.has(label));
    const filteredLocal=connectedYes?local:local.filter(label=>!CONNECTED_ONLY_ERRORS.has(label));
    let merged=unique([...filteredLocal,...filteredAi]).filter(label=>ERROR_TYPES.includes(label));
    let errors=merged.includes(EMPTY_REQUIREMENT)?merged.filter(label=>label!==WRONG_REQUIREMENT):merged;
    const comments=Array.isArray(lead.auditContext?.c)?lead.auditContext.c:[lead.staticValues.comments];
    const mismatch=statusHardRuleMismatch(lead.staticValues.status,comments);
    const aligned=statusHardRuleAligned(lead.staticValues.status,comments);
    const beforeHard=[...errors];
    // Local hard-rule floor: Cold/Beyond Budget/Lost + clear buying signals in c → always emit status error.
    if(mismatch){
      errors=unique([...errors,STATUS_HISTORY_ERROR]);
    }
    // Local hard-rule ceiling: Cold/Beyond Budget/Lost + dead/NI/RNR trail, no buying signals → strip false-positive status error.
    if(aligned){
      errors=errors.filter(label=>label!==STATUS_HISTORY_ERROR);
    }
    // #region agent log
    const rText=String(ai?.r??"");
    const statusTalk=/\b(status|cold|lost|warm|hot|prospect|qualified|align|mismatch)\b/i.test(rText);
    agentDebugLog({runId:"pre-fix",hypothesisId:"A-E",location:"audit.js:auditBatch-merge",message:"status error merge path",data:{mobile:String(lead.staticValues?.mobile||"").slice(-4),status:String(lead.staticValues?.status||""),statusRank:leadStatusRank(lead.staticValues?.status),connectedYes,rawAiE,resolvedPairs,aiErrors,beforeHard,mismatch,aligned,buyingSignals:hasCumulativeBuyingSignals(comments),deadAligned:hasDeadLostAlignedTrajectory(comments),finalErrors:errors,finalHasStatus:errors.includes(STATUS_HISTORY_ERROR),aiRHasStatusTalk:statusTalk,aiRSnippet:rText.slice(0,120)}},log);
    // #endregion
    const forceNoIntent=(trailingRnrStreak(comments)>=8&&!hasCumulativeBuyingSignals(comments))
      ||commentEntries(comments).some(hasActiveRejectionComment)
      ||(allCommentsRnrLike(comments)&&commentEntries(comments).length>=8);
    let intent;
    if(forceNoIntent)intent="No";
    else if(ai.i===undefined||ai.i===null||ai.i===""){
      const last=(comments.map(clean).filter(Boolean).at(-1))||lead.staticValues.comments;
      intent=isStrongPositiveComment(last)?"Yes":"No";
    }else{
      intent=Number(ai.i)===1||clean(ai.i)==="1"||norm(ai.i)==="yes"?"Yes":"No";
    }
    const q=clampCommentQuality(ai.q,lead.staticValues.comments);
    const overdueRaw=lead.staticValues.overdue!==undefined&&lead.staticValues.overdue!==null&&lead.staticValues.overdue!==""
      ?(lead.staticValues.overdue==="-"?0:lead.staticValues.overdue)
      :overdueDays(lead.staticValues.next);
    const overdue=displayOverdueValue(lead.staticValues.status,overdueRaw);
    // Drop Follow-up Missed if overdue was fulfilled (0) or closed-status display.
    if((overdueRaw===0||overdueRaw===""||isClosedLeadStatus(lead.staticValues.status))&&errors.includes(FOLLOWUP_MISSED_ERROR)){
      errors=errors.filter(label=>label!==FOLLOWUP_MISSED_ERROR);
    }
    const rowForText={...lead.staticValues,comments,next:lead.staticValues.next||lead.auditContext?.n||""};
    return{
      ...lead.staticValues,
      overdue,
      commentQuality:q,
      errorTypes:errors.length?errors.join(", "):"None",
      errorSeverity:severityFromErrors(errors),
      buyingIntent:intent,
      observation:finalizeObservation(ai.o,rowForText,errors,q),
      recommendation:finalizeRecommendation(ai.r,rowForText,errors,q)
    };
  });
  // #region agent log
  try{
    const buf=typeof sessionStorage!=="undefined"?JSON.parse(sessionStorage.getItem("ll-debug-6866e6")||"[]"):[];
    const recent=buf.filter(x=>x?.location==="audit.js:auditBatch-merge").slice(-batch.length);
    const rTalkNoErr=recent.filter(x=>x?.data?.aiRHasStatusTalk&&!x?.data?.finalHasStatus).length;
    const aiEmitted=recent.filter(x=>Array.isArray(x?.data?.rawAiE)&&x.data.rawAiE.some(t=>/status|aligned/i.test(String(t)))).length;
    const resolvedOk=recent.filter(x=>Array.isArray(x?.data?.aiErrors)&&x.data.aiErrors.includes(STATUS_HISTORY_ERROR)).length;
    const stripped=recent.filter(x=>x?.data?.aligned&&Array.isArray(x?.data?.beforeHard)&&x.data.beforeHard.includes(STATUS_HISTORY_ERROR)).length;
    agentDebugLog({runId:"pre-fix",hypothesisId:"A-E",location:"audit.js:auditBatch-flush",message:"batch status debug summary",data:{batchSize:batch.length,recent:recent.length,rTalkNoErr,aiEmitted,resolvedOk,stripped}},log);
    if(typeof log==="function")log(`[DBG-status] batch summary: rows=${batch.length} aiEmittedStatus=${aiEmitted} resolvedOk=${resolvedOk} strippedByAligned=${stripped} rTalkWithoutError=${rTalkNoErr}`,"warn");
  }catch{/* ignore */}
  // #endregion
  return rows;
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
  if(fieldId==="overdue"){
    const n=Number(raw);
    return Number.isFinite(n)?n:Number.NEGATIVE_INFINITY;
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
  return buildDeterministicInsights(buildReviewSummary(job));
}

/** Manager-facing copy derived only from audit tallies (no LLM). */
export function buildDeterministicInsights(metrics){
  const audited=Math.max(1,Number(metrics.auditedRows)||0);
  const avg=Number(metrics.avgCommentQuality)||0;
  const high=Number(metrics.severityMix?.HIGH)||0;
  const medium=Number(metrics.severityMix?.MEDIUM)||0;
  const none=Number(metrics.severityMix?.NONE)||0;
  const intentYes=Number(metrics.buyingIntentMix?.Yes)||0;
  const intentPct=Math.round((intentYes/audited)*100);
  const errorPct=Math.round(((high+medium)/audited)*100);
  const top=(metrics.errorTallies||[]).slice(0,5);
  const q=metrics.qualityDistribution||{};
  const weak=(Number(q["0-2"])||0)+(Number(q["3-4"])||0);
  const strong=(Number(q["7-8"])||0)+(Number(q["9-10"])||0);

  let headline="Solid telecalling quality with room to tighten process.";
  if(avg<=3||errorPct>=40)headline="Urgent coaching needed — comment quality and error rate are off track.";
  else if(avg<=5||errorPct>=25)headline="Mixed performance — strengthen comments and close recurring gaps.";
  else if(avg>=7&&errorPct<=15)headline="Strong performance — protect quality and scale what works.";

  const summaryParts=[
    `${metrics.telecallerName||"This TeleCaller"} was scored on ${audited} audited call row${audited===1?"":"s"} (avg comment quality ${avg}/10).`,
    `${errorPct}% of rows carry a Medium or High severity issue (${high} high · ${medium} medium · ${none} clean).`,
    `Buying intent flagged on ${intentPct}% of audited rows.`,
    weak||strong?`Comment quality mix: ${weak} weaker (0–4) vs ${strong} stronger (7–10).`:""
  ].filter(Boolean);
  if(top.length){
    summaryParts.push(`Most frequent error patterns: ${top.map(item=>`${item.label} (${item.count})`).join("; ")}.`);
  }else{
    summaryParts.push("No recurring error labels dominated this slice.");
  }
  summaryParts.push("This report is built from LeadLens audit metrics only (no generative AI narrative).");

  const strengths=[];
  if(avg>=6)strengths.push(`Average comment quality holds at ${avg}/10.`);
  if(strong>weak&&strong>0)strengths.push(`More strong comment rows (${strong}) than weak ones (${weak}).`);
  if(errorPct<=20)strengths.push(`Error rate stays at ${errorPct}% of audited rows.`);
  if(intentPct>=20)strengths.push(`Buying intent appears on ${intentPct}% of rows — protect those conversations.`);
  if(!strengths.length)strengths.push("Use the charts below to isolate pockets of acceptable quality.");

  const risks=top.length
    ?top.map(item=>`${item.label} — ${item.count} row${item.count===1?"":"s"} (${Math.round((item.count/audited)*100)}% of audited).`)
    :["No dominant error type — review individual High-severity rows in the Excel export."];
  if(high>0)risks.unshift(`${high} high-severity row${high===1?"":"s"} need manager attention first.`);

  const coachingFocus=[];
  if(weak>strong)coachingFocus.push("Raise comment depth: need, budget, locality, objection, decision-maker, next step.");
  for(const item of top.slice(0,3)){
    if(/location/i.test(item.label))coachingFocus.push("Capture preferred micro-market / location on every connected call.");
    else if(/comment quality not appropriate/i.test(item.label))coachingFocus.push("On connected calls capture facing, size, purpose, and timeline in comments.");
    else if(/requirement/i.test(item.label))coachingFocus.push("Record a real customer requirement — not RNR/visited/status crumbs.");
    else if(/budget/i.test(item.label))coachingFocus.push("Ask and save budget band before ending connected calls.");
    else if(/status|aligned/i.test(item.label))coachingFocus.push("Align Lead Status to the latest comment trajectory on the Prospect→Lost ladder.");
    else if(/follow-up missed|follow up missed/i.test(item.label))coachingFocus.push("Call on or before the promised follow-up date and set a fresh dated next step.");
    else coachingFocus.push(`Drill on “${item.label}” until it drops in the next cycle.`);
  }
  if(!coachingFocus.length)coachingFocus.push("Spot-check High-severity Excel rows and coach from concrete call examples.");
  // Dedupe while preserving order
  const seen=new Set();
  const uniqueFocus=coachingFocus.filter(item=>{
    const key=norm(item);
    if(seen.has(key))return false;
    seen.add(key);
    return true;
  }).slice(0,6);

  return{headline,summary:summaryParts.join(" "),strengths,risks,coachingFocus:uniqueFocus};
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
  const marginX=14;
  const marginBottom=14;
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
  doc.rect(0,0,pageW,32,"F");
  pdfSetText(doc,PDF_BRAND.white);
  doc.setFont("helvetica","bold");
  doc.setFontSize(16);
  doc.text("LeadLens",marginX,13);
  doc.setFont("helvetica","normal");
  doc.setFontSize(10);
  doc.text("TeleCaller performance report · audit metrics",marginX,22);
  doc.setFont("helvetica","bold");
  doc.setFontSize(11);
  doc.text(String(metrics.telecallerName||"Unknown"),pageW-marginX,13,{align:"right"});
  doc.setFont("helvetica","normal");
  doc.setFontSize(8);
  doc.text(runLabel,pageW-marginX,21,{align:"right"});

  let y=38;
  pdfSetFill(doc,PDF_BRAND.paper);
  doc.roundedRect(marginX,y,contentW,10,2,2,"F");
  pdfSetText(doc,PDF_BRAND.ink);
  doc.setFontSize(9);
  doc.text(`Leads ${Number(metrics.leadCount||0).toLocaleString()}   ·   Calls ${Number(metrics.callCount||0).toLocaleString()}   ·   Audited rows ${Number(metrics.auditedRows||0).toLocaleString()}`,marginX+4,y+6.5);
  y+=14;

  if(report.headline){
    pdfSetText(doc,PDF_BRAND.green);
    doc.setFont("helvetica","bold");
    doc.setFontSize(12);
    const headlineLines=pdfWrap(doc,report.headline,contentW);
    doc.text(headlineLines,marginX,y);
    y+=headlineLines.length*5.5+3;
    doc.setFont("helvetica","normal");
  }

  // Score strip
  const scoreCards=[
    {label:"Avg comment quality",value:String(scores.avgQuality)},
    {label:"Error rate",value:`${scores.errorRate}%`},
    {label:"High-severity",value:`${scores.highSeverity}%`},
    {label:"Buying intent",value:`${scores.buyingIntent}%`}
  ];
  const gap=3.5;
  const cardW=(contentW-(scoreCards.length-1)*gap)/scoreCards.length;
  const cardH=18;
  scoreCards.forEach((card,i)=>{
    const x=marginX+i*(cardW+gap);
    pdfSetFill(doc,PDF_BRAND.mint);
    doc.roundedRect(x,y,cardW,cardH,2,2,"F");
    pdfSetText(doc,PDF_BRAND.muted);
    doc.setFontSize(7);
    doc.text(card.label,x+3,y+6);
    pdfSetText(doc,PDF_BRAND.green);
    doc.setFont("helvetica","bold");
    doc.setFontSize(13);
    doc.text(card.value,x+3,y+14);
    doc.setFont("helvetica","normal");
  });
  y+=cardH+8;

  // Charts — larger
  const charts=await buildReviewChartImages(Chart,metrics);
  const chartH=48;
  const colGap=4;
  const leftW=(contentW-colGap)/2;
  pdfSetText(doc,PDF_BRAND.ink);
  doc.setFont("helvetica","bold");
  doc.setFontSize(9);
  doc.text("Comment quality distribution",marginX,y);
  doc.text("Top error types",marginX+leftW+colGap,y);
  y+=3;
  doc.addImage(charts.qualityImg,"PNG",marginX,y,leftW,chartH);
  doc.addImage(charts.errorsImg,"PNG",marginX+leftW+colGap,y,leftW,chartH);
  y+=chartH+7;

  y=pdfEnsureSpace(doc,y,58,marginBottom);
  doc.setFont("helvetica","bold");
  doc.setFontSize(9);
  pdfSetText(doc,PDF_BRAND.ink);
  doc.text("Severity mix",marginX,y);
  doc.text("Error frequency table",marginX+72,y);
  y+=3;
  const sevW=62;
  doc.addImage(charts.severityImg,"PNG",marginX,y,sevW,50);

  // Error table beside severity
  let tableY=y+2;
  const tableX=marginX+72;
  const tableW=contentW-72;
  pdfSetFill(doc,PDF_BRAND.green);
  doc.rect(tableX,tableY,tableW,6,"F");
  pdfSetText(doc,PDF_BRAND.white);
  doc.setFontSize(7);
  doc.setFont("helvetica","bold");
  doc.text("Error type",tableX+2,tableY+4);
  doc.text("Count",tableX+tableW-2,tableY+4,{align:"right"});
  tableY+=6;
  doc.setFont("helvetica","normal");
  const rows=(metrics.errorTallies||[]).slice(0,8);
  if(!rows.length){
    pdfSetFill(doc,PDF_BRAND.paper);
    doc.rect(tableX,tableY,tableW,6,"F");
    pdfSetText(doc,PDF_BRAND.muted);
    doc.text("No error labels in this slice",tableX+2,tableY+4);
    tableY+=6;
  }else{
    rows.forEach((item,idx)=>{
      pdfSetFill(doc,idx%2?PDF_BRAND.paper:PDF_BRAND.white);
      doc.rect(tableX,tableY,tableW,6,"F");
      pdfSetText(doc,PDF_BRAND.ink);
      const label=item.label.length>42?item.label.slice(0,40)+"…":item.label;
      doc.text(label,tableX+2,tableY+4);
      doc.text(String(item.count),tableX+tableW-2,tableY+4,{align:"right"});
      tableY+=6;
    });
  }
  y=Math.max(y+52,tableY)+6;

  const writeBulletSection=(title,items)=>{
    const list=items?.length?items:["None noted from this audit pass."];
    y=pdfEnsureSpace(doc,y,16,marginBottom);
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

  // Narrative from metrics
  y=pdfEnsureSpace(doc,y,24,marginBottom);
  pdfSetFill(doc,PDF_BRAND.green);
  doc.rect(marginX,y,2.2,5,"F");
  pdfSetText(doc,PDF_BRAND.ink);
  doc.setFont("helvetica","bold");
  doc.setFontSize(10);
  doc.text("Executive summary",marginX+5,y+4);
  y+=9;
  doc.setFont("helvetica","normal");
  doc.setFontSize(9);
  pdfSetText(doc,PDF_BRAND.ink);
  const summaryLines=pdfWrap(doc,report.summary||"No audit metrics available.",contentW);
  for(const line of summaryLines){
    y=pdfEnsureSpace(doc,y,5,marginBottom);
    doc.text(line,marginX,y);
    y+=4.4;
  }
  y+=4;

  writeBulletSection("Strengths",report.strengths);
  writeBulletSection("Risks",report.risks);
  writeBulletSection("Coaching focus",report.coachingFocus);

  const samples=(metrics.sampleObservations||[]).slice(0,5);
  const tips=(metrics.sampleRecommendations||[]).slice(0,5);
  if(samples.length)writeBulletSection("Sample auditor observations",samples);
  if(tips.length)writeBulletSection("Sample auditor recommendations",tips);

  const endPage=doc.getNumberOfPages();
  const pageH=doc.internal.pageSize.getHeight();
  for(let p=startPage;p<=endPage;p++){
    doc.setPage(p);
    pdfSetDraw(doc,PDF_BRAND.line);
    doc.setLineWidth(0.2);
    doc.line(marginX,pageH-10,pageW-marginX,pageH-10);
    pdfSetText(doc,PDF_BRAND.muted);
    doc.setFontSize(7);
    doc.text(`LeadLens ${APP_VERSION} · Confidential · Audit-metrics report (no generative AI)`,marginX,pageH-6);
    doc.text(`${metrics.telecallerName||"TeleCaller"} · ${p}`,pageW-marginX,pageH-6,{align:"right"});
  }
}

/** Build a multi-page TeleCaller performance PDF (one section/page set per job). */
export async function buildReviewPdfBlob(jobs){
  const list=(jobs||[]).filter(job=>job&&job.results?.length);
  if(!list.length)throw new Error("No completed TeleCaller audits to export as PDF.");
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

export async function downloadTelecallerDashboard(jobs,filename){
  const list=(jobs||[]).filter(job=>job&&job.results?.length);
  if(!list.length)throw new Error("No completed TeleCaller audits to export as dashboard.");
  const results=list.flatMap(job=>job.results||[]);
  const blob=await buildTelecallerDashboardBlob(results,{highSeverityErrors:HIGH_SEVERITY_ERRORS});
  downloadBlobFile(blob,filename||`TeleCaller_Dashboard_${stampFile()}.xlsx`);
}

/** Download dashboard Excel and/or audit Excel for one or many jobs according to packing.
 * artifact "dashboard" → template fill only (never plain audit workbook).
 * artifact "excel" → plain audit workbook only.
 */
export async function downloadReviewPack(jobs,currentSettings,{packing="combined",artifact="both"}={}){
  const list=(jobs||[]).filter(job=>job&&job.results?.length);
  if(!list.length)throw new Error("No completed TeleCaller audits to download.");
  const settings=normalizeSettings(currentSettings);
  const stamp=stampFile();
  // Legacy pdf/txt aliases map to dashboard (PDF download was replaced in 3.5.0).
  const wantDash=artifact==="dashboard"||artifact==="both"||artifact==="pdf"||artifact==="txt";
  // Plain audit Excel is never bundled with a dashboard-only request.
  const wantExcel=artifact==="excel"||artifact==="both";
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

  if(packing==="separate"){
    for(let i=0;i<list.length;i++){
      const job=list[i];
      const part=sanitizeFilePart(job.telecallerName||job.fileName||`TeleCaller_${i+1}`);
      if(wantDash)await downloadTelecallerDashboard([job],`Dashboard_${part}_${stamp}.xlsx`);
      if(wantExcel){
        const blob=buildWorkbookBlob(job,settings);
        downloadBlobFile(blob,`Audit_${part}_${stamp}_${settings.sort.field}-${settings.sort.direction}.xlsx`);
      }
      if(i<list.length-1)await sleep(300);
    }
    return;
  }

  if(wantDash)await downloadTelecallerDashboard(list,`TeleCaller_Dashboard_${stamp}.xlsx`);
  if(wantExcel){
    const merged=mergeReviewJobs(list);
    const blob=buildWorkbookBlob(merged.job,settings);
    downloadBlobFile(blob,`Audit_Data_${stamp}_${settings.sort.field}-${settings.sort.direction}.xlsx`);
  }
}

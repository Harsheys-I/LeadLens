export const APP_VERSION = "2.6.4";
/** Bump when default AI rules / field defaults must refresh existing localStorage settings. */
export const SETTINGS_SEED = 8;

export const ERROR_TYPES = [
  "Comment displaying -ve, but Lead Status is +ve",
  "Comment displaying +ve, but Lead Status is -ve",
  "Lead Status not reflecting Comment History",
  "Missed 30min talk before",
  "Followup Date is Missed",
  "Customer Location is empty",
  "Customer Requirement is empty",
  "Estimated Budget is empty",
  "Analysis Parameter is Empty",
  "Customer Requirement is set wrong"
];
export const HIGH_SEVERITY_ERRORS = new Set([
  "Comment displaying -ve, but Lead Status is +ve",
  "Comment displaying +ve, but Lead Status is -ve",
  "Lead Status not reflecting Comment History",
  "Missed 30min talk before",
  "Followup Date is Missed",
  "Customer Location is empty",
  "Customer Requirement is set wrong"
]);
const STATUS_HISTORY_ERROR = "Lead Status not reflecting Comment History";
const MISSED_30MIN_ERROR = "Missed 30min talk before";
const CONNECTED_ONLY_ERRORS = new Set([
  "Customer Location is empty",
  "Customer Requirement is empty",
  "Estimated Budget is empty",
  "Customer Requirement is set wrong"
]);
const EMPTY_REQUIREMENT = "Customer Requirement is empty";
const WRONG_REQUIREMENT = "Customer Requirement is set wrong";
/** Old numeric codes → labels (ignored in prompts; kept only to normalize leftover saved settings). */
const LEGACY_ERROR_CODES = {
  "0":"Comment displaying -ve, but Lead Status is +ve",
  "1":"Comment displaying +ve, but Lead Status is -ve",
  "2":"Followup Date is Missed",
  "3":"Customer Location is empty",
  "4":"Customer Requirement is empty",
  "5":"Estimated Budget is empty",
  "6":"Analysis Parameter is Empty",
  "7":"Customer Requirement is set wrong"
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
  {field:"Lead Status + Comments",instruction:`Allowed Lead Status labels only (case-insensitive): Prospect, Hot, Warm, Cold, Beyond Budget, Lost. Heat ladder highest→lowest: ${STATUS_LADDER_TEXT}. c is ALWAYS the FULL chronological comment history (oldest→newest) — read EVERY entry before judging CURRENT s. Trajectory matters: if early comments were highly positive but later entries cool to RNR/CNP/WhatsApp-followup/neutral/negative, s must step down the ladder (e.g. Prospect → Warm); keeping Prospect/Hot is wrong. HARD RULE: more than 2 continuous trailing RNR-like notes (RNR, CNP, busy, ringing, WhatsApp follow-up/WA FU, no answer, switched off) ⇒ s cannot be Prospect — emit "Lead Status not reflecting Comment History". Same in reverse: history warms from cold/RNR to clear positive interest but s stays Cold/Beyond Budget/Lost ⇒ emit "Lead Status not reflecting Comment History". Also emit "Comment displaying -ve, but Lead Status is +ve" / "Comment displaying +ve, but Lead Status is -ve" for clear latest-tone polarity mismatches. RNR/CNP/busy alone never upgrades status. Neutral admin notes with no polarity shift are not mismatches.`,errors:"Lead Status not reflecting Comment History | Comment displaying -ve, but Lead Status is +ve | Comment displaying +ve, but Lead Status is -ve"},
  {field:"First talk SLA",instruction:"Inputs reg = Lead Registration DateTime, fu = FIRST Lead Update DateTime after near-duplicate filtering (oldest call, NOT the latest). Only when reg has a clock time AND falls between 09:30 and 17:00 inclusive: fu must be within 30 minutes after reg. If fu is missing, earlier than reg, or more than 30 minutes later → emit \"Missed 30min talk before\". If reg is outside 09:30–17:00, or reg is date-only (no usable time), do nothing for this check.",errors:"Missed 30min talk before"},
  {field:"Comment quality",instruction:"Score q strictly. q must reflect how well Comments capture the real telecaller–customer conversation (need, budget, location preference, objection, decision-maker, next step). One-word/CRM crumbs like visited/RNR/CNP/busy/followup = q 0-2 max. Generic connected notes without customer detail = q <=4. Only rich descriptive talk earns 8-10. When c is an array, score THIS call's latest comment (last entry), using earlier entries only as context.",errors:""},
  {field:"Customer Requirement",instruction:`ONLY when k=Yes: rq must be a real customer requirement. Empty/placeholder (., -, **, NA) => "${EMPTY_REQUIREMENT}". Call jargon (RNR, Visited, etc.) => "${WRONG_REQUIREMENT}". If k is No or blank, NEVER emit those requirement errors.`,errors:`${EMPTY_REQUIREMENT} | ${WRONG_REQUIREMENT}`},
  {field:"AI Observation",instruction:"o is a QA judgment, NOT a rewrite of Comments. Forbidden: copying, lightly shortening, or paraphrasing c. Required: name what is missing/wrong/strong for audit (e.g. thin note, rq junk, status mismatch vs full history, missed first-talk SLA, missing budget on connected call). 18-28 words.",errors:""},
  {field:"AI Recommendation",instruction:"r must be a concrete telecaller coaching action: what to ask/capture/correct on the next call (fields, questions, status fix down/up the Prospect→Lost ladder, follow-up discipline). Not vague ('follow up', 'update remarks'). 20-40 words, specific to THIS call's gaps.",errors:""},
  {field:"Buying intent",instruction:"i=1 only for genuine positive purchase interest in THIS call's latest comment/status; else i=0. Earlier history alone does not set i=1 if the latest comment cooled.",errors:""}
];
export const DEFAULT_SETTINGS = {
  batchSize:20,concurrency:2,model:"gpt-4o-mini",
  inputFields:DEFAULT_INPUT_FIELDS,aiFields:DEFAULT_AI_FIELDS,outputFields:DEFAULT_OUTPUT_FIELDS,rules:DEFAULT_RULES,
  yesValues:"yes, connected, call connected",noValues:"no, not connected, call not connected",
  additionalInstructions:"",
  sort:{field:"callDate",direction:"asc"},
  pricing:{input:0,cached:0,output:0}
};

/* Large stable prefix FIRST so OpenAI prompt caching can activate (>=1024 tokens;
   some models need closer to 2048). Run-specific rules come after; lead data last. */
const CACHE_HANDBOOK = `LeadLens QA v2.6.0 — stable cacheable auditor handbook. Evidence only. Never invent facts, dates, budgets, locations, or prior calls.

PURPOSE
You audit Indian real-estate telecalling follow-up notes. Judge only the supplied fields for THIS call id. Optional day[] lists sibling calls on the same latest calendar day — context only; still return one result for THIS id.

INPUT CONTRACT
- id: opaque lead/call id. Echo it exactly. Never invent or drop ids.
- s: Lead Status on THIS call
- c: Comments — ALWAYS full chronological history array for the lead (oldest→newest). Status trajectory uses the entire array; q/i focus on the last entry
- n: Next Followup Date (DD/MM/YYYY or "")
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

ERROR TYPES (emit exact labels only — no codes, no paraphrases)
- Comment displaying -ve, but Lead Status is +ve
- Comment displaying +ve, but Lead Status is -ve
- Lead Status not reflecting Comment History
- Missed 30min talk before
- Followup Date is Missed
- Customer Location is empty
- Customer Requirement is empty
- Estimated Budget is empty
- Analysis Parameter is Empty
- Customer Requirement is set wrong
Prefer e:[] over weak guesses. The app may also add some empty-field / SLA / history errors deterministically.

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
INVALID when connected and non-blank ("Customer Requirement is set wrong"): RNR, CNP, Visited, Site visit, Busy, Followup, Callback, Interested, Not interested, Connected, ringing, wrong number, status/comment dumps.
Placeholder-only (., -, NA, nil) on connected call => "Customer Requirement is empty", not "set wrong".

BUYING INTENT i
i=1 only for genuine purchase interest (site visit interest, options request, active shortlist, budget toward buy).
i=0 for CNP/busy/NI/wrong number/neutral admin/no interest signal.

STATUS vs FULL COMMENT HISTORY
Allowed Lead Status labels (case-insensitive): Prospect, Hot, Warm, Cold, Beyond Budget, Lost.
Heat ladder highest→lowest: Prospect > Hot > Warm > Cold > Beyond Budget > Lost.
c is the full chronological timeline — read ALL entries, then judge CURRENT s against the trajectory and the latest meaningful tone.
If early comments were hot/positive but later notes cool to RNR/CNP/WhatsApp-followup/neutral/negative, s must decrease (Prospect should become Warm or lower). Keeping Prospect after a cooled timeline is wrong.
HARD RULE: more than 2 continuous trailing RNR-like notes (RNR, CNP, busy, ringing, no answer, switched off, WhatsApp follow-up / WA FU) ⇒ s cannot be Prospect — emit "Lead Status not reflecting Comment History".
Opposite: history warms from cold/RNR to clear positive interest but s stays Cold/Beyond Budget/Lost ⇒ emit "Lead Status not reflecting Comment History".
Also emit "Comment displaying -ve, but Lead Status is +ve" when status is too hot vs latest comments, and "Comment displaying +ve, but Lead Status is -ve" when status is too cold vs clear +ve latest interest.
RNR/CNP/busy alone does not justify keeping/upgrading to Prospect/Hot. Neutral / not-connected admin notes without polarity shift are NOT mismatches.

FIRST TALK SLA (reg + fu)
reg = registration datetime; fu = FIRST update datetime (oldest after near-dupe filter), never the latest call.
ONLY when reg includes a usable clock time AND is between 09:30 and 17:00 inclusive: fu must be within 30 minutes after reg.
If fu is blank, before reg, or >30 minutes after reg → emit "Missed 30min talk before".
If reg is outside 09:30–17:00, or reg is date-only with no clock time, skip this check entirely.

CONNECTED GATING
"Customer Location is empty", "Customer Requirement is empty", "Estimated Budget is empty", and "Customer Requirement is set wrong" are ALLOWED ONLY when k=Yes.
If k is No or "", NEVER emit those four — even if l/rq/b are empty, "**", ".", or junk.

STYLE — OBSERVATION (o) AND RECOMMENDATION (r)
o = auditor judgment about data quality / process gaps / mismatches. It must NOT copy, trim, or paraphrase Comments (c). Bad o examples: restating "customer visited", "wants 2BHK Whitefield". Good o examples: "Connected call note is non-descriptive; requirement captured as visit jargon; budget missing." / "Status still Prospect after three trailing RNRs — history not reflected."
r = specific next-call coaching: what questions to ask, which fields to fill (rq/location/budget), how to correct status, when to call back. Bad r: "Follow up", "Update comments", "Call again". Good r: "On next connected call ask preferred config, micro-market, and budget band; replace rq junk with real requirement; set follow-up date same day."
Never dump the full comment into o or r. Never restate this handbook.

EXAMPLES
A) c="visited" => q<=2, usually i=0.
B) k=Yes, rq="." or "" => "Customer Requirement is empty".
C) k=Yes, rq="RNR" or "Visited" => "Customer Requirement is set wrong".
D) k=Yes, rq="2BHK Whitefield" => rq OK.
E) day[] siblings present: score/flag THIS call only; siblings are context.
F) s=Interested, c=customer said not interested stop calling => status -ve/+ve mismatch, i=0.
G) s=Hot, c=wants 2BHK under 90L Saturday visit => high q, i=1, e:[].
H) k=No, c=ringing no answer => i=0, usually e:[] from model.
I) c history [hot interest, RNR, RNR, WA followup] and s=Prospect => "Lead Status not reflecting Comment History".
J) reg=12/03/2026 10:00, fu=12/03/2026 11:00 => "Missed 30min talk before". reg=12/03/2026 18:00 => skip SLA.

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
LeadLens keeps this handbook byte-stable so automatic prompt caching can reuse the prefix across batches in a run and across nearby reruns. Static instructions stay first; configured run checks follow; unique lead payloads stay last. Routing uses a stable prompt_cache_key derived from model + rules. Parallel workers must warm this prefix once before fanning out. Treat the following checklist as fixed operating procedure: verify id echo, apply q hard caps, distinguish rq empty vs wrong, gate l/rq/b on connected, apply history trajectory + first-talk SLA, keep outputs compact, never invent sibling calls, never merge two ids, never invent error labels, never emit severity, never wrap JSON in fences, never discuss pricing or tokens, never mention cache mechanics in o/r. Repeatable discipline improves audit consistency across telecalling QA shifts, projects, and batch sizes while preserving privacy of customer records inside the browser-only LeadLens workflow.

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
  for(const rule of settings.rules||[]){
    for(const token of splitErrorList(rule.errors)){
      const legacy=LEGACY_ERROR_CODES[token];
      const label=legacy||token;
      if(!byNorm.has(norm(label)))byNorm.set(norm(label),label);
    }
  }
  const resolve=token=>{
    const raw=clean(token);
    if(!raw)return"";
    if(LEGACY_ERROR_CODES[raw])return LEGACY_ERROR_CODES[raw];
    return byNorm.get(norm(raw))||"";
  };
  const allowed=new Set([...byNorm.values()]);
  return{resolve,allowed,labels:[...allowed]};
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
  const byField=new Map();
  for(const rule of saved){
    const key=norm(rule.field)||`custom-${byField.size}`;
    if(!byField.has(key))byField.set(key,rule);
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
  }
  // Comments history is required for trajectory checks — always on.
  const commentsField=merged.aiFields.find(field=>field.id==="comments");
  if(commentsField){commentsField.enabled=true;commentsField.history=true;}
  merged.settingsSeed=SETTINGS_SEED;
  merged.pricing={...DEFAULT_SETTINGS.pricing,...(saved.pricing||{})};
  // Force Lead Update Date ascending on first upgrade to seed 4; keep user sort afterward.
  if(seedFresh&&previousSeed<4)merged.sort={field:"callDate",direction:"asc"};
  else merged.sort={...DEFAULT_SETTINGS.sort,...(saved.sort||{})};
  if(!merged.outputFields.some(field=>field.id===merged.sort.field)||merged.sort.field==="dayCallIndex")merged.sort.field="callDate";
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
  const match=s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if(match){
    const year=match[3].length===2?Number(`20${match[3]}`):Number(match[3]);
    const d=new Date(year,Number(match[2])-1,Number(match[1]),Number(match[4]||0),Number(match[5]||0),Number(match[6]||0));
    return Number.isNaN(d.valueOf())?null:d;
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
  return/\b(interested|site visit|sv done|want(s|ed)?|looking for|budget|2bhk|3bhk|visit(ed)?|call me|send(ing)? details|shortlist|book(ing)?|come(s)? for visit)\b/.test(n);
}
function trailingRnrStreak(comments){
  let streak=0;
  for(let i=comments.length-1;i>=0;i--){
    if(isRnrLikeComment(comments[i]))streak++;
    else break;
  }
  return streak;
}
function historyStatusErrors(status,comments){
  const errors=[];
  const list=Array.isArray(comments)?comments.map(clean).filter(Boolean):[clean(comments)].filter(Boolean);
  if(!list.length)return errors;
  const statusNorm=norm(status);
  const streak=trailingRnrStreak(list);
  if(streak>2&&statusNorm==="prospect")errors.push(STATUS_HISTORY_ERROR);
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
  if(call.nextDate&&call.nextDate<today)errors.push("Followup Date is Missed");
  if(isBlankish(call.parameter))errors.push("Analysis Parameter is Empty");
  if(call.connected==="Yes"){
    if(isBlankish(call.location))errors.push("Customer Location is empty");
    if(isBlankish(call.requirement))errors.push(EMPTY_REQUIREMENT);
    else if(looksLikeWrongRequirement(call.requirement))errors.push(WRONG_REQUIREMENT);
    if(isBlankish(call.budget))errors.push("Estimated Budget is empty");
  }
  if(missedThirtyMinTalk(registrationAt,firstUpdateAt))errors.push(MISSED_30MIN_ERROR);
  for(const label of historyStatusErrors(call.status,commentHistory.length?commentHistory:[call.comments])){
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
    const updateAt=parseDateTime(values.update);
    const updateDate=updateAt?new Date(updateAt.getFullYear(),updateAt.getMonth(),updateAt.getDate()):parseDate(values.update);
    const record={...values,rowIndex:index,updateAt,updateDate,nextDate:parseDate(values.next)},key=`${lastProject} | ${lastMobile}`;
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
    fillDownWithinGroup(rawRecords,"status");
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
      const staticValues={
        project:call.project,
        mobile:call.mobile,
        registration:dateTimeText(registrationAt)||registration,
        telecaller:clean(call.telecaller)||telecaller,
        status:call.status,
        comments:call.comments,
        next:dateText(call.nextDate||call.next),
        callDate:leadUpdateDate,
        update:leadUpdateDate,
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
        else auditContext[key]=field.history
          ?records.map(record=>contextValue(field.id,record,correctedAiLocation(record.project,record.location)))
          :contextValue(field.id,call,aiLocation);
      }
      auditContext.reg=dateTimeText(registrationAt)||registration||"";
      auditContext.fu=dateTimeText(firstUpdateAt)||"";
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
  return{
    sheetName:selected.name,
    leads,
    rowCount:selected.rows.length,
    leadCount:grouped.size,
    callCount:selected.rows.length,
    latestDayCalls:leads.length,
    invalidRows,
    dedupedRows
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
  else if(errors.some(e=>/Lead Status/i.test(e)))bits.push("Lead status conflicts with comment polarity.");
  if(errors.includes(MISSED_30MIN_ERROR))bits.push("First update missed the 30-minute talk window after daytime registration.");
  if(errors.includes(EMPTY_REQUIREMENT))bits.push("Connected call has empty/placeholder requirement.");
  if(errors.includes(WRONG_REQUIREMENT))bits.push("Requirement field holds call jargon, not a customer need.");
  if(errors.includes("Customer Location is empty"))bits.push("Connected call missing usable location.");
  if(errors.includes("Estimated Budget is empty"))bits.push("Connected call missing budget.");
  if(errors.includes("Followup Date is Missed"))bits.push("Follow-up date is already past.");
  if(errors.includes("Analysis Parameter is Empty"))bits.push("Analysis parameter is blank.");
  if(!bits.length)bits.push("Review note quality and field completeness for this call.");
  return clipWords(bits.join(" "),28);
}
function fallbackRecommendation(row,errors,q){
  const bits=[];
  if(q<=4)bits.push("Rewrite remarks with what the customer said: need, locality, budget, objection, and next step.");
  if(errors.includes(STATUS_HISTORY_ERROR))bits.push("Align Lead Status on the Prospect→Lost ladder to the full comment timeline (step down after repeated RNR).");
  if(errors.includes(MISSED_30MIN_ERROR))bits.push("Call daytime registrations within 30 minutes and log the first update promptly.");
  if(errors.includes(WRONG_REQUIREMENT)||errors.includes(EMPTY_REQUIREMENT))bits.push("On next connected call capture a real requirement (config/area), not RNR/Visited/status text.");
  if(errors.includes("Customer Location is empty"))bits.push("Ask and save preferred micro-market/location.");
  if(errors.includes("Estimated Budget is empty"))bits.push("Ask and save budget band before ending the call.");
  if(errors.some(e=>/Lead Status/i.test(e))&&!errors.includes(STATUS_HISTORY_ERROR))bits.push("Align Lead Status on the Prospect→Lost ladder to the latest comment tone.");
  if(errors.includes("Followup Date is Missed"))bits.push("Call on/before the promised follow-up and set a fresh dated next step.");
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
  const response=await fetch("https://api.openai.com/v1/chat/completions",{
    method:"POST",signal,
    headers:{"Content-Type":"application/json","Authorization":`Bearer ${apiKey}`},
    body:JSON.stringify({
      model:settings.model,
      temperature:0,
      max_tokens:Math.max(500,leads.length*140),
      prompt_cache_key:promptCacheKey(settings),
      messages:[
        {role:"system",content:buildPrompt(settings)},
        {role:"user",content:`Audit ${leads.length} call(s). Echo each id. c=full history; reg+fu=first-talk SLA; o=QA analysis not comment copy; r=specific coaching.\n${JSON.stringify({L:modelInput})}`}
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
const severityFromErrors=errors=>!errors.length?"NONE":errors.some(error=>HIGH_SEVERITY_ERRORS.has(error))?"HIGH":"MEDIUM";

export async function auditBatch(apiKey,rawSettings,batch,signal,log,onUsage){
  const settings=normalizeSettings(rawSettings);
  const maps=buildErrorMaps(settings);
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
    const aiErrors=Array.isArray(ai.e)?ai.e.map(token=>maps.resolve(token)).filter(label=>maps.allowed.has(label)):[];
    const connectedYes=lead.staticValues.connected==="Yes";
    const filteredAi=connectedYes?aiErrors:aiErrors.filter(label=>!CONNECTED_ONLY_ERRORS.has(label));
    const filteredDet=connectedYes?lead.deterministicErrors:lead.deterministicErrors.filter(label=>!CONNECTED_ONLY_ERRORS.has(label));
    const merged=unique([...filteredDet,...filteredAi]);
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
    const date=parseDate(raw);
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
    const dateCmp=(parseDate(a.callDate)?.valueOf()??0)-(parseDate(b.callDate)?.valueOf()??0);
    if(dateCmp)return dateCmp;
    return(Number(a.dayCallIndex)||0)-(Number(b.dayCallIndex)||0);
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
  // Merge Mobile + Project across contiguous rows of the same lead (same Mobile+Project).
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
  const stamp=new Date().toISOString().slice(0,19).replace(/[:T]/g,"-");
  XLSX.writeFile(book,`Audit_Data_${stamp}_${settings.sort.field}-${settings.sort.direction}.xlsx`);
}

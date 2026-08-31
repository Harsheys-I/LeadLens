/**
 * TeleCalling Performance Report — Excel parse, metrics engine, published dashboard UI.
 */
import {PerfDashboardApi} from "./api-client.js?v=5.2.7";

const MASTER_FIELDS = [
  {id: "mobile", label: "Mobile", aliases: "mobile, mobile number, phone"},
  {id: "project", label: "Project Name", aliases: "project name, project"},
  {id: "source", label: "Source", aliases: "source, source name"},
  {id: "registration", label: "Lead Registration Date", aliases: "lead registration date, registration date"},
  {id: "next", label: "Next Followup Date", aliases: "next followup date, next follow-up date, next follow up date"},
  {id: "status", label: "Status", aliases: "status, lead status"},
  {id: "telecaller", label: "Telecaller Name", aliases: "telecaller name, tellecaller name, tele caller name, agent name, executive name"},
];

const HISTORY_FIELDS = [
  ...MASTER_FIELDS.filter(f => f.id !== "next"),
  {id: "update", label: "Lead Update Date", aliases: "lead update date, call date, update date, lead update"},
  {id: "telecallingStatus", label: "Telecalling Status", aliases: "telecalling status, tele calling status, telecaller status"},
];

/** Count metrics stored per telecaller / summary. */
const METRIC_KEYS = [
  "totalLeads",
  "activeLeads",
  "siteVisited",
  "siteVisitScheduled",
  "siteVisitPending",
  "siteVisitCancelled",
  "notInterested",
  "overdue",
];
const METRIC_LABELS = {
  totalLeads: "Total Leads (Master ∪ History)",
  activeLeads: "Active Leads (Master)",
  siteVisited: "Site Visited (STE)",
  siteVisitScheduled: "Site Visit Scheduled (SVS)",
  siteVisitPending: "Site Visit Pending (SVP)",
  siteVisitCancelled: "Site Visit Cancelled (SVC)",
  notInterested: "Not Interested (NI)",
  overdue: "Overdue Leads (Master)",
};

/** Percentage columns derived for the scorecard (not summed across telecallers). */
const PCT_KEYS = ["totalLeadsVsSiteVisitedPct", "siteVisitScheduledVsSiteVisitedPct"];
const PCT_LABELS = {
  totalLeadsVsSiteVisitedPct: "Total Leads vs Site Visited (%)",
  siteVisitScheduledVsSiteVisitedPct: "Site Visit Scheduled vs Site Visited (%)",
};

/** Scorecard column order (matches operator report). */
const SCORECARD_COLUMNS = [
  {key: "totalLeads", label: METRIC_LABELS.totalLeads, kind: "count"},
  {key: "activeLeads", label: METRIC_LABELS.activeLeads, kind: "count"},
  {key: "siteVisited", label: METRIC_LABELS.siteVisited, kind: "count"},
  {key: "siteVisitScheduled", label: METRIC_LABELS.siteVisitScheduled, kind: "count"},
  {key: "siteVisitPending", label: METRIC_LABELS.siteVisitPending, kind: "count"},
  {key: "siteVisitCancelled", label: METRIC_LABELS.siteVisitCancelled, kind: "count"},
  {key: "notInterested", label: METRIC_LABELS.notInterested, kind: "count"},
  {key: "totalLeadsVsSiteVisitedPct", label: PCT_LABELS.totalLeadsVsSiteVisitedPct, kind: "pct"},
  {key: "siteVisitScheduledVsSiteVisitedPct", label: PCT_LABELS.siteVisitScheduledVsSiteVisitedPct, kind: "pct"},
  {key: "overdue", label: METRIC_LABELS.overdue, kind: "count"},
];

const PIE_KEYS = [
  "notInterested",
  "siteVisitScheduled",
  "siteVisitPending",
  "siteVisitCancelled",
  "siteVisited",
  "overdue",
];
const PIE_LABELS = {
  notInterested: "Not Interested",
  siteVisitScheduled: "Site Visit Scheduled",
  siteVisitPending: "Site Visit Pending",
  siteVisitCancelled: "Site Visit Cancelled",
  siteVisited: "Site Visited",
  overdue: "Overdue",
};

const CHART_COLORS = {
  bar: "#1f5d45",
  palette: ["#12372a", "#1f5d45", "#3f8c68", "#c57924", "#a33a32", "#2a5f9e", "#6c7771", "#9bb7a8"],
};

const PERF_DIMENSIONS = {
  telecaller: {bucketKey: "byTelecaller", label: "Telecaller Name", tableTitle: "Telecaller breakdown", totalsLabel: "TeleCallers"},
  project: {bucketKey: "byProject", label: "Project Name", tableTitle: "Project breakdown", totalsLabel: "Projects"},
  source: {bucketKey: "bySource", label: "Source", tableTitle: "Source breakdown", totalsLabel: "Sources"},
};

/** @type {Map<string, import("chart.js").Chart>} */
const perfChartRegistry = new Map();

let perfReconciled = null;
let perfUploadHandlers = null;
let perfPublishedHandlers = null;

function clean(value) {
  return String(value ?? "").trim();
}

function norm(value) {
  return clean(value).toLowerCase().replace(/\s+/g, " ");
}

function list(text) {
  return String(text ?? "")
    .split(",")
    .map(s => norm(s))
    .filter(Boolean);
}

function matchColumns(headers, fields) {
  const normalized = headers.map(header => ({header, key: norm(header)}));
  return Object.fromEntries(
    fields.map(field => {
      const aliases = list(field.aliases).concat(norm(field.label));
      const match = normalized.find(item => aliases.includes(item.key));
      return [field.id, match?.header || ""];
    })
  );
}

function parseDateValue(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return new Date(value.getTime());
  }
  if (typeof value === "number" && window.XLSX?.SSF) {
    const d = XLSX.SSF.parse_date_code(value);
    if (d) return new Date(d.y, d.m - 1, d.d, d.H || 0, d.M || 0, Math.floor(d.S || 0));
  }
  const s = clean(value);
  if (!s) return null;
  // ISO / CRM datetime: 2026-08-01 14:55:57.952 (keep milliseconds for max-LUD)
  const isoTime = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?/);
  if (isoTime) {
    const msPart = isoTime[7] ? Number(String(isoTime[7]).padEnd(3, "0").slice(0, 3)) : 0;
    return new Date(
      Number(isoTime[1]),
      Number(isoTime[2]) - 1,
      Number(isoTime[3]),
      Number(isoTime[4] || 0),
      Number(isoTime[5] || 0),
      Number(isoTime[6] || 0),
      msPart,
    );
  }
  const dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?/);
  if (dmy) {
    let y = Number(dmy[3]);
    if (y < 100) y += 2000;
    const msPart = dmy[7] ? Number(String(dmy[7]).padEnd(3, "0").slice(0, 3)) : 0;
    return new Date(y, Number(dmy[2]) - 1, Number(dmy[1]), Number(dmy[4] || 0), Number(dmy[5] || 0), Number(dmy[6] || 0), msPart);
  }
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.valueOf())) return parsed;
  return null;
}

function dateToIso(d) {
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDisplayDate(iso) {
  if (!iso) return "—";
  const d = parseDateValue(iso);
  if (!d) return String(iso);
  return d.toLocaleDateString(undefined, {year: "numeric", month: "short", day: "numeric"});
}

function todayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function emptyMetrics() {
  return {
    totalLeads: 0,
    activeLeads: 0,
    siteVisited: 0,
    siteVisitScheduled: 0,
    siteVisitPending: 0,
    siteVisitCancelled: 0,
    notInterested: 0,
    overdue: 0,
  };
}

function emptyPie() {
  return {
    notInterested: 0,
    siteVisitScheduled: 0,
    siteVisitPending: 0,
    siteVisitCancelled: 0,
    siteVisited: 0,
    overdue: 0,
  };
}

function emptyTelecallerBucket() {
  return {
    ...emptyMetrics(),
    pie: emptyPie(),
    _masterKeys: new Set(),
    _historyKeys: new Set(),
    _overdueKeys: new Set(),
  };
}

function pct(numerator, denominator) {
  const n = Number(numerator) || 0;
  const d = Number(denominator) || 0;
  if (d <= 0) return null;
  return Math.round((n / d) * 1000) / 10;
}

function formatPct(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return `${Number(value).toFixed(Number(value) % 1 === 0 ? 0 : 1)}%`;
}

function finalizeBucket(bucket) {
  const masterKeys = bucket._masterKeys || new Set();
  const historyKeys = bucket._historyKeys || new Set();
  const overdueKeys = bucket._overdueKeys || new Set();
  const union = new Set([...masterKeys, ...historyKeys]);
  // Active = Master leads; Total = Master ∪ History (Lead = Mobile + TeleCaller).
  bucket.activeLeads = masterKeys.size;
  bucket.totalLeads = union.size;
  bucket.overdue = overdueKeys.size;
  bucket.pie = {
    notInterested: Number(bucket.notInterested) || 0,
    siteVisitScheduled: Number(bucket.siteVisitScheduled) || 0,
    siteVisitPending: Number(bucket.siteVisitPending) || 0,
    siteVisitCancelled: Number(bucket.siteVisitCancelled) || 0,
    siteVisited: Number(bucket.siteVisited) || 0,
    overdue: Number(bucket.overdue) || 0,
  };
  delete bucket._masterKeys;
  delete bucket._historyKeys;
  delete bucket._overdueKeys;
  return bucket;
}

function metricsFromBucket(bucket) {
  if (!bucket || typeof bucket !== "object") return emptyMetrics();
  const out = emptyMetrics();
  for (const key of METRIC_KEYS) out[key] = Number(bucket[key] || 0);
  return out;
}

function pieFromBucket(bucket) {
  if (!bucket) return emptyPie();
  if (bucket.pie && typeof bucket.pie === "object") {
    const out = emptyPie();
    for (const key of PIE_KEYS) out[key] = Number(bucket.pie[key] || 0);
    return out;
  }
  return {
    notInterested: Number(bucket.notInterested) || 0,
    siteVisitScheduled: Number(bucket.siteVisitScheduled) || 0,
    siteVisitPending: Number(bucket.siteVisitPending) || 0,
    siteVisitCancelled: Number(bucket.siteVisitCancelled) || 0,
    siteVisited: Number(bucket.siteVisited) || 0,
    overdue: Number(bucket.overdue) || 0,
  };
}

function sumPieSlices(slices) {
  const out = emptyPie();
  for (const pie of slices) {
    for (const key of PIE_KEYS) out[key] += Number(pie[key] || 0);
  }
  return out;
}

function scorecardCellValue(bucket, col) {
  if (col.kind === "pct") {
    if (col.key === "totalLeadsVsSiteVisitedPct") {
      return formatPct(pct(bucket.siteVisited, bucket.totalLeads));
    }
    if (col.key === "siteVisitScheduledVsSiteVisitedPct") {
      return formatPct(pct(bucket.siteVisited, bucket.siteVisitScheduled));
    }
    return "—";
  }
  return String(bucket?.[col.key] ?? 0);
}

function requiredFieldsForKind(kind) {
  return kind === "master" ? MASTER_FIELDS : HISTORY_FIELDS;
}

function validateColumns(columns, kind) {
  const fields = requiredFieldsForKind(kind);
  const missing = fields.filter(f => !columns[f.id]).map(f => f.label);
  return {ok: missing.length === 0, missing, columns, fields};
}

function sheetRowsFromBuffer(arrayBuffer) {
  if (!window.XLSX) throw new Error("Excel reader failed to load. Check your network connection and reload.");
  const workbook = XLSX.read(arrayBuffer, {type: "array", cellDates: true});
  const candidates = workbook.SheetNames.map(name => {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], {defval: "", raw: true});
    const headers = rows.length ? Object.keys(rows[0]) : [];
    return {name, rows, headers};
  }).filter(c => c.rows.length > 0);
  if (!candidates.length) throw new Error("Workbook has no data rows.");
  return candidates.sort((a, b) => b.rows.length - a.rows.length)[0];
}

function rowObjects(rawRows, columns, fields) {
  const out = [];
  for (const raw of rawRows) {
    const obj = {};
    let blank = true;
    for (const field of fields) {
      const header = columns[field.id];
      const rawVal = header ? raw[header] : "";
      // Keep raw dates for parsing; stringify everything else.
      if (field.id === "registration" || field.id === "next" || field.id === "update") {
        obj[field.id] = rawVal;
        if (rawVal !== "" && rawVal != null) blank = false;
      } else {
        const val = header ? clean(rawVal) : "";
        obj[field.id] = val;
        if (val) blank = false;
      }
    }
    if (blank) continue;
    // Skip Excel totals footer rows
    if (norm(obj.project) === "totals" || norm(obj.telecaller) === "totals" || norm(obj.mobile) === "totals") continue;
    obj.registrationDate = parseDateValue(obj.registration);
    obj.nextDate = parseDateValue(obj.next);
    obj.updateDate = parseDateValue(obj.update);
    obj.telecaller = clean(obj.telecaller);
    obj.mobile = clean(obj.mobile);
    obj.project = clean(obj.project);
    obj.source = clean(obj.source);
    obj.status = clean(obj.status);
    obj.telecallingStatus = clean(obj.telecallingStatus);
    out.push(obj);
  }
  return out;
}

/**
 * Parse Master or History workbook.
 * @param {"master"|"history"} kind
 * @param {ArrayBuffer} arrayBuffer
 */
export function parsePerfWorkbook(kind, arrayBuffer) {
  const sheet = sheetRowsFromBuffer(arrayBuffer);
  const validation = validateColumns(matchColumns(sheet.headers, requiredFieldsForKind(kind)), kind);
  if (!validation.ok) {
    return {
      ok: false,
      kind,
      sheetName: sheet.name,
      rowCount: 0,
      missing: validation.missing,
      rows: [],
    };
  }
  const rows = rowObjects(sheet.rows, validation.columns, validation.fields);
  if (!rows.length) {
    return {ok: false, kind, sheetName: sheet.name, rowCount: 0, missing: ["No data rows"], rows: []};
  }
  return {ok: true, kind, sheetName: sheet.name, rowCount: rows.length, missing: [], rows};
}

function leadMobile(row) {
  let mobile = norm(row.mobile);
  if (/^\d+\.0+$/.test(mobile)) mobile = mobile.replace(/\.0+$/, "");
  // Scientific / float phones from Excel (e.g. 9.535002478e9)
  if (/^\d+(\.\d+)?e\+\d+$/i.test(mobile)) {
    const n = Number(mobile);
    if (Number.isFinite(n)) mobile = String(Math.round(n));
  }
  return mobile;
}

/** Lead identity: Mobile + TeleCaller Name. */
function leadIdentityKey(row) {
  const mobile = leadMobile(row);
  if (!mobile) return "";
  const tc = norm(row.telecaller) || "unknown";
  return `${mobile}|${tc}`;
}

/** STE identity: Mobile + TeleCaller + Project (one enquiry per project). */
function steIdentityKey(row) {
  const mobile = leadMobile(row);
  if (!mobile) return "";
  const tc = norm(row.telecaller) || "unknown";
  const project = norm(row.project) || "";
  return `${mobile}|${tc}|${project}`;
}

/**
 * CRM History exports often leave Mobile/Project blank on continuation rows
 * for the same lead. Carry forward the last non-empty values.
 */
function forwardFillHistoryLeads(historyRows) {
  let lastMobile = "";
  let lastProject = "";
  let lastSource = "";
  let lastTelecaller = "";
  let lastTelecallingStatus = "";
  const out = [];
  for (const row of historyRows) {
    const filled = {...row};
    const mobile = leadMobile(filled);
    const project = clean(filled.project);
    const source = clean(filled.source);
    const telecaller = clean(filled.telecaller);
    const telecallingStatus = clean(filled.telecallingStatus);
    if (mobile) lastMobile = clean(filled.mobile) || mobile;
    if (project) lastProject = project;
    if (source) lastSource = source;
    if (telecaller) lastTelecaller = telecaller;
    if (telecallingStatus) lastTelecallingStatus = telecallingStatus;
    if (!leadMobile(filled) && lastMobile) filled.mobile = lastMobile;
    if (!clean(filled.project) && lastProject) filled.project = lastProject;
    if (!clean(filled.source) && lastSource) filled.source = lastSource;
    if (!clean(filled.telecaller) && lastTelecaller) filled.telecaller = lastTelecaller;
    if (!clean(filled.telecallingStatus) && lastTelecallingStatus) filled.telecallingStatus = lastTelecallingStatus;
    if (!clean(filled.telecaller)) filled.telecaller = "Unknown";
    if (leadMobile(filled)) out.push(filled);
  }
  return out;
}

/** Max Lead Update Date (ms); -1 if missing. */
function ludMs(row) {
  const d = row?.updateDate;
  if (d instanceof Date && !Number.isNaN(d.valueOf())) return d.valueOf();
  const again = parseDateValue(row?.update);
  if (again instanceof Date && !Number.isNaN(again.valueOf())) return again.valueOf();
  return -1;
}

/**
 * One History row per lead (Mobile + TeleCaller): keep max Lead Update Date only.
 */
function collapseHistoryToLatestLead(historyRows) {
  const filled = forwardFillHistoryLeads(historyRows);
  const latest = new Map();
  filled.forEach((row, index) => {
    const key = leadIdentityKey(row);
    if (!key) return;
    const nextLud = ludMs(row);
    const prev = latest.get(key);
    if (!prev) {
      latest.set(key, {row, index, lud: nextLud});
      return;
    }
    if (nextLud > prev.lud || (nextLud === prev.lud && index > prev.index)) {
      latest.set(key, {row, index, lud: nextLud});
    }
  });
  return {
    filledCount: filled.length,
    filled,
    leads: [...latest.values()].map(item => item.row),
  };
}

function matchesSentToEnquiry(status) {
  const s = norm(status);
  return s === "sent to enquiry" || s === "send to enquiry";
}

/** Match History Telecalling Status column (visit statuses — parallel to STE using History Status). */
function matchesTelecallingStatus(row, target) {
  return norm(row.telecallingStatus) === norm(target);
}

/**
 * Count when ANY History row matches Telecalling Status, once per Mobile+TeleCaller+Project.
 * Credits each matching row to all dimension bucket maps.
 */
function accumulateTelecallingStatusMetric(historyFilled, target, bucketMaps, resolvers, field) {
  const best = new Map();
  for (const row of historyFilled) {
    if (!matchesTelecallingStatus(row, target)) continue;
    const key = steIdentityKey(row);
    if (!key) continue;
    const lud = ludMs(row);
    const prev = best.get(key);
    if (!prev || lud > prev.lud) best.set(key, {lud, row});
  }
  for (const {row} of best.values()) {
    for (const {map, resolve} of resolvers) {
      map[resolve(row)][field] += 1;
    }
  }
  return best.size;
}

function createBucketMaps() {
  const maps = {
    byTelecaller: {},
    byProject: {},
    bySource: {},
  };
  const ensure = (map, name) => {
    const display = clean(name) || "Unknown";
    const key = norm(display) || "unknown";
    if (!map[key]) {
      map[key] = emptyTelecallerBucket();
      map[key]._displayName = display;
    } else if (display !== "Unknown" && map[key]._displayName === "Unknown") {
      map[key]._displayName = display;
    }
    return key;
  };
  const resolvers = [
    {map: maps.byTelecaller, resolve: row => ensure(maps.byTelecaller, row.telecaller)},
    {map: maps.byProject, resolve: row => ensure(maps.byProject, row.project)},
    {map: maps.bySource, resolve: row => ensure(maps.bySource, row.source)},
  ];
  const resetVisitCounts = () => {
    for (const map of Object.values(maps)) {
      for (const bucket of Object.values(map)) {
        bucket.notInterested = 0;
        bucket.siteVisitScheduled = 0;
        bucket.siteVisitPending = 0;
        bucket.siteVisitCancelled = 0;
        bucket.siteVisited = 0;
      }
    }
  };
  return {maps, resolvers, resetVisitCounts};
}

function bucketsToDisplay(map) {
  const out = {};
  for (const bucket of Object.values(map)) {
    const name = bucket._displayName || "Unknown";
    delete bucket._displayName;
    out[name] = bucket;
  }
  return out;
}

/**
 * Build performance metrics from parsed Master + History rows.
 * Lead = Mobile + TeleCaller.
 * STE = any History Status Send/Sent to Enquiry, once per Mobile+TeleCaller+Project.
 * SVS/SVP/SVC = any Telecalling Status match (parallel column to STE), once per Mobile+TeleCaller+Project.
 * NI = latest History Status (max LUD), once per lead.
 * @param {object[]} masterRows
 * @param {object[]} historyRows
 */
export function reconcilePerf(masterRows, historyRows) {
  let dateMin = null;
  let dateMax = null;
  for (const row of historyRows) {
    const d = row.updateDate;
    if (!d) continue;
    if (!dateMin || d < dateMin) dateMin = d;
    if (!dateMax || d > dateMax) dateMax = d;
  }

  const {filled: historyFilled, leads: historyLeads} = collapseHistoryToLatestLead(historyRows);

  const {maps, resolvers, resetVisitCounts} = createBucketMaps();
  const {byTelecaller, byProject, bySource} = maps;

  const allMasterKeys = new Set();
  const allHistoryKeys = new Set();
  const today = todayStart();

  for (const row of masterRows) {
    const key = leadIdentityKey(row);
    if (!key) continue;
    for (const {map, resolve} of resolvers) {
      map[resolve(row)]._masterKeys.add(key);
    }
    allMasterKeys.add(key);
    if (row.nextDate && row.nextDate < today) {
      for (const {map, resolve} of resolvers) {
        map[resolve(row)]._overdueKeys.add(key);
      }
    }
  }

  resetVisitCounts();

  // STE: any History row with Status Send/Sent to Enquiry, once per Mobile+TeleCaller+Project.
  const steBest = new Map();
  for (const row of historyFilled) {
    if (!matchesSentToEnquiry(row.status)) continue;
    const key = steIdentityKey(row);
    if (!key) continue;
    const lud = ludMs(row);
    const prev = steBest.get(key);
    if (!prev || lud > prev.lud) steBest.set(key, {lud, row});
  }
  for (const {row} of steBest.values()) {
    for (const {map, resolve} of resolvers) {
      map[resolve(row)].siteVisited += 1;
    }
  }

  const svsKeys = accumulateTelecallingStatusMetric(historyFilled, "site visit scheduled", maps, resolvers, "siteVisitScheduled");
  const svpKeys = accumulateTelecallingStatusMetric(historyFilled, "site visit pending", maps, resolvers, "siteVisitPending");
  const svcKeys = accumulateTelecallingStatusMetric(historyFilled, "site visit cancelled", maps, resolvers, "siteVisitCancelled");
  // #region agent log
  fetch('http://127.0.0.1:7564/ingest/5981bb77-f08e-4f6c-995e-18d8279225fc',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c65e41'},body:JSON.stringify({sessionId:'c65e41',runId:'svs-tcs-ste',hypothesisId:'B',location:'perf-dashboard.js:reconcilePerf',message:'STE-style telecalling status metrics',data:{steKeys:steBest.size,svsKeys,svpKeys,svcKeys,historyFilled:historyFilled.length},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  for (const row of historyLeads) {
    const key = leadIdentityKey(row);
    if (!key) continue;
    for (const {map, resolve} of resolvers) {
      map[resolve(row)]._historyKeys.add(key);
    }
    allHistoryKeys.add(key);

    if (norm(row.status) === "not interested") {
      for (const {map, resolve} of resolvers) {
        map[resolve(row)].notInterested += 1;
      }
    }
  }

  for (const map of Object.values(maps)) {
    for (const bucket of Object.values(map)) finalizeBucket(bucket);
  }

  const byTelecallerDisplay = bucketsToDisplay(byTelecaller);
  const byProjectDisplay = bucketsToDisplay(byProject);
  const bySourceDisplay = bucketsToDisplay(bySource);

  const summary = emptyMetrics();
  summary.activeLeads = allMasterKeys.size;
  summary.totalLeads = new Set([...allMasterKeys, ...allHistoryKeys]).size;
  summary.notInterested = 0;
  summary.siteVisitScheduled = 0;
  summary.siteVisitPending = 0;
  summary.siteVisitCancelled = 0;
  summary.siteVisited = 0;
  summary.overdue = 0;
  for (const bucket of Object.values(byTelecallerDisplay)) {
    summary.notInterested += Number(bucket.notInterested) || 0;
    summary.siteVisitScheduled += Number(bucket.siteVisitScheduled) || 0;
    summary.siteVisitPending += Number(bucket.siteVisitPending) || 0;
    summary.siteVisitCancelled += Number(bucket.siteVisitCancelled) || 0;
    summary.siteVisited += Number(bucket.siteVisited) || 0;
    summary.overdue += Number(bucket.overdue) || 0;
  }

  const pie = {
    notInterested: summary.notInterested,
    siteVisitScheduled: summary.siteVisitScheduled,
    siteVisitPending: summary.siteVisitPending,
    siteVisitCancelled: summary.siteVisitCancelled,
    siteVisited: summary.siteVisited,
    overdue: summary.overdue,
  };

  return {
    summary,
    byTelecaller: byTelecallerDisplay,
    byProject: byProjectDisplay,
    bySource: bySourceDisplay,
    pie,
    dateMin: dateToIso(dateMin),
    dateMax: dateToIso(dateMax),
  };
}

function destroyPerfCharts() {
  for (const chart of perfChartRegistry.values()) {
    try { chart.destroy(); } catch { /* ignore */ }
  }
  perfChartRegistry.clear();
}

function requireChart() {
  const Chart = window.Chart;
  if (typeof Chart !== "function") throw new Error("Chart.js failed to load. Reload the page.");
  return Chart;
}

function baseBarOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {legend: {display: false}},
    scales: {
      x: {grid: {display: false}, ticks: {maxRotation: 45, minRotation: 0, font: {size: 11}}},
      y: {beginAtZero: true, ticks: {precision: 0}},
    },
  };
}

function renderBarChart(canvas, labels, values, color = CHART_COLORS.bar) {
  const Chart = requireChart();
  const id = canvas.id || `perf-bar-${Math.random().toString(36).slice(2)}`;
  canvas.id = id;
  if (perfChartRegistry.has(id)) {
    perfChartRegistry.get(id).destroy();
    perfChartRegistry.delete(id);
  }
  const chart = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: color,
        borderWidth: 0,
        borderRadius: 4,
        maxBarThickness: 42,
      }],
    },
    options: baseBarOptions(),
  });
  perfChartRegistry.set(id, chart);
}

function renderStackedStatusChart(canvas, names, buckets, chartId) {
  const Chart = requireChart();
  const id = chartId || canvas.id || "perf-stacked-status";
  canvas.id = id;
  if (perfChartRegistry.has(id)) {
    perfChartRegistry.get(id).destroy();
    perfChartRegistry.delete(id);
  }
  const datasets = PIE_KEYS.map((key, i) => ({
    label: PIE_LABELS[key],
    data: names.map(name => Number(pieFromBucket(buckets[name])?.[key] || 0)),
    backgroundColor: CHART_COLORS.palette[i % CHART_COLORS.palette.length],
    borderWidth: 0,
    borderRadius: 2,
    maxBarThickness: 48,
  }));
  const chart = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {labels: names, datasets},
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {position: "bottom", labels: {boxWidth: 12, font: {size: 11}}},
      },
      scales: {
        x: {stacked: true, grid: {display: false}, ticks: {maxRotation: 45, minRotation: 0, font: {size: 11}}},
        y: {stacked: true, beginAtZero: true, ticks: {precision: 0}},
      },
    },
  });
  perfChartRegistry.set(id, chart);
}

function getBucketMap(data, dimension) {
  const cfg = PERF_DIMENSIONS[dimension] || PERF_DIMENSIONS.telecaller;
  return data?.[cfg.bucketKey] || {};
}

function filterByTelecaller(data, tcFilter) {
  if (!tcFilter || tcFilter === "__all__") return data;
  const slice = data.byTelecaller?.[tcFilter];
  if (!slice) {
    return {
      ...data,
      summary: emptyMetrics(),
      pie: emptyPie(),
      byTelecaller: {},
    };
  }
  return {
    ...data,
    summary: metricsFromBucket(slice),
    pie: pieFromBucket(slice),
    byTelecaller: {[tcFilter]: slice},
  };
}

function filterPerfData(data, dimension, tcFilter) {
  if (dimension === "telecaller") return filterByTelecaller(data, tcFilter);
  return data;
}

function dimensionNames(data, dimension) {
  const buckets = getBucketMap(data, dimension);
  return Object.keys(buckets).sort((a, b) => a.localeCompare(b, undefined, {sensitivity: "base"}));
}

function renderTotalsBlock(mount, summary, title = "Totals") {
  const block = document.createElement("div");
  block.className = "perf-totals-block";
  const heading = document.createElement("h3");
  heading.textContent = title;
  block.append(heading);
  const list = document.createElement("dl");
  list.className = "perf-summary-list";
  for (const col of SCORECARD_COLUMNS) {
    const row = document.createElement("div");
    row.className = "perf-summary-row";
    const dt = document.createElement("dt");
    dt.textContent = col.label;
    const dd = document.createElement("dd");
    dd.textContent = scorecardCellValue(summary, col);
    row.append(dt, dd);
    list.append(row);
  }
  block.append(list);
  mount.append(block);
}

function renderBreakdownTable(mount, data, dimension) {
  const cfg = PERF_DIMENSIONS[dimension] || PERF_DIMENSIONS.telecaller;
  const buckets = getBucketMap(data, dimension);
  const names = dimensionNames(data, dimension);
  if (!names.length) {
    const empty = document.createElement("div");
    empty.className = "empty-card";
    empty.textContent = `No ${cfg.totalsLabel.toLowerCase()} data.`;
    mount.append(empty);
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "perf-table-wrap";
  const table = document.createElement("table");
  table.className = "perf-scorecard";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const columns = [{key: "name", label: cfg.label, kind: "name"}, ...SCORECARD_COLUMNS];
  for (const col of columns) {
    const th = document.createElement("th");
    th.textContent = col.label;
    headRow.append(th);
  }
  thead.append(headRow);
  table.append(thead);

  const tbody = document.createElement("tbody");
  for (const name of names) {
    const bucket = buckets[name];
    const tr = document.createElement("tr");
    const nameCell = document.createElement("th");
    nameCell.scope = "row";
    nameCell.textContent = name;
    tr.append(nameCell);
    for (const col of SCORECARD_COLUMNS) {
      const td = document.createElement("td");
      td.textContent = scorecardCellValue(bucket, col);
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  wrap.append(table);
  mount.append(wrap);
}

function renderSummaryPanel(mount, data, dimension = "telecaller") {
  mount.replaceChildren();
  const cfg = PERF_DIMENSIONS[dimension] || PERF_DIMENSIONS.telecaller;
  const header = document.createElement("p");
  header.className = "perf-date-range";
  header.textContent = `Report period (from History Lead Update Date): ${formatDisplayDate(data.date_min)} – ${formatDisplayDate(data.date_max)}`;
  mount.append(header);

  const names = dimensionNames(data, dimension);
  let title = `All ${cfg.totalsLabel} · totals`;
  if (names.length === 1) title = `${names[0]} · totals`;
  else if (dimension === "telecaller" && names.length > 1) title = "All TeleCallers · totals";
  renderTotalsBlock(mount, data.summary, title);

  const tableTitle = document.createElement("h3");
  tableTitle.className = "perf-section-title";
  tableTitle.textContent = cfg.tableTitle;
  mount.append(tableTitle);
  renderBreakdownTable(mount, data, dimension);
}

function renderGraphsPanel(mount, data, dimension = "telecaller") {
  destroyPerfCharts();
  mount.replaceChildren();
  const cfg = PERF_DIMENSIONS[dimension] || PERF_DIMENSIONS.telecaller;
  const buckets = getBucketMap(data, dimension);
  const names = dimensionNames(data, dimension);
  if (!names.length) {
    mount.innerHTML = `<div class="empty-card">No ${cfg.totalsLabel.toLowerCase()} data to chart.</div>`;
    return;
  }

  for (const metricKey of METRIC_KEYS) {
    const block = document.createElement("div");
    block.className = "perf-chart-block";
    const title = document.createElement("h3");
    title.textContent = METRIC_LABELS[metricKey];
    block.append(title);
    const wrap = document.createElement("div");
    wrap.className = "perf-chart-wrap";
    const canvas = document.createElement("canvas");
    wrap.append(canvas);
    block.append(wrap);
    mount.append(block);
    const values = names.map(n => Number(buckets[n]?.[metricKey] || 0));
    renderBarChart(canvas, names, values);
  }

  for (const pctKey of PCT_KEYS) {
    const block = document.createElement("div");
    block.className = "perf-chart-block";
    const title = document.createElement("h3");
    title.textContent = PCT_LABELS[pctKey];
    block.append(title);
    const wrap = document.createElement("div");
    wrap.className = "perf-chart-wrap";
    const canvas = document.createElement("canvas");
    wrap.append(canvas);
    block.append(wrap);
    mount.append(block);
    const values = names.map(n => {
      const b = buckets[n] || emptyMetrics();
      if (pctKey === "totalLeadsVsSiteVisitedPct") return pct(b.siteVisited, b.totalLeads) ?? 0;
      return pct(b.siteVisited, b.siteVisitScheduled) ?? 0;
    });
    renderBarChart(canvas, names, values, "#2a5f9e");
  }

  const statusSection = document.createElement("div");
  statusSection.className = "perf-stacked-section";
  const statusHeading = document.createElement("h3");
  statusHeading.className = "perf-section-title";
  statusHeading.textContent = names.length === 1
    ? "Status breakdown"
    : `Status breakdown by ${cfg.label}`;
  statusSection.append(statusHeading);

  const statusWrap = document.createElement("div");
  statusWrap.className = names.length >= 18
    ? "perf-chart-wrap perf-stacked-chart-wrap perf-stacked-chart-wrap-wide"
    : "perf-chart-wrap perf-stacked-chart-wrap";
  const statusCanvas = document.createElement("canvas");
  statusWrap.append(statusCanvas);
  statusSection.append(statusWrap);
  mount.append(statusSection);
  renderStackedStatusChart(statusCanvas, names, buckets, `perf-stacked-${dimension}`);
}

function wireDropZone(zone, input, onFiles) {
  if (!zone || !input) return;
  zone.onclick = () => input.click();
  zone.onkeydown = e => { if (["Enter", " "].includes(e.key)) input.click(); };
  for (const ev of ["dragenter", "dragover"]) {
    zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add("dragover"); });
  }
  for (const ev of ["dragleave", "drop"]) {
    zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove("dragover"); });
  }
  zone.addEventListener("drop", e => onFiles(e.dataTransfer?.files));
  input.onchange = () => onFiles(input.files);
}

function renderPerfPreview(panel, reconciled) {
  const mount = panel.querySelector("#perf-preview-summary");
  if (!mount) return;
  renderSummaryPanel(mount, {
    summary: reconciled.summary,
    byTelecaller: reconciled.byTelecaller,
    pie: reconciled.pie,
    date_min: reconciled.dateMin,
    date_max: reconciled.dateMax,
  });
  const tcList = panel.querySelector("#perf-preview-telecallers");
  if (tcList) {
    const names = Object.keys(reconciled.byTelecaller).sort((a, b) => a.localeCompare(b, undefined, {sensitivity: "base"}));
    tcList.textContent = names.length
      ? `${names.length} TeleCaller${names.length === 1 ? "" : "s"}: ${names.join(", ")}`
      : "No TeleCallers found.";
  }
  panel.querySelector("#perf-collapse-debug")?.remove();
}

function updatePerfValidation(el, messages, isError) {
  if (!el) return;
  if (!messages.length) {
    el.classList.add("hidden");
    el.textContent = "";
    el.classList.remove("error");
    return;
  }
  el.classList.remove("hidden");
  el.classList.toggle("error", Boolean(isError));
  el.textContent = messages.join(" · ");
}

/**
 * Wire upload view (#view-perf-report).
 * @param {{hasPermission: Function, toast: Function, showView: Function}} ctx
 */
export function mountPerfReportUpload(ctx) {
  const {hasPermission, toast, showView} = ctx;
  const masterDrop = document.getElementById("perf-master-drop");
  const historyDrop = document.getElementById("perf-history-drop");
  const masterInput = document.getElementById("perf-master-input");
  const historyInput = document.getElementById("perf-history-input");
  const fileList = document.getElementById("perf-file-list");
  const validation = document.getElementById("perf-validation");
  const createBtn = document.getElementById("perf-create-dashboard");
  const previewPanel = document.getElementById("perf-preview-panel");
  const uploadBtn = document.getElementById("perf-upload-dashboard-btn");
  const modal = document.getElementById("perf-upload-dashboard-modal");
  const tcList = document.getElementById("perf-upload-telecaller-list");
  const confirmBtn = document.getElementById("perf-upload-dash-confirm");
  const cancelBtn = document.getElementById("perf-upload-dash-cancel");
  const modalMsg = document.getElementById("perf-upload-dash-message");

  let masterParsed = null;
  let historyParsed = null;

  function renderFileList() {
    if (!fileList) return;
    const items = [];
    if (masterParsed?.ok) items.push(`Master (${masterParsed.sheetName}): ${masterParsed.rowCount} rows`);
    else if (masterParsed) items.push(`Master: invalid — missing ${masterParsed.missing.join(", ")}`);
    if (historyParsed?.ok) items.push(`History (${historyParsed.sheetName}): ${historyParsed.rowCount} rows`);
    else if (historyParsed) items.push(`History: invalid — missing ${historyParsed.missing.join(", ")}`);
    if (!items.length) {
      fileList.classList.add("hidden");
      fileList.replaceChildren();
      return;
    }
    fileList.classList.remove("hidden");
    fileList.replaceChildren();
    for (const text of items) {
      const card = document.createElement("div");
      card.className = "file-card";
      card.innerHTML = `<div><span class="file-icon">M</span><div><strong>${text.split(":")[0]}</strong><p>${text.includes(":") ? text.slice(text.indexOf(":") + 1).trim() : ""}</p></div></div>`;
      fileList.append(card);
    }
  }

  function syncCreateState() {
    const ready = masterParsed?.ok && historyParsed?.ok;
    if (createBtn) createBtn.disabled = !ready;
    if (ready) {
      updatePerfValidation(validation, [`Ready — ${masterParsed.rowCount} master rows, ${historyParsed.rowCount} history rows`], false);
    } else {
      const msgs = [];
      if (masterParsed && !masterParsed.ok) msgs.push(`Master missing: ${masterParsed.missing.join(", ")}`);
      if (historyParsed && !historyParsed.ok) msgs.push(`History missing: ${historyParsed.missing.join(", ")}`);
      if (!masterParsed && !historyParsed) msgs.push("Upload Master and History Excel files.");
      updatePerfValidation(validation, msgs, msgs.some(m => m.includes("missing")));
    }
  }

  async function loadFile(kind, file) {
    if (!file) return;
    try {
      const parsed = parsePerfWorkbook(kind, await file.arrayBuffer());
      if (kind === "master") masterParsed = parsed;
      else historyParsed = parsed;
      perfReconciled = null;
      previewPanel?.classList.add("hidden");
      if (uploadBtn) uploadBtn.disabled = true;
    } catch (err) {
      toast(err.message || "Could not read Excel");
      if (kind === "master") masterParsed = {ok: false, missing: [err.message], rowCount: 0};
      else historyParsed = {ok: false, missing: [err.message], rowCount: 0};
    }
    renderFileList();
    syncCreateState();
  }

  function handleFiles(kind, files) {
    const file = files?.[0];
    if (file) loadFile(kind, file);
  }

  wireDropZone(masterDrop, masterInput, files => handleFiles("master", files));
  wireDropZone(historyDrop, historyInput, files => handleFiles("history", files));

  createBtn?.addEventListener("click", () => {
    if (!masterParsed?.ok || !historyParsed?.ok) return;
    perfReconciled = reconcilePerf(masterParsed.rows, historyParsed.rows);
    previewPanel?.classList.remove("hidden");
    renderPerfPreview(previewPanel, perfReconciled);
    if (uploadBtn) {
      uploadBtn.disabled = !hasPermission("telecaller.perf_upload");
      if (!hasPermission("telecaller.perf_upload")) uploadBtn.title = "Upload not permitted for your role.";
    }
  });

  function openUploadModal() {
    if (!hasPermission("telecaller.perf_upload")) {
      toast("Upload not permitted for your role.");
      return;
    }
    if (!perfReconciled) {
      toast("Create a dashboard first.");
      return;
    }
    if (!modal || !tcList) return;
    tcList.replaceChildren();
    const names = Object.keys(perfReconciled.byTelecaller).sort((a, b) => a.localeCompare(b, undefined, {sensitivity: "base"}));
    if (!names.length) {
      tcList.innerHTML = '<p class="muted">No TeleCaller names found.</p>';
    } else {
      for (const name of names) {
        const label = document.createElement("label");
        label.className = "check-row";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.value = name;
        input.checked = true;
        const span = document.createElement("span");
        span.textContent = name;
        label.append(input, span);
        tcList.append(label);
      }
    }
    if (modalMsg) modalMsg.textContent = "";
    modal.classList.remove("hidden");
  }

  function closeUploadModal() {
    modal?.classList.add("hidden");
  }

  uploadBtn?.addEventListener("click", openUploadModal);
  cancelBtn?.addEventListener("click", closeUploadModal);

  confirmBtn?.addEventListener("click", async () => {
    if (!perfReconciled) return;
    const selected = [...(tcList?.querySelectorAll("input[type=checkbox]:checked") || [])].map(i => i.value);
    if (!selected.length) {
      if (modalMsg) modalMsg.textContent = "Select at least one TeleCaller.";
      return;
    }
    const dashboards = selected.map(name => {
      const bucket = perfReconciled.byTelecaller[name] || emptyTelecallerBucket();
      return {
        telecaller_name: name,
        title: `${name} · Performance`,
        summary: metricsFromBucket(bucket),
        byTelecaller: {[name]: bucket},
        byProject: perfReconciled.byProject,
        bySource: perfReconciled.bySource,
        pie: pieFromBucket(bucket),
        date_min: perfReconciled.dateMin,
        date_max: perfReconciled.dateMax,
      };
    });
    if (modalMsg) modalMsg.textContent = "Uploading…";
    try {
      const data = await PerfDashboardApi.publish(dashboards);
      const n = (data.published || []).length;
      toast(n === 1 ? "Performance dashboard uploaded" : `Uploaded ${n} performance dashboards`);
      closeUploadModal();
      if (hasPermission("telecaller.perf_dashboard")) {
        location.hash = "#perf-dashboard";
        showView("perf-dashboard");
        await refreshPerfPublished();
      }
    } catch (err) {
      if (modalMsg) modalMsg.textContent = err.message || "Upload failed";
    }
  });

  perfUploadHandlers = {syncCreateState};
}

let perfCombinedCache = null;
let perfActiveTab = "summary";
let perfActiveDimension = "telecaller";
let perfTcFilter = "__all__";

function getFilteredPerfData() {
  if (!perfCombinedCache) return null;
  return filterPerfData(perfCombinedCache, perfActiveDimension, perfTcFilter);
}

function renderActivePerfPanels() {
  const filtered = getFilteredPerfData();
  if (!filtered) return;
  renderSummaryPanel(document.getElementById("perf-tab-summary"), filtered, perfActiveDimension);
  if (perfActiveTab === "graphs") {
    renderGraphsPanel(document.getElementById("perf-tab-graphs"), filtered, perfActiveDimension);
  }
}

function setPerfDimension(dimension) {
  const next = PERF_DIMENSIONS[dimension] ? dimension : "telecaller";
  perfActiveDimension = next;
  document.querySelectorAll(".perf-dimension-tabs [data-perf-dimension]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.perfDimension === next);
    btn.setAttribute("aria-selected", btn.dataset.perfDimension === next ? "true" : "false");
  });
  const {filterRow} = perfPublishedHandlers || {};
  const showFilter = Boolean(
    perfPublishedHandlers?.canViewAll?.()
    && perfCombinedCache?.view_all
    && next === "telecaller",
  );
  filterRow?.classList.toggle("hidden", !showFilter);
  renderActivePerfPanels();
}

function setPerfTab(tab) {
  perfActiveTab = tab;
  document.querySelectorAll(".perf-view-tabs [data-perf-tab]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.perfTab === tab);
    btn.setAttribute("aria-selected", btn.dataset.perfTab === tab ? "true" : "false");
  });
  document.getElementById("perf-tab-summary")?.classList.toggle("hidden", tab !== "summary");
  document.getElementById("perf-tab-graphs")?.classList.toggle("hidden", tab !== "graphs");
  if (tab === "graphs" && perfCombinedCache) {
    renderGraphsPanel(
      document.getElementById("perf-tab-graphs"),
      getFilteredPerfData(),
      perfActiveDimension,
    );
  }
}

/**
 * Wire published dashboard view (#view-perf-dashboard).
 * @param {{hasPermission: Function, canViewAll: Function}} ctx
 */
export function mountPerfPublishedDashboard(ctx) {
  const {canViewAll} = ctx;
  document.querySelectorAll(".perf-view-tabs [data-perf-tab]").forEach(btn => {
    btn.addEventListener("click", () => setPerfTab(btn.dataset.perfTab || "summary"));
  });
  document.querySelectorAll(".perf-dimension-tabs [data-perf-dimension]").forEach(btn => {
    btn.addEventListener("click", () => setPerfDimension(btn.dataset.perfDimension || "telecaller"));
  });
  document.getElementById("refresh-perf-published")?.addEventListener("click", () => refreshPerfPublished());

  const filterRow = document.getElementById("perf-filter-row");
  const filterSelect = document.getElementById("perf-tc-filter");
  const dimensionTabs = document.querySelector(".perf-dimension-tabs");
  filterSelect?.addEventListener("change", () => {
    perfTcFilter = filterSelect.value || "__all__";
    if (!perfCombinedCache) return;
    renderActivePerfPanels();
  });

  perfPublishedHandlers = {canViewAll, filterRow, filterSelect, dimensionTabs};
}

export async function refreshPerfPublished() {
  const empty = document.getElementById("perf-published-empty");
  const panel = document.getElementById("perf-published-panel");
  const titleEl = document.getElementById("perf-published-title");
  const metaEl = document.getElementById("perf-published-meta");
  const summaryMount = document.getElementById("perf-tab-summary");
  const graphsMount = document.getElementById("perf-tab-graphs");
  const {filterRow, filterSelect, canViewAll, dimensionTabs} = perfPublishedHandlers || {};

  destroyPerfCharts();
  try {
    const data = await PerfDashboardApi.combined();
    const hasData = Object.keys(data.byTelecaller || {}).length > 0
      || METRIC_KEYS.some(k => Number(data.summary?.[k] || 0) > 0);
    if (!hasData) {
      empty?.classList.remove("hidden");
      if (empty) empty.textContent = "No published performance dashboards yet.";
      panel?.classList.add("hidden");
      perfCombinedCache = null;
      return;
    }
    empty?.classList.add("hidden");
    panel?.classList.remove("hidden");
    perfCombinedCache = data;

    if (titleEl) titleEl.textContent = data.title || "Performance Dashboard";
    if (metaEl) {
      const when = data.updated_at
        ? new Date(String(data.updated_at).endsWith("Z") ? data.updated_at : data.updated_at + "Z").toLocaleString()
        : "";
      const count = (data.dashboards || []).length;
      metaEl.textContent = data.view_all
        ? `Combined · ${count} TeleCaller${count === 1 ? "" : "s"}${when ? " · updated " + when : ""}`
        : `Your board${when ? " · updated " + when : ""}`;
    }

    const showAdminControls = Boolean(canViewAll?.() && data.view_all);
    dimensionTabs?.classList.toggle("hidden", !showAdminControls);
    if (!showAdminControls && perfActiveDimension !== "telecaller") {
      perfActiveDimension = "telecaller";
    }
    document.querySelectorAll(".perf-dimension-tabs [data-perf-dimension]").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.perfDimension === perfActiveDimension);
      btn.setAttribute("aria-selected", btn.dataset.perfDimension === perfActiveDimension ? "true" : "false");
    });

    const showFilter = showAdminControls && perfActiveDimension === "telecaller";
    filterRow?.classList.toggle("hidden", !showFilter);
    if (showFilter && filterSelect) {
      const names = Object.keys(data.byTelecaller || {}).sort((a, b) => a.localeCompare(b, undefined, {sensitivity: "base"}));
      const prev = perfTcFilter;
      filterSelect.replaceChildren();
      const allOpt = document.createElement("option");
      allOpt.value = "__all__";
      allOpt.textContent = "All TeleCallers";
      filterSelect.append(allOpt);
      for (const name of names) {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        filterSelect.append(opt);
      }
      perfTcFilter = names.includes(prev) ? prev : "__all__";
      filterSelect.value = perfTcFilter;
    } else {
      perfTcFilter = "__all__";
    }

    if (summaryMount) renderSummaryPanel(summaryMount, getFilteredPerfData(), perfActiveDimension);
    if (perfActiveTab === "graphs" && graphsMount) {
      renderGraphsPanel(graphsMount, getFilteredPerfData(), perfActiveDimension);
    }
    setPerfTab(perfActiveTab);
  } catch (err) {
    empty?.classList.remove("hidden");
    if (empty) empty.textContent = err.message || "Could not load performance dashboards.";
    panel?.classList.add("hidden");
  }
}

export function destroyPerfDashboard() {
  destroyPerfCharts();
}

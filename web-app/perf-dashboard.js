/**
 * TeleCalling Performance — Excel parse, metrics engine, published dashboard UI.
 */
import {PerfDashboardApi} from "./api-client.js?v=6.0.0.dev";
import {downloadBlobFile} from "./audit.js?v=6.0.0.dev";

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
];

/** Count metrics stored per telecaller / summary. */
const METRIC_KEYS = [
  "totalLeads",
  "activeLeads",
  "totalCalls",
  "notFollowupLeads",
  "draftLeads",
  "siteVisited",
  "siteVisitScheduled",
  "siteVisitPending",
  "siteVisitCancelled",
  "notInterested",
  "overdue",
];
const METRIC_LABELS = {
  totalLeads: "Total Leads",
  activeLeads: "Active Leads",
  totalCalls: "Total Calls",
  notFollowupLeads: "Not Follow-up Leads",
  draftLeads: "Draft Leads",
  siteVisited: "Site Visited",
  siteVisitScheduled: "Site Visit Scheduled",
  siteVisitPending: "Site Visit Pending",
  siteVisitCancelled: "Site Visit Cancelled",
  notInterested: "Not Interested",
  overdue: "Overdue Leads",
};

/** Derived average columns (not summed across rows). */
const AVG_KEYS = ["avgCallsPerDay"];
const AVG_LABELS = {
  avgCallsPerDay: "Avg Calls per Day",
};

/** Percentage columns derived for the scorecard (not summed across telecallers). */
const PCT_KEYS = ["totalLeadsVsSiteVisitedPct"];
const PCT_LABELS = {
  totalLeadsVsSiteVisitedPct: "Total Leads vs Site Visited",
};

/** Scorecard column order (matches operator report). */
const SCORECARD_COLUMNS = [
  {key: "totalLeads", label: METRIC_LABELS.totalLeads, kind: "count"},
  {key: "activeLeads", label: METRIC_LABELS.activeLeads, kind: "count"},
  {key: "totalCalls", label: METRIC_LABELS.totalCalls, kind: "count"},
  {key: "avgCallsPerDay", label: AVG_LABELS.avgCallsPerDay, kind: "avg"},
  {key: "draftLeads", label: METRIC_LABELS.draftLeads, kind: "count"},
  {key: "notFollowupLeads", label: METRIC_LABELS.notFollowupLeads, kind: "count"},
  {key: "siteVisited", label: METRIC_LABELS.siteVisited, kind: "count"},
  {key: "siteVisitScheduled", label: METRIC_LABELS.siteVisitScheduled, kind: "count"},
  {key: "siteVisitPending", label: METRIC_LABELS.siteVisitPending, kind: "count"},
  {key: "siteVisitCancelled", label: METRIC_LABELS.siteVisitCancelled, kind: "count"},
  {key: "notInterested", label: METRIC_LABELS.notInterested, kind: "count"},
  {key: "totalLeadsVsSiteVisitedPct", label: PCT_LABELS.totalLeadsVsSiteVisitedPct, kind: "pct"},
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

function cssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function chartColors() {
  return {
    bar: cssVar("--chart-bar", "#1f5d45"),
    palette: [
      cssVar("--chart-1", "#12372a"),
      cssVar("--chart-2", "#1f5d45"),
      cssVar("--chart-3", "#3f8c68"),
      cssVar("--chart-4", "#c57924"),
      cssVar("--chart-5", "#a33a32"),
      cssVar("--chart-6", "#2a5f9e"),
      cssVar("--chart-7", "#6c7771"),
      cssVar("--chart-8", "#9bb7a8"),
    ],
  };
}

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
    totalCalls: 0,
    notFollowupLeads: 0,
    draftLeads: 0,
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

const PERF_DETAIL_METRIC_KEYS = [
  "totalLeads",
  "activeLeads",
  "totalCalls",
  "draftLeads",
  "notFollowupLeads",
  "siteVisited",
  "siteVisitScheduled",
  "siteVisitPending",
  "siteVisitCancelled",
  "notInterested",
  "overdue",
];

const PERF_DETAIL_COLUMNS = [
  ["Mobile", "mobile"],
  ["Telecaller", "telecaller"],
  ["Project", "project"],
  ["Source", "source"],
  ["Status", "status"],
  ["Registration", "registration"],
  ["Next Followup", "nextFollowup"],
  ["Update Date", "updateDate"],
];

function emptyTelecallerBucket() {
  return {
    ...emptyMetrics(),
    pie: emptyPie(),
    details: {},
    _masterKeys: new Set(),
    _historyKeys: new Set(),
    _overdueKeys: new Set(),
    _draftKeys: new Set(),
    _notFollowupKeys: new Set(),
    _leadMasterRow: {},
    _leadHistoryRow: {},
    _details: null,
    _detailKeys: null,
  };
}

function serializePerfDetail(row) {
  return {
    mobile: clean(row.mobile) || "",
    telecaller: clean(row.telecaller) || "",
    project: clean(row.project) || "",
    source: clean(row.source) || "",
    status: clean(row.status) || "",
    registration: formatDisplayDate(dateToIso(row.registrationDate)),
    nextFollowup: formatDisplayDate(dateToIso(row.nextDate)),
    updateDate: formatDisplayDate(dateToIso(row.updateDate)),
  };
}

function ensureBucketDetails(bucket) {
  if (!bucket._details) {
    bucket._details = Object.fromEntries(PERF_DETAIL_METRIC_KEYS.map(k => [k, []]));
  }
  return bucket._details;
}

function pushBucketDetail(bucket, metricKey, row) {
  if (!bucket || !row || !PERF_DETAIL_METRIC_KEYS.includes(metricKey)) return;
  ensureBucketDetails(bucket)[metricKey].push(serializePerfDetail(row));
}

function pushBucketDetailOnce(bucket, metricKey, row, dedupeKey) {
  if (!dedupeKey) return;
  if (!bucket._detailKeys) bucket._detailKeys = {};
  if (!bucket._detailKeys[metricKey]) bucket._detailKeys[metricKey] = new Set();
  if (bucket._detailKeys[metricKey].has(dedupeKey)) return;
  bucket._detailKeys[metricKey].add(dedupeKey);
  pushBucketDetail(bucket, metricKey, row);
}

function pushBucketDetailToResolvers(resolvers, row, metricKey) {
  for (const {map, resolve} of resolvers) {
    pushBucketDetail(map[resolve(row)], metricKey, row);
  }
}

function getMetricDetails(bucket, metricKey) {
  const details = bucket?.details?.[metricKey];
  return Array.isArray(details) ? details : [];
}

function mergeMetricDetails(buckets, names, metricKey) {
  const out = [];
  for (const name of names || []) {
    out.push(...getMetricDetails(buckets?.[name], metricKey));
  }
  return out;
}

function detailMetricKey(col) {
  if (col.key === "avgCallsPerDay") return "totalCalls";
  if (col.key === "totalLeadsVsSiteVisitedPct") return "siteVisited";
  if (col.kind === "count") return col.key;
  return null;
}

function metricCellIsClickable(bucket, col, reportDays) {
  const metricKey = detailMetricKey(col);
  if (!metricKey) return false;
  const display = scorecardCellValue(bucket, col, reportDays);
  if (display === "—" || display === "0") return false;
  if (col.kind === "pct" && !(Number(bucket?.siteVisited) > 0)) return false;
  return true;
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

function formatAvg(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return String(Math.round(Number(value)));
}

/** Inclusive calendar days between History min/max LUD (from ISO date strings). */
function reportDayCount(dateMinIso, dateMaxIso) {
  const min = parseDateValue(dateMinIso);
  const max = parseDateValue(dateMaxIso);
  if (!min || !max) return 0;
  const start = new Date(min);
  const end = new Date(max);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return Math.floor((end - start) / 86400000) + 1;
}

function avgCallsPerDay(totalCalls, reportDays) {
  const calls = Number(totalCalls) || 0;
  const days = Number(reportDays) || 0;
  if (days <= 0) return null;
  return Math.round(calls / days);
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
  bucket.draftLeads = (bucket._draftKeys || new Set()).size;
  bucket.notFollowupLeads = (bucket._notFollowupKeys || new Set()).size;
  const details = ensureBucketDetails(bucket);
  const totalLeadKeys = new Set();
  for (const key of union) {
    if (totalLeadKeys.has(key)) continue;
    totalLeadKeys.add(key);
    const row = bucket._leadHistoryRow?.[key] || bucket._leadMasterRow?.[key];
    if (row) details.totalLeads.push(serializePerfDetail(row));
  }
  bucket.details = bucket._details || {};
  delete bucket._details;
  delete bucket._detailKeys;
  delete bucket._leadMasterRow;
  delete bucket._leadHistoryRow;
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
  delete bucket._draftKeys;
  delete bucket._notFollowupKeys;
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

function scorecardCellValue(bucket, col, reportDays = 0) {
  if (col.kind === "pct") {
    if (col.key === "totalLeadsVsSiteVisitedPct") {
      return formatPct(pct(bucket.siteVisited, bucket.totalLeads));
    }
    return "—";
  }
  if (col.kind === "avg") {
    if (col.key === "avgCallsPerDay") {
      return formatAvg(avgCallsPerDay(bucket?.totalCalls, reportDays));
    }
    return "—";
  }
  return String(bucket?.[col.key] ?? 0);
}

function sumBucketMetrics(buckets, names) {
  const out = emptyMetrics();
  for (const name of names) {
    const bucket = buckets[name];
    if (!bucket) continue;
    for (const key of METRIC_KEYS) out[key] += Number(bucket[key] || 0);
  }
  return out;
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
  const out = [];
  for (const row of historyRows) {
    const filled = {...row};
    const mobile = leadMobile(filled);
    const project = clean(filled.project);
    const source = clean(filled.source);
    const telecaller = clean(filled.telecaller);
    if (mobile) lastMobile = clean(filled.mobile) || mobile;
    if (project) lastProject = project;
    if (source) lastSource = source;
    if (telecaller) lastTelecaller = telecaller;
    if (!leadMobile(filled) && lastMobile) filled.mobile = lastMobile;
    if (!clean(filled.project) && lastProject) filled.project = lastProject;
    if (!clean(filled.source) && lastSource) filled.source = lastSource;
    if (!clean(filled.telecaller) && lastTelecaller) filled.telecaller = lastTelecaller;
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

/**
 * One History row per Mobile+TeleCaller+Project: keep max Lead Update Date only.
 */
function latestRowPerSteKey(historyFilled) {
  const latest = new Map();
  historyFilled.forEach((row, index) => {
    const key = steIdentityKey(row);
    if (!key) return;
    const nextLud = ludMs(row);
    const prev = latest.get(key);
    if (!prev || nextLud > prev.lud || (nextLud === prev.lud && index > prev.index)) {
      latest.set(key, {row, index, lud: nextLud});
    }
  });
  return [...latest.values()].map(item => item.row);
}

function matchesSiteVisitScheduled(status) {
  return norm(status) === "site visit scheduled";
}

function matchesSentToEnquiry(status) {
  const s = norm(status);
  return s === "sent to enquiry" || s === "send to enquiry";
}

/** Match History Status on any row (visit statuses — parallel to STE). */
function matchesHistoryStatus(row, target) {
  return norm(row.status) === norm(target);
}

/**
 * Count when ANY History row matches Status, once per Mobile+TeleCaller+Project.
 * Credits each matching row to all dimension bucket maps.
 */
function accumulateAnyRowStatusMetric(historyFilled, target, bucketMaps, resolvers, field) {
  const best = new Map();
  for (const row of historyFilled) {
    if (!matchesHistoryStatus(row, target)) continue;
    const key = steIdentityKey(row);
    if (!key) continue;
    const lud = ludMs(row);
    const prev = best.get(key);
    if (!prev || lud > prev.lud) best.set(key, {lud, row});
  }
  for (const {row} of best.values()) {
    for (const {map, resolve} of resolvers) {
      const bucket = map[resolve(row)];
      bucket[field] += 1;
      pushBucketDetailOnce(bucket, field, row, steIdentityKey(row));
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
  /** Flat compound maps: telecaller×project / telecaller×source for per-TC publish payloads. */
  const byTcProjectFlat = {};
  const byTcSourceFlat = {};
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
  const ensureCompound = (map, tcName, dimName) => {
    const tcDisplay = clean(tcName) || "Unknown";
    const dimDisplay = clean(dimName) || "Unknown";
    const tcKey = norm(tcDisplay) || "unknown";
    const dimKey = norm(dimDisplay) || "unknown";
    const key = `${tcKey}\0${dimKey}`;
    if (!map[key]) {
      map[key] = emptyTelecallerBucket();
      map[key]._tcDisplay = tcDisplay;
      map[key]._dimDisplay = dimDisplay;
    } else {
      if (tcDisplay !== "Unknown" && map[key]._tcDisplay === "Unknown") map[key]._tcDisplay = tcDisplay;
      if (dimDisplay !== "Unknown" && map[key]._dimDisplay === "Unknown") map[key]._dimDisplay = dimDisplay;
    }
    return key;
  };
  const resolvers = [
    {map: maps.byTelecaller, resolve: row => ensure(maps.byTelecaller, row.telecaller)},
    {map: maps.byProject, resolve: row => ensure(maps.byProject, row.project)},
    {map: maps.bySource, resolve: row => ensure(maps.bySource, row.source)},
    {map: byTcProjectFlat, resolve: row => ensureCompound(byTcProjectFlat, row.telecaller, row.project)},
    {map: byTcSourceFlat, resolve: row => ensureCompound(byTcSourceFlat, row.telecaller, row.source)},
  ];
  const allMaps = () => [...Object.values(maps), byTcProjectFlat, byTcSourceFlat];
  const resetVisitCounts = () => {
    for (const map of allMaps()) {
      for (const bucket of Object.values(map)) {
        bucket.notInterested = 0;
        bucket.siteVisitScheduled = 0;
        bucket.siteVisitPending = 0;
        bucket.siteVisitCancelled = 0;
        bucket.siteVisited = 0;
      }
    }
  };
  return {maps, byTcProjectFlat, byTcSourceFlat, resolvers, resetVisitCounts, allMaps};
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

/** Group compound telecaller×dimension buckets into { telecallerName: { dimName: metrics } }. */
function compoundBucketsToNested(map) {
  const out = {};
  for (const bucket of Object.values(map)) {
    const tc = bucket._tcDisplay || "Unknown";
    const dim = bucket._dimDisplay || "Unknown";
    delete bucket._tcDisplay;
    delete bucket._dimDisplay;
    if (!out[tc]) out[tc] = {};
    out[tc][dim] = bucket;
  }
  return out;
}

/**
 * Build performance metrics from parsed Master + History rows.
 * Lead = Mobile + TeleCaller.
 * STE = any History Status Send/Sent to Enquiry, once per Mobile+TeleCaller+Project.
 * SVS = latest History Status per Mobile+TeleCaller+Project (Site Visit Scheduled).
 * SVP/SVC = any History Status match, once per Mobile+TeleCaller+Project.
 * NI = latest History Status (max LUD), once per lead.
 * Total Calls = History row count (after forward-fill).
 * Avg Calls per Day = Total Calls ÷ inclusive days between min/max History LUD.
 * Draft Leads = Master leads (Mobile+TeleCaller) with Status Draft.
 * Not Follow-up Leads = Master leads not in History, Status ≠ Draft.
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
  const reportDays = reportDayCount(dateToIso(dateMin), dateToIso(dateMax));

  const {maps, byTcProjectFlat, byTcSourceFlat, resolvers, resetVisitCounts, allMaps} = createBucketMaps();
  const {byTelecaller, byProject, bySource} = maps;

  const allMasterKeys = new Set();
  const allHistoryKeys = new Set();
  const allHistoryLeadKeys = new Set();
  const today = todayStart();

  for (const row of historyFilled) {
    const key = leadIdentityKey(row);
    if (key) allHistoryLeadKeys.add(key);
  }

  for (const row of masterRows) {
    const key = leadIdentityKey(row);
    if (!key) continue;
    for (const {map, resolve} of resolvers) {
      const bucket = map[resolve(row)];
      bucket._masterKeys.add(key);
      bucket._leadMasterRow[key] = row;
    }
    allMasterKeys.add(key);
    if (norm(row.status) === "draft") {
      for (const {map, resolve} of resolvers) {
        const bucket = map[resolve(row)];
        bucket._draftKeys.add(key);
        pushBucketDetailOnce(bucket, "draftLeads", row, key);
      }
    }
    if (!allHistoryLeadKeys.has(key) && norm(row.status) !== "draft") {
      for (const {map, resolve} of resolvers) {
        const bucket = map[resolve(row)];
        bucket._notFollowupKeys.add(key);
        pushBucketDetailOnce(bucket, "notFollowupLeads", row, key);
      }
    }
    if (row.nextDate && row.nextDate < today) {
      for (const {map, resolve} of resolvers) {
        const bucket = map[resolve(row)];
        bucket._overdueKeys.add(key);
        pushBucketDetailOnce(bucket, "overdue", row, key);
      }
    }
    for (const {map, resolve} of resolvers) {
      pushBucketDetailOnce(map[resolve(row)], "activeLeads", row, key);
    }
  }

  for (const row of historyFilled) {
    for (const {map, resolve} of resolvers) {
      const bucket = map[resolve(row)];
      bucket.totalCalls += 1;
      pushBucketDetail(bucket, "totalCalls", row);
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
      const bucket = map[resolve(row)];
      bucket.siteVisited += 1;
      pushBucketDetailOnce(bucket, "siteVisited", row, steIdentityKey(row));
    }
  }

  // SVS: latest History Status per Mobile+TeleCaller+Project.
  for (const row of latestRowPerSteKey(historyFilled)) {
    if (!matchesSiteVisitScheduled(row.status)) continue;
    for (const {map, resolve} of resolvers) {
      const bucket = map[resolve(row)];
      bucket.siteVisitScheduled += 1;
      pushBucketDetailOnce(bucket, "siteVisitScheduled", row, steIdentityKey(row));
    }
  }

  accumulateAnyRowStatusMetric(historyFilled, "site visit pending", maps, resolvers, "siteVisitPending");
  accumulateAnyRowStatusMetric(historyFilled, "site visit cancelled", maps, resolvers, "siteVisitCancelled");

  for (const row of historyLeads) {
    const key = leadIdentityKey(row);
    if (!key) continue;
    for (const {map, resolve} of resolvers) {
      const bucket = map[resolve(row)];
      bucket._historyKeys.add(key);
      bucket._leadHistoryRow[key] = row;
    }
    allHistoryKeys.add(key);

    if (norm(row.status) === "not interested") {
      for (const {map, resolve} of resolvers) {
        const bucket = map[resolve(row)];
        bucket.notInterested += 1;
        pushBucketDetailOnce(bucket, "notInterested", row, key);
      }
    }
  }

  for (const map of allMaps()) {
    for (const bucket of Object.values(map)) finalizeBucket(bucket);
  }

  const byTelecallerDisplay = bucketsToDisplay(byTelecaller);
  const byProjectDisplay = bucketsToDisplay(byProject);
  const bySourceDisplay = bucketsToDisplay(bySource);
  const byTelecallerProject = compoundBucketsToNested(byTcProjectFlat);
  const byTelecallerSource = compoundBucketsToNested(byTcSourceFlat);

  const summary = emptyMetrics();
  summary.activeLeads = allMasterKeys.size;
  summary.totalLeads = new Set([...allMasterKeys, ...allHistoryKeys]).size;
  summary.totalCalls = 0;
  summary.notFollowupLeads = 0;
  summary.draftLeads = 0;
  summary.notInterested = 0;
  summary.siteVisitScheduled = 0;
  summary.siteVisitPending = 0;
  summary.siteVisitCancelled = 0;
  summary.siteVisited = 0;
  summary.overdue = 0;
  for (const bucket of Object.values(byTelecallerDisplay)) {
    summary.totalCalls += Number(bucket.totalCalls) || 0;
    summary.notFollowupLeads += Number(bucket.notFollowupLeads) || 0;
    summary.draftLeads += Number(bucket.draftLeads) || 0;
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
    byTelecallerProject,
    byTelecallerSource,
    pie,
    dateMin: dateToIso(dateMin),
    dateMax: dateToIso(dateMax),
    reportDays,
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
  const colors = chartColors();
  const tick = {color: cssVar("--muted", "#6c7771"), font: {size: 11}};
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {legend: {display: false}},
    scales: {
      x: {grid: {display: false}, ticks: {...tick, maxRotation: 45, minRotation: 0}},
      y: {
        beginAtZero: true,
        ticks: {...tick, precision: 0},
        grid: {color: cssVar("--line", "#dfe5e1"), drawBorder: false},
      },
    },
  };
}

function renderBarChart(canvas, labels, values, color, formatYAsAvg = false) {
  const Chart = requireChart();
  const colors = chartColors();
  if (color == null) color = colors.bar;
  const id = canvas.id || `perf-bar-${Math.random().toString(36).slice(2)}`;
  canvas.id = id;
  if (perfChartRegistry.has(id)) {
    perfChartRegistry.get(id).destroy();
    perfChartRegistry.delete(id);
  }
  const options = baseBarOptions();
  if (formatYAsAvg) {
    options.scales.y.ticks.callback = (value) => formatAvg(value);
    options.plugins.tooltip = {
      callbacks: {
        label: (ctx) => formatAvg(ctx.parsed.y),
      },
    };
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
    options,
  });
  perfChartRegistry.set(id, chart);
}

function renderStackedStatusChart(canvas, names, buckets, chartId) {
  const Chart = requireChart();
  const colors = chartColors();
  const id = chartId || canvas.id || "perf-stacked-status";
  canvas.id = id;
  if (perfChartRegistry.has(id)) {
    perfChartRegistry.get(id).destroy();
    perfChartRegistry.delete(id);
  }
  const datasets = PIE_KEYS.map((key, i) => ({
    label: PIE_LABELS[key],
    data: names.map(name => Number(pieFromBucket(buckets[name])?.[key] || 0)),
    backgroundColor: colors.palette[i % colors.palette.length],
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
        legend: {
          position: "bottom",
          labels: {boxWidth: 12, font: {size: 11}, color: cssVar("--ink", "#17211d")},
        },
      },
      scales: {
        x: {
          stacked: true,
          grid: {display: false},
          ticks: {maxRotation: 45, minRotation: 0, font: {size: 11}, color: cssVar("--muted", "#6c7771")},
        },
        y: {
          stacked: true,
          beginAtZero: true,
          ticks: {precision: 0, color: cssVar("--muted", "#6c7771")},
          grid: {color: cssVar("--line", "#dfe5e1"), drawBorder: false},
        },
      },
    },
  });
  perfChartRegistry.set(id, chart);
}

function getBucketMap(data, dimension) {
  const cfg = PERF_DIMENSIONS[dimension] || PERF_DIMENSIONS.telecaller;
  return data?.[cfg.bucketKey] || {};
}

function filterBucketMap(map, selected) {
  if (!selected?.length) return {...(map || {})};
  const out = {};
  for (const name of selected) {
    if (map?.[name]) out[name] = map[name];
  }
  return out;
}

function getReportDays(data) {
  if (Number(data?.reportDays) > 0) return Number(data.reportDays);
  if (Number(data?.report_days) > 0) return Number(data.report_days);
  return reportDayCount(data?.date_min, data?.date_max);
}

function filterPerfData(data, dimension, filters = {}) {
  const byTelecaller = filterBucketMap(data.byTelecaller, filters.telecallers);
  const byProject = filterBucketMap(data.byProject, filters.projects);
  const bySource = filterBucketMap(data.bySource, filters.sources);
  const activeMap = getBucketMap({byTelecaller, byProject, bySource}, dimension);
  const names = Object.keys(activeMap).sort((a, b) => a.localeCompare(b, undefined, {sensitivity: "base"}));
  const summary = sumBucketMetrics(activeMap, names);
  const pie = sumPieSlices(names.map(name => pieFromBucket(activeMap[name])));
  const reportDays = getReportDays(data);
  return {
    ...data,
    summary,
    pie,
    byTelecaller,
    byProject,
    bySource,
    reportDays,
  };
}

function dimensionNames(data, dimension) {
  const buckets = getBucketMap(data, dimension);
  return Object.keys(buckets).sort((a, b) => a.localeCompare(b, undefined, {sensitivity: "base"}));
}

let perfDetailModalState = null;

function perfDetailLabel(metricKey, col) {
  if (col?.label) return col.label;
  return METRIC_LABELS[metricKey] || AVG_LABELS[metricKey] || PCT_LABELS[metricKey] || metricKey;
}

function filterPerfDetailRows(rows, search) {
  const q = norm(search);
  if (!q) return rows;
  return rows.filter(row => Object.values(row).some(value => norm(value).includes(q)));
}

function ensurePerfDetailModal() {
  let modal = document.getElementById("perf-detail-modal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "perf-detail-modal";
  modal.className = "dashboard-lead-modal hidden";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "perf-detail-modal-title");
  modal.setAttribute("aria-hidden", "true");

  const backdrop = document.createElement("div");
  backdrop.className = "dashboard-lead-modal-backdrop";
  backdrop.addEventListener("click", closePerfDetailModal);

  const card = document.createElement("div");
  card.className = "dashboard-lead-modal-card dashboard-chart-report-card";
  card.setAttribute("role", "document");
  card.addEventListener("click", e => e.stopPropagation());

  const head = document.createElement("div");
  head.className = "dashboard-lead-modal-head";
  const titleWrap = document.createElement("div");
  titleWrap.className = "dashboard-chart-report-title-wrap";
  const title = document.createElement("h2");
  title.id = "perf-detail-modal-title";
  const note = document.createElement("p");
  note.className = "dashboard-chart-report-subtitle";
  note.id = "perf-detail-modal-subtitle";
  titleWrap.append(title, note);
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "dashboard-lead-modal-close";
  closeBtn.textContent = "×";
  closeBtn.setAttribute("aria-label", "Close lead details");
  closeBtn.addEventListener("click", closePerfDetailModal);
  head.append(titleWrap, closeBtn);

  const searchWrap = document.createElement("div");
  searchWrap.className = "dashboard-main-search dashboard-chart-report-search";
  const searchHead = document.createElement("div");
  searchHead.className = "dashboard-main-search-head";
  searchHead.append(Object.assign(document.createElement("span"), {className: "dashboard-filter-label", textContent: "Search all"}));
  const clearSearch = document.createElement("button");
  clearSearch.type = "button";
  clearSearch.className = "dashboard-filter-action dashboard-chart-report-search-clear";
  clearSearch.textContent = "Clear";
  clearSearch.setAttribute("aria-label", "Clear search");
  searchHead.append(clearSearch);
  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.name = "perf-detail-search";
  searchInput.className = "dashboard-filter-search-input dashboard-main-search-input";
  searchInput.placeholder = "Search all fields…";
  searchInput.autocomplete = "off";
  searchInput.spellcheck = false;
  searchInput.setAttribute("aria-label", "Search all fields in this report");
  searchWrap.append(searchHead, searchInput);

  const body = document.createElement("div");
  body.className = "dashboard-lead-modal-body dashboard-chart-report-body";
  body.id = "perf-detail-modal-body";

  card.append(head, searchWrap, body);
  modal.append(backdrop, card);
  document.body.append(modal);

  searchInput.addEventListener("input", () => {
    if (!perfDetailModalState) return;
    perfDetailModalState.search = searchInput.value;
    renderPerfDetailModalBody();
  });
  clearSearch.addEventListener("click", () => {
    if (!perfDetailModalState) return;
    searchInput.value = "";
    perfDetailModalState.search = "";
    renderPerfDetailModalBody();
    searchInput.focus();
  });

  return modal;
}

function renderPerfDetailTable(rows) {
  const wrap = document.createElement("div");
  wrap.className = "perf-table-wrap";
  if (!rows.length) {
    wrap.append(Object.assign(document.createElement("p"), {
      className: "dashboard-lead-detail-empty",
      textContent: "No rows match your search.",
    }));
    return wrap;
  }
  const table = document.createElement("table");
  table.className = "perf-scorecard perf-detail-table";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const [label] of PERF_DETAIL_COLUMNS) {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.append(th);
  }
  thead.append(headRow);
  table.append(thead);
  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const [, key] of PERF_DETAIL_COLUMNS) {
      const td = document.createElement("td");
      td.textContent = row[key] || "—";
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  wrap.append(table);
  return wrap;
}

function renderPerfDetailModalBody() {
  if (!perfDetailModalState) return;
  const modal = document.getElementById("perf-detail-modal");
  const body = modal?.querySelector("#perf-detail-modal-body");
  const note = modal?.querySelector("#perf-detail-modal-subtitle");
  if (!body) return;
  const filtered = filterPerfDetailRows(perfDetailModalState.rows, perfDetailModalState.search);
  if (note) {
    const countLabel = `${filtered.length} row${filtered.length === 1 ? "" : "s"}`;
    note.textContent = perfDetailModalState.subtitle
      ? `${perfDetailModalState.subtitle} · ${countLabel}`
      : countLabel;
  }
  body.replaceChildren();
  body.append(renderPerfDetailTable(filtered));
}

function onPerfDetailModalKeydown(e) {
  if (e.key === "Escape") {
    e.preventDefault();
    closePerfDetailModal();
  }
}

function openPerfDetailModal({metricKey, metricLabel, rows, subtitle = ""}) {
  if (!rows?.length) {
    window.alert("Lead details are not available for this metric. Re-upload the performance workbook to include detail rows.");
    return;
  }
  perfDetailModalState = {metricKey, metricLabel, rows, subtitle, search: ""};
  const modal = ensurePerfDetailModal();
  const title = modal.querySelector("#perf-detail-modal-title");
  const searchInput = modal.querySelector('input[name="perf-detail-search"]');
  if (title) title.textContent = metricLabel || perfDetailLabel(metricKey);
  if (searchInput) searchInput.value = "";
  renderPerfDetailModalBody();
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  document.removeEventListener("keydown", onPerfDetailModalKeydown);
  document.addEventListener("keydown", onPerfDetailModalKeydown);
  searchInput?.focus();
}

function closePerfDetailModal() {
  const modal = document.getElementById("perf-detail-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  document.removeEventListener("keydown", onPerfDetailModalKeydown);
  perfDetailModalState = null;
}

function wirePerfMetricCell(cell, {col, bucket, reportDays, getRows, subtitle}) {
  if (!metricCellIsClickable(bucket, col, reportDays)) return;
  const metricKey = detailMetricKey(col);
  if (!metricKey || !getRows(metricKey).length) return;
  cell.classList.add("perf-metric-clickable");
  cell.setAttribute("role", "button");
  cell.tabIndex = 0;
  cell.title = `View ${perfDetailLabel(metricKey, col)} details`;
  const open = () => {
    const rows = getRows(metricKey);
    openPerfDetailModal({
      metricKey,
      metricLabel: perfDetailLabel(metricKey, col),
      rows,
      subtitle,
    });
  };
  cell.addEventListener("click", open);
  cell.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  });
}

function renderTotalsBlock(mount, summary, title = "Totals", reportDays = 0, detailContext = null) {
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
    dd.textContent = scorecardCellValue(summary, col, reportDays);
    if (detailContext) {
      wirePerfMetricCell(dd, {
        col,
        bucket: summary,
        reportDays,
        subtitle: title,
        getRows: metricKey => mergeMetricDetails(detailContext.buckets, detailContext.names, metricKey),
      });
    }
    row.append(dt, dd);
    list.append(row);
  }
  block.append(list);
  mount.append(block);
}

function renderBreakdownTable(mount, data, dimension, {showTotalRow = true} = {}) {
  const cfg = PERF_DIMENSIONS[dimension] || PERF_DIMENSIONS.telecaller;
  const buckets = getBucketMap(data, dimension);
  const names = dimensionNames(data, dimension);
  const reportDays = getReportDays(data);
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
      td.textContent = scorecardCellValue(bucket, col, reportDays);
      wirePerfMetricCell(td, {
        col,
        bucket,
        reportDays,
        subtitle: name,
        getRows: metricKey => getMetricDetails(bucket, metricKey),
      });
      tr.append(td);
    }
    tbody.append(tr);
  }

  if (showTotalRow) {
    const totals = sumBucketMetrics(buckets, names);
    const totalTr = document.createElement("tr");
    totalTr.className = "perf-total-row";
    const totalNameCell = document.createElement("th");
    totalNameCell.scope = "row";
    totalNameCell.textContent = "Total";
    totalTr.append(totalNameCell);
    for (const col of SCORECARD_COLUMNS) {
      const td = document.createElement("td");
      td.textContent = scorecardCellValue(totals, col, reportDays);
      wirePerfMetricCell(td, {
        col,
        bucket: totals,
        reportDays,
        subtitle: "Total",
        getRows: metricKey => mergeMetricDetails(buckets, names, metricKey),
      });
      totalTr.append(td);
    }
    tbody.append(totalTr);
  }

  table.append(tbody);
  wrap.append(table);
  mount.append(wrap);
}

function renderSummaryHeader(mount, data) {
  const header = document.createElement("p");
  header.className = "perf-date-range";
  header.textContent = `Report period (from History Lead Update Date): ${formatDisplayDate(data.date_min)} – ${formatDisplayDate(data.date_max)}`;
  mount.append(header);
}

function renderPerfSummaryView(mount, data) {
  mount.replaceChildren();
  renderSummaryHeader(mount, data);
  const filtered = filterPerfData(data, "telecaller", perfFilters);
  const title = data.view_all ? "All TeleCallers · totals" : "Totals";
  const buckets = getBucketMap(filtered, "telecaller");
  const names = dimensionNames(filtered, "telecaller");
  renderTotalsBlock(mount, filtered.summary, title, getReportDays(data), {buckets, names});
}

function renderPerfTableView(mount, data, dimension) {
  mount.replaceChildren();
  renderSummaryHeader(mount, data);
  renderBreakdownTable(mount, data, dimension, {showTotalRow: shouldShowPerfTotalRow()});
}

function renderSummaryPanel(mount, data, dimension = "telecaller") {
  renderPerfTableView(mount, data, dimension);
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
      return 0;
    });
    renderBarChart(canvas, names, values, "#2a5f9e");
  }

  const reportDays = getReportDays(data);
  for (const avgKey of AVG_KEYS) {
    const block = document.createElement("div");
    block.className = "perf-chart-block";
    const title = document.createElement("h3");
    title.textContent = AVG_LABELS[avgKey];
    block.append(title);
    const wrap = document.createElement("div");
    wrap.className = "perf-chart-wrap";
    const canvas = document.createElement("canvas");
    wrap.append(canvas);
    block.append(wrap);
    mount.append(block);
    const values = names.map(n => {
      const b = buckets[n] || emptyMetrics();
      if (avgKey === "avgCallsPerDay") return avgCallsPerDay(b.totalCalls, reportDays) ?? 0;
      return 0;
    });
    renderBarChart(canvas, names, values, "#3f8c68", true);
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
    reportDays: reconciled.reportDays,
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
        byProject: perfReconciled.byTelecallerProject?.[name] || {},
        bySource: perfReconciled.byTelecallerSource?.[name] || {},
        pie: pieFromBucket(bucket),
        date_min: perfReconciled.dateMin,
        date_max: perfReconciled.dateMax,
        report_days: perfReconciled.reportDays,
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
let perfActiveView = "summary";
let perfActiveTab = "table";
let perfFilters = {telecallers: [], projects: [], sources: []};

function readPerfMultiSelect(select) {
  if (!select) return [];
  return [...select.selectedOptions].map(opt => opt.value);
}

function syncPerfFiltersBodyPadding(aside) {
  const open = aside && !aside.classList.contains("is-collapsed") && document.body.contains(aside);
  document.body.classList.toggle("dashboard-filters-open", Boolean(open));
}

function fillPerfMultiSelect(select, values, selected) {
  select.replaceChildren();
  select.multiple = true;
  const selectedSet = new Set(selected || []);
  for (const value of values) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = value;
    if (selectedSet.has(value)) opt.selected = true;
    select.append(opt);
  }
}

function buildPerfFilterSelectActions(select) {
  const actions = document.createElement("span");
  actions.className = "dashboard-filter-actions";
  const selectAll = document.createElement("button");
  selectAll.type = "button";
  selectAll.className = "dashboard-filter-action";
  selectAll.textContent = "Select All";
  const selectNone = document.createElement("button");
  selectNone.type = "button";
  selectNone.className = "dashboard-filter-action";
  selectNone.textContent = "Select None";
  selectAll.addEventListener("click", () => {
    for (const opt of select.options) opt.selected = true;
    select.dispatchEvent(new Event("change", {bubbles: true}));
  });
  selectNone.addEventListener("click", () => {
    for (const opt of select.options) opt.selected = false;
    select.dispatchEvent(new Event("change", {bubbles: true}));
  });
  actions.append(selectAll, selectNone);
  return actions;
}

function buildPerfFiltersPanel(filterOptions, filters, {collapsed = true} = {}) {
  const aside = document.createElement("aside");
  aside.className = "dashboard-filters-rail";
  aside.id = "perf-filters-rail";
  if (collapsed) aside.classList.add("is-collapsed");

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "filters-tab-toggle";
  toggle.textContent = "Filters";
  toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");

  const panel = document.createElement("div");
  panel.className = "dashboard-filters-panel";
  const form = document.createElement("form");
  form.className = "dashboard-filters";
  form.id = "perf-filters-form";

  const head = document.createElement("div");
  head.className = "filters-panel-head";
  const title = document.createElement("h3");
  title.textContent = "Filters";
  const hint = document.createElement("p");
  hint.className = "filters-panel-hint";
  hint.textContent = "Hold Ctrl/Cmd to multi-select. Empty = all.";
  head.append(title, hint);
  form.append(head);

  const fields = [
    ["telecallers", "TeleCaller", filterOptions.telecallers, filters.telecallers],
    ["projects", "Project", filterOptions.projects, filters.projects],
    ["sources", "Source", filterOptions.sources, filters.sources],
  ];

  const selects = {};
  for (const [name, label, options, selected] of fields) {
    const wrap = document.createElement("div");
    wrap.className = "dashboard-filter";
    const fieldHead = document.createElement("div");
    fieldHead.className = "dashboard-filter-head";
    const fieldLabel = document.createElement("span");
    fieldLabel.className = "dashboard-filter-label";
    fieldLabel.textContent = label;
    const select = document.createElement("select");
    select.name = name;
    select.className = "dashboard-filter-select";
    select.size = Math.max(12, (options || []).length || 12);
    fillPerfMultiSelect(select, options || [], selected || []);
    fieldHead.append(fieldLabel, buildPerfFilterSelectActions(select));
    wrap.append(fieldHead, select);
    form.append(wrap);
    selects[name] = select;
  }

  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "secondary-button dashboard-filter-reset";
  reset.textContent = "Reset filters";
  form.append(reset);
  panel.append(form);
  aside.append(toggle, panel);

  toggle.addEventListener("click", () => {
    const willCollapse = !aside.classList.contains("is-collapsed");
    aside.classList.toggle("is-collapsed", willCollapse);
    toggle.setAttribute("aria-expanded", willCollapse ? "false" : "true");
    syncPerfFiltersBodyPadding(aside);
  });

  return {aside, form, reset, selects};
}

function getActivePerfDimension() {
  return perfActiveView === "summary" ? "telecaller" : perfActiveView;
}

/** Admin / view-all: comparative filters, Graph tab, Total row. TeleCaller sees own scoped board only. */
function isPerfAdminView() {
  return Boolean(perfPublishedHandlers?.canViewAll?.() && perfCombinedCache?.view_all);
}

/** Admin / comparative roles keep the Total footer; TeleCaller-scoped users do not. */
function shouldShowPerfTotalRow() {
  return Boolean(perfPublishedHandlers?.canViewAll?.());
}

function getFilteredPerfData() {
  if (!perfCombinedCache) return null;
  return filterPerfData(perfCombinedCache, getActivePerfDimension(), perfFilters);
}

function updatePerfFilterVisibility(showAdminControls) {
  const {filterSelects, filtersRail} = perfPublishedHandlers || {};
  if (!filterSelects) return;
  const dim = getActivePerfDimension();
  const showTelecallers = showAdminControls && (perfActiveView === "summary" || dim === "telecaller");
  const showProjects = perfActiveView === "project";
  const showSources = perfActiveView === "source";
  filterSelects.telecallers.closest(".dashboard-filter")?.classList.toggle("hidden", !showTelecallers);
  filterSelects.projects.closest(".dashboard-filter")?.classList.toggle("hidden", !showProjects);
  filterSelects.sources.closest(".dashboard-filter")?.classList.toggle("hidden", !showSources);
  const showRail = showTelecallers || showProjects || showSources;
  filtersRail?.classList.toggle("hidden", !showRail);
  if (!showRail) syncPerfFiltersBodyPadding(null);
  else syncPerfFiltersBodyPadding(filtersRail);
}

function syncPerfPresentationChrome() {
  const isSummary = perfActiveView === "summary";
  const showAdmin = isPerfAdminView();
  // Task 8: TeleCallers only see table / summary metrics — no Table|Graph sub-tabs.
  const showSubTabs = !isSummary && showAdmin;
  if (!showAdmin) perfActiveTab = "table";

  document.getElementById("perf-sub-tabs")?.classList.toggle("hidden", !showSubTabs);
  document.getElementById("perf-panel-summary")?.classList.toggle("hidden", !isSummary);
  document.getElementById("perf-panel-table")?.classList.toggle("hidden", isSummary || perfActiveTab !== "table");
  document.getElementById("perf-panel-graphs")?.classList.toggle(
    "hidden",
    isSummary || !showAdmin || perfActiveTab !== "graphs",
  );
  updatePerfFilterVisibility(showAdmin);
}

function renderActivePerfPanels() {
  const filtered = getFilteredPerfData();
  if (!filtered) return;
  const summaryMount = document.getElementById("perf-panel-summary");
  const tableMount = document.getElementById("perf-panel-table");
  const graphsMount = document.getElementById("perf-panel-graphs");

  if (perfActiveView === "summary") {
    if (summaryMount) renderPerfSummaryView(summaryMount, perfCombinedCache);
    return;
  }

  if (perfActiveTab === "table" && tableMount) {
    renderPerfTableView(tableMount, filtered, getActivePerfDimension());
  }
  if (isPerfAdminView() && perfActiveTab === "graphs" && graphsMount) {
    renderGraphsPanel(graphsMount, filtered, getActivePerfDimension());
  }
}

function setPerfView(view) {
  const allowed = view === "summary" || PERF_DIMENSIONS[view];
  const next = allowed ? view : "summary";
  perfActiveView = next;
  document.querySelectorAll(".perf-main-tabs [data-perf-view]").forEach(btn => {
    const active = btn.dataset.perfView === next;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });

  syncPerfPresentationChrome();
  renderActivePerfPanels();
}

function setPerfTab(tab) {
  if (!isPerfAdminView()) {
    perfActiveTab = "table";
  } else {
    perfActiveTab = tab === "graphs" ? "graphs" : "table";
  }
  document.querySelectorAll("#perf-sub-tabs [data-perf-tab]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.perfTab === perfActiveTab);
    btn.setAttribute("aria-selected", btn.dataset.perfTab === perfActiveTab ? "true" : "false");
  });
  syncPerfPresentationChrome();
  if (perfActiveView !== "summary" && perfCombinedCache) {
    renderActivePerfPanels();
  }
}

/**
 * Wire published dashboard view (#view-perf-dashboard).
 * @param {{hasPermission: Function, canViewAll: Function}} ctx
 */
export function mountPerfPublishedDashboard(ctx) {
  const {canViewAll} = ctx;
  document.querySelectorAll(".perf-main-tabs [data-perf-view]").forEach(btn => {
    btn.addEventListener("click", () => setPerfView(btn.dataset.perfView || "summary"));
  });
  document.querySelectorAll("#perf-sub-tabs [data-perf-tab]").forEach(btn => {
    btn.addEventListener("click", () => setPerfTab(btn.dataset.perfTab || "table"));
  });
  document.getElementById("refresh-perf-published")?.addEventListener("click", () => refreshPerfPublished());
  document.getElementById("export-perf-pdf")?.addEventListener("click", async () => {
    const btn = document.getElementById("export-perf-pdf");
    try {
      if (btn) btn.disabled = true;
      await downloadPerfDashboardPdf();
    } catch (err) {
      window.alert(err.message || "PDF export failed.");
    } finally {
      if (btn && perfCombinedCache) btn.disabled = false;
    }
  });

  const view = document.getElementById("view-perf-dashboard");
  const {aside, form, reset, selects} = buildPerfFiltersPanel(
    {telecallers: [], projects: [], sources: []},
    perfFilters,
    {collapsed: true},
  );
  view?.append(aside);
  queueMicrotask(() => syncPerfFiltersBodyPadding(aside));

  const applyFilters = () => {
    perfFilters = {
      telecallers: readPerfMultiSelect(selects.telecallers),
      projects: readPerfMultiSelect(selects.projects),
      sources: readPerfMultiSelect(selects.sources),
    };
    if (!perfCombinedCache) return;
    renderActivePerfPanels();
  };

  form.addEventListener("submit", e => e.preventDefault());
  form.addEventListener("change", applyFilters);
  reset.addEventListener("click", () => {
    perfFilters = {telecallers: [], projects: [], sources: []};
    for (const select of Object.values(selects)) {
      for (const opt of select.options) opt.selected = false;
    }
    applyFilters();
  });

  const mainTabs = document.querySelector(".perf-main-tabs");
  perfPublishedHandlers = {canViewAll, filtersRail: aside, filterSelects: selects, mainTabs};
  updatePerfFilterVisibility(Boolean(canViewAll?.() && perfCombinedCache?.view_all));
}

export async function refreshPerfPublished() {
  const empty = document.getElementById("perf-published-empty");
  const panel = document.getElementById("perf-published-panel");
  const titleEl = document.getElementById("perf-published-title");
  const metaEl = document.getElementById("perf-published-meta");
  const summaryMount = document.getElementById("perf-panel-summary");
  const tableMount = document.getElementById("perf-panel-table");
  const graphsMount = document.getElementById("perf-panel-graphs");
  const {filterSelects, canViewAll, mainTabs} = perfPublishedHandlers || {};

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
      document.getElementById("export-perf-pdf")?.setAttribute("disabled", "disabled");
      return;
    }
    empty?.classList.add("hidden");
    panel?.classList.remove("hidden");
    perfCombinedCache = data;
    document.getElementById("export-perf-pdf")?.removeAttribute("disabled");

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
    // All perf-dashboard roles can open By Project / By Source (TeleCaller sees own-scoped data).
    mainTabs?.querySelector('[data-perf-view="project"]')?.classList.remove("hidden");
    mainTabs?.querySelector('[data-perf-view="source"]')?.classList.remove("hidden");
    if (!showAdminControls) {
      // Keep project/source selections; never expose other telecallers in the filter.
      perfFilters = {telecallers: [], projects: perfFilters.projects, sources: perfFilters.sources};
      perfActiveTab = "table";
    }
    if (!PERF_DIMENSIONS[perfActiveView] && perfActiveView !== "summary") {
      perfActiveView = "summary";
    }
    document.querySelectorAll(".perf-main-tabs [data-perf-view]").forEach(btn => {
      if (btn.classList.contains("hidden") && btn.dataset.perfView === perfActiveView) {
        perfActiveView = "summary";
      }
    });
    document.querySelectorAll(".perf-main-tabs [data-perf-view]").forEach(btn => {
      const active = btn.dataset.perfView === perfActiveView;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });

    if (filterSelects) {
      const tcNames = showAdminControls
        ? Object.keys(data.byTelecaller || {}).sort((a, b) => a.localeCompare(b, undefined, {sensitivity: "base"}))
        : [];
      const projectNames = Object.keys(data.byProject || {}).sort((a, b) => a.localeCompare(b, undefined, {sensitivity: "base"}));
      const sourceNames = Object.keys(data.bySource || {}).sort((a, b) => a.localeCompare(b, undefined, {sensitivity: "base"}));
      const prune = (selected, options) => selected.filter(name => options.includes(name));
      perfFilters = {
        telecallers: showAdminControls ? prune(perfFilters.telecallers, tcNames) : [],
        projects: prune(perfFilters.projects, projectNames),
        sources: prune(perfFilters.sources, sourceNames),
      };
      fillPerfMultiSelect(filterSelects.telecallers, tcNames, perfFilters.telecallers);
      fillPerfMultiSelect(filterSelects.projects, projectNames, perfFilters.projects);
      fillPerfMultiSelect(filterSelects.sources, sourceNames, perfFilters.sources);
    }

    updatePerfFilterVisibility(showAdminControls);
    setPerfView(perfActiveView);
    setPerfTab(perfActiveTab);
  } catch (err) {
    empty?.classList.remove("hidden");
    if (empty) empty.textContent = err.message || "Could not load performance dashboards.";
    panel?.classList.add("hidden");
  }
}

export function destroyPerfDashboard() {
  destroyPerfCharts();
  syncPerfFiltersBodyPadding(null);
}

const PDF_BRAND = {
  green: "#12372a",
  mint: "#dff4e8",
  ink: "#17211d",
  muted: "#6c7771",
  white: "#ffffff",
  line: "#dfe5e1",
};

function requireJsPdf() {
  const jsPDF = window.jspdf?.jsPDF;
  if (typeof jsPDF !== "function") throw new Error("jsPDF failed to load. Reload the page.");
  return jsPDF;
}

function pdfHexRgb(hex) {
  const h = String(hex || "").replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function pdfSetFill(doc, hex) {
  const {r, g, b} = pdfHexRgb(hex);
  doc.setFillColor(r, g, b);
}

function pdfSetText(doc, hex) {
  const {r, g, b} = pdfHexRgb(hex);
  doc.setTextColor(r, g, b);
}

function pdfTruncate(doc, text, maxWidth) {
  const s = String(text ?? "");
  if (doc.getTextWidth(s) <= maxWidth) return s;
  let out = s;
  while (out.length > 1 && doc.getTextWidth(`${out}…`) > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

function buildPerfDashboardPdf(data, view, dimension) {
  const jsPDF = requireJsPdf();
  const doc = new jsPDF({orientation: "landscape", unit: "mm", format: "a4"});
  const marginX = 10;
  const marginY = 12;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const contentW = pageW - marginX * 2;
  const cfg = PERF_DIMENSIONS[dimension] || PERF_DIMENSIONS.telecaller;
  const viewLabel = view === "summary"
    ? "Summary"
    : `By ${cfg.label.replace(/ Name$/, "")}`;

  pdfSetFill(doc, PDF_BRAND.green);
  doc.rect(0, 0, pageW, 22, "F");
  pdfSetText(doc, PDF_BRAND.white);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("GPP AI · Performance Dashboard", marginX, 10);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(viewLabel, pageW - marginX, 10, {align: "right"});

  let y = 28;
  pdfSetText(doc, PDF_BRAND.ink);
  doc.setFontSize(9);
  doc.text(
    `Report period: ${formatDisplayDate(data.date_min)} – ${formatDisplayDate(data.date_max)}`,
    marginX,
    y,
  );
  y += 6;

  const reportDays = getReportDays(data);

  if (view === "summary") {
    const summary = data.summary || emptyMetrics();
    doc.setFont("helvetica", "bold");
    doc.text("Totals", marginX, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    for (const col of SCORECARD_COLUMNS) {
      if (y + 5 > pageH - marginY) {
        doc.addPage();
        y = marginY;
      }
      const val = scorecardCellValue(summary, col, reportDays);
      doc.text(`${col.label}: ${val}`, marginX, y);
      y += 4.5;
    }
    return doc;
  }

  const buckets = getBucketMap(data, dimension);
  const names = dimensionNames(data, dimension);
  const nameLabel = cfg.label;
  const columns = [{key: "name", label: nameLabel}, ...SCORECARD_COLUMNS];
  const colCount = columns.length;
  const colW = contentW / colCount;
  const rowH = 5.5;
  const headerH = 6;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  pdfSetFill(doc, PDF_BRAND.green);
  doc.rect(marginX, y, contentW, headerH, "F");
  pdfSetText(doc, PDF_BRAND.white);
  columns.forEach((col, i) => {
    const x = marginX + i * colW + 1;
    doc.text(pdfTruncate(doc, col.label, colW - 2), x, y + 4);
  });
  y += headerH;

  doc.setFont("helvetica", "normal");
  const drawRow = (label, bucket, bold = false) => {
    if (y + rowH > pageH - marginY) {
      doc.addPage();
      y = marginY;
    }
    if (bold) doc.setFont("helvetica", "bold");
    pdfSetFill(doc, bold ? PDF_BRAND.mint : PDF_BRAND.white);
    doc.rect(marginX, y, contentW, rowH, "F");
    pdfSetText(doc, PDF_BRAND.ink);
    columns.forEach((col, i) => {
      const x = marginX + i * colW + 1;
      const val = col.key === "name"
        ? label
        : scorecardCellValue(bucket, col, reportDays);
      doc.text(pdfTruncate(doc, String(val), colW - 2), x, y + 4);
    });
    doc.setFont("helvetica", "normal");
    y += rowH;
  };

  for (const name of names) drawRow(name, buckets[name] || emptyMetrics());
  if (names.length && shouldShowPerfTotalRow()) {
    const totals = sumBucketMetrics(buckets, names);
    drawRow("Total", totals, true);
  }

  return doc;
}

export async function downloadPerfDashboardPdf() {
  const data = getFilteredPerfData();
  if (!data) throw new Error("No dashboard data to export.");
  const dimension = getActivePerfDimension();
  const doc = buildPerfDashboardPdf(data, perfActiveView, dimension);
  const stamp = new Date().toISOString().slice(0, 10);
  downloadBlobFile(doc.output("blob"), `Performance_Dashboard_${stamp}.pdf`);
}

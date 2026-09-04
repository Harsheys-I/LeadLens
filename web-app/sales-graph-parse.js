/**
 * Sales Graph Excel parse — Leads / Visits / Booked sheets.
 *
 * Shared layout (sheet1):
 * - Row 0: [blank…, axis-label spacer, YYYYMM…, Totals]
 * - Row 1: [Project Name, Source, Source Name, (Status on Booked)]
 * - Merge headers: prefer YYYYMM from row 0, dims from row 1;
 *   drop empty / null / axis-label / Totals.
 * - Data from row index 2; forward-fill Project Name + Source + Source Name;
 *   blank→0; skip Project Name === "Totals"; Meta-normalize Source Name.
 * - Booked adds Status (per-row; not forward-filled) and byStatus aggregates.
 * - Booked also exposes leadDeclaration = Demand Letter + Cancel
 *   ({ total, byMonth, byProject, bySource }).
 */

const MONTH_RE = /^\d{6}$/;
const DIM_LABELS = new Set(["project name", "source", "source name", "status"]);
const STATUS_DEMAND = "Demand Letter";
const STATUS_CANCEL = "Cancel";

export function normalizeSourceName(raw) {
  const name = String(raw ?? "").trim();
  if (!name) return "";
  const lower = name.toLowerCase();
  if (lower.startsWith("meta")) return "Meta";
  if (lower === "brickwise-eka" || lower.startsWith("brickwise-eka")) return "Meta";
  return name;
}

function cellText(value) {
  if (value == null) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    // SheetJS may give numeric YYYYMM as number
    if (value >= 100000 && value <= 999999 && Number.isInteger(value)) return String(value);
    return String(value);
  }
  return String(value).trim();
}

/** Normalize a raw header cell to a string label (months as YYYYMM). */
function headerLabel(raw) {
  if (raw == null || raw === "") return "";
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (raw >= 100000 && raw <= 999999) return String(Math.trunc(raw));
    return String(raw).trim();
  }
  let text = String(raw).trim();
  if (!text || text.toLowerCase() === "null") return "";
  if (/^\d+\.0+$/.test(text)) text = String(Math.trunc(Number(text)));
  return text;
}

function isYyyymm(label) {
  return MONTH_RE.test(String(label || ""));
}

function isDimLabel(label) {
  return DIM_LABELS.has(String(label || "").toLowerCase());
}

function isTotalsLabel(label) {
  const lower = String(label || "").trim().toLowerCase();
  return lower === "total" || lower === "totals";
}

/**
 * Merge row0 + row1 into one header list.
 * Prefer YYYYMM when either cell is a month; else prefer row1 for dims;
 * else take the non-empty cell. Axis spacer / Totals / empty stay as-is for drop later.
 */
export function mergeHeaderRows(row0 = [], row1 = []) {
  const len = Math.max(row0.length, row1.length);
  const merged = [];
  for (let i = 0; i < len; i++) {
    const a = headerLabel(row0[i]);
    const b = headerLabel(row1[i]);
    if (isYyyymm(a) || isYyyymm(b)) {
      merged.push(isYyyymm(a) ? a : b);
      continue;
    }
    if (isDimLabel(b)) {
      merged.push(b);
      continue;
    }
    if (isDimLabel(a)) {
      merged.push(a);
      continue;
    }
    // Prefer row1 for named dims / leftover labels when both non-empty
    if (a && b) {
      merged.push(b);
      continue;
    }
    merged.push(a || b || "");
  }
  return merged;
}

function coerceNumber(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = String(value).trim();
  if (!text) return 0;
  const cleaned = text.replace(/,/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function emptyAggregates(months) {
  const byMonth = {};
  for (const m of months) byMonth[m] = 0;
  return {
    totals: {grand: 0, byMonth: {...byMonth}},
    byMonth: {...byMonth},
    byProject: {},
    bySource: {},
    byStatus: {},
  };
}

function bumpBucket(map, key, monthsObj, monthKeys) {
  const name = key || "(blank)";
  if (!map[name]) {
    map[name] = {total: 0, byMonth: {}};
    for (const m of monthKeys) map[name].byMonth[m] = 0;
  }
  let rowSum = 0;
  for (const m of monthKeys) {
    const v = Number(monthsObj[m] || 0);
    map[name].byMonth[m] += v;
    rowSum += v;
  }
  map[name].total += rowSum;
  return rowSum;
}

function findStatusBucket(byStatus, wanted) {
  const keys = Object.keys(byStatus || {});
  const lower = String(wanted || "").toLowerCase();
  const key = keys.find(k => String(k).toLowerCase() === lower);
  return key ? byStatus[key] : null;
}

function ensureDimEntry(map, name, months) {
  if (!map[name]) {
    map[name] = {total: 0, byMonth: {}};
    for (const m of months) map[name].byMonth[m] = 0;
  }
  return map[name];
}

/**
 * Lead Declaration = Demand Letter + Cancel (sum of the two Booked statuses).
 * Shape mirrors a status bucket: { total, byMonth, byProject, bySource }.
 */
export function computeLeadDeclaration(byStatus, months = []) {
  const monthKeys = months.length
    ? months
    : [...new Set([
        ...Object.keys(findStatusBucket(byStatus, STATUS_DEMAND)?.byMonth || {}),
        ...Object.keys(findStatusBucket(byStatus, STATUS_CANCEL)?.byMonth || {}),
      ])].sort((a, b) => a.localeCompare(b));

  const out = {
    total: 0,
    byMonth: {},
    byProject: {},
    bySource: {},
  };
  for (const m of monthKeys) out.byMonth[m] = 0;

  for (const wanted of [STATUS_DEMAND, STATUS_CANCEL]) {
    const bucket = findStatusBucket(byStatus, wanted);
    if (!bucket) continue;
    out.total += Number(bucket.total) || 0;
    for (const m of monthKeys) {
      out.byMonth[m] += Number(bucket.byMonth?.[m] || 0);
    }
    for (const kind of ["byProject", "bySource"]) {
      const src = bucket[kind] || {};
      for (const [name, entry] of Object.entries(src)) {
        const dest = ensureDimEntry(out[kind], name, monthKeys);
        dest.total += Number(entry.total) || 0;
        for (const m of monthKeys) {
          dest.byMonth[m] += Number(entry.byMonth?.[m] || 0);
        }
      }
    }
  }
  return out;
}

/**
 * Parse a Leads, Visits, or Booked ArrayBuffer into normalized sheet data.
 * @param {ArrayBuffer} buffer
 * @param {{fileName?: string, kind?: string}} opts
 */
export function parseSalesGraphSheet(buffer, opts = {}) {
  const XLSX = window.XLSX;
  if (!XLSX) throw new Error("SheetJS failed to load. Reload the page.");

  const wb = XLSX.read(buffer, {type: "array", cellDates: false});
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("Workbook has no sheets.");
  const sheet = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, {header: 1, raw: true, defval: null});
  if (!Array.isArray(matrix) || matrix.length < 3) {
    throw new Error("Sheet needs row 0 (months), row 1 (dims), and data from row 2.");
  }

  const mergedHeaders = mergeHeaderRows(matrix[0] || [], matrix[1] || []);
  const dataRows = matrix.slice(2);

  const colMap = []; // {index, kind: 'project'|'source'|'sourceName'|'status'|'month', month?}
  const months = [];
  let projectIdx = -1;
  let sourceIdx = -1;
  let sourceNameIdx = -1;
  let statusIdx = -1;

  for (let i = 0; i < mergedHeaders.length; i++) {
    const label = mergedHeaders[i];
    if (!label) continue;
    if (isTotalsLabel(label)) continue; // drop Totals / Total
    const lower = label.toLowerCase();
    if (lower === "null") continue;

    if (lower === "project name") {
      projectIdx = i;
      colMap.push({index: i, kind: "project"});
      continue;
    }
    if (lower === "source") {
      sourceIdx = i;
      colMap.push({index: i, kind: "source"});
      continue;
    }
    if (lower === "source name") {
      sourceNameIdx = i;
      colMap.push({index: i, kind: "sourceName"});
      continue;
    }
    if (lower === "status") {
      statusIdx = i;
      colMap.push({index: i, kind: "status"});
      continue;
    }
    if (isYyyymm(label)) {
      months.push(label);
      colMap.push({index: i, kind: "month", month: label});
      continue;
    }
    // Axis spacer (e.g. "Year+Month" / "Lead Registration Year + Month") — drop
  }

  const missing = [];
  if (projectIdx < 0) missing.push("Project Name");
  if (sourceIdx < 0) missing.push("Source");
  if (sourceNameIdx < 0) missing.push("Source Name");
  if (!months.length) missing.push("YYYYMM month column(s)");
  // Status is required for Booked; optional for Leads/Visits
  if (opts.kind === "booked" && statusIdx < 0) missing.push("Status");
  if (missing.length) {
    return {
      ok: false,
      error: `Missing required column(s): ${missing.join(", ")}`,
      fileName: opts.fileName || "",
      kind: opts.kind || "",
      months: [],
      rows: [],
      totals: {grand: 0, byMonth: {}},
      byMonth: {},
      byProject: {},
      bySource: {},
      byStatus: {},
    };
  }

  // Keep month order as in sheet (do not re-sort — preserves odd future months like 202704)
  const monthsOrdered = [...months];

  let fillProject = "";
  let fillSource = "";
  let fillSourceName = "";
  const rows = [];

  for (const row of dataRows) {
    if (!Array.isArray(row)) continue;
    const projectCell = cellText(row[projectIdx]);
    const sourceCell = cellText(row[sourceIdx]);
    const sourceNameRaw = cellText(row[sourceNameIdx]);
    const statusCell = statusIdx >= 0 ? cellText(row[statusIdx]) : "";

    // Skip summary Totals rows (before fill so we don't poison forward-fill)
    if (projectCell.toLowerCase() === "totals" || projectCell.toLowerCase() === "total") {
      continue;
    }

    if (projectCell) fillProject = projectCell;
    if (sourceCell) fillSource = sourceCell;
    if (sourceNameRaw) fillSourceName = sourceNameRaw;

    const project = fillProject;
    const source = fillSource;
    const sourceNameFilled = fillSourceName;
    const status = statusCell;

    // Skip if filled project is still a totals sentinel
    if (project.toLowerCase() === "totals" || project.toLowerCase() === "total") continue;

    const monthValues = {};
    let anyMonth = false;
    for (const m of monthsOrdered) monthValues[m] = 0;
    for (const col of colMap) {
      if (col.kind !== "month") continue;
      const v = coerceNumber(row[col.index]);
      monthValues[col.month] = v;
      if (v !== 0) anyMonth = true;
    }

    if (!project && !source && !sourceNameFilled && !status && !anyMonth) continue;

    const sourceNormalized = normalizeSourceName(sourceNameFilled);
    const out = {
      project,
      source,
      sourceNameRaw: sourceNameFilled,
      sourceNormalized: sourceNormalized || sourceNameFilled || "(blank)",
      months: monthValues,
    };
    if (statusIdx >= 0) out.status = status || "(blank)";
    rows.push(out);
  }

  const agg = emptyAggregates(monthsOrdered);
  const hasStatus = statusIdx >= 0;
  for (const row of rows) {
    const rowSum = bumpBucket(agg.byProject, row.project, row.months, monthsOrdered);
    bumpBucket(agg.bySource, row.sourceNormalized, row.months, monthsOrdered);
    if (hasStatus) {
      bumpBucket(agg.byStatus, row.status, row.months, monthsOrdered);
      const st = agg.byStatus[row.status || "(blank)"];
      if (!st.byProject) st.byProject = {};
      if (!st.bySource) st.bySource = {};
      bumpBucket(st.byProject, row.project, row.months, monthsOrdered);
      bumpBucket(st.bySource, row.sourceNormalized, row.months, monthsOrdered);
    }
    for (const m of monthsOrdered) {
      const v = Number(row.months[m] || 0);
      agg.byMonth[m] += v;
      agg.totals.byMonth[m] += v;
    }
    agg.totals.grand += rowSum;
  }

  const result = {
    ok: true,
    error: "",
    fileName: opts.fileName || "",
    kind: opts.kind || "",
    sheetName,
    months: monthsOrdered,
    rows,
    totals: agg.totals,
    byMonth: agg.byMonth,
    byProject: agg.byProject,
    bySource: agg.bySource,
  };
  if (hasStatus) {
    result.byStatus = agg.byStatus;
    result.leadDeclaration = computeLeadDeclaration(agg.byStatus, monthsOrdered);
  }
  return result;
}

function sheetPayload(parsed) {
  const out = {
    fileName: parsed.fileName || "",
    totals: parsed.totals,
    byMonth: parsed.byMonth,
    byProject: parsed.byProject,
    bySource: parsed.bySource,
    rows: parsed.rows,
  };
  if (parsed.byStatus) out.byStatus = parsed.byStatus;
  if (parsed.leadDeclaration) out.leadDeclaration = parsed.leadDeclaration;
  return out;
}

/**
 * Build the publish/preview payload from parsed Leads + Visits + Booked sheets.
 */
export function buildSalesGraphPayload(leadsParsed, visitsParsed, bookedParsed, {title} = {}) {
  if (!leadsParsed?.ok) throw new Error(leadsParsed?.error || "Leads file is invalid.");
  if (!visitsParsed?.ok) throw new Error(visitsParsed?.error || "Visits file is invalid.");
  if (!bookedParsed?.ok) throw new Error(bookedParsed?.error || "Booked file is invalid.");

  const monthSet = new Set([
    ...(leadsParsed.months || []),
    ...(visitsParsed.months || []),
    ...(bookedParsed.months || []),
  ]);
  const months = [...monthSet].sort((a, b) => a.localeCompare(b));

  const uploadedAt = new Date().toISOString();
  return {
    title: title || "Sales Graph",
    uploaded_at: uploadedAt,
    months,
    leads: sheetPayload(leadsParsed),
    visits: sheetPayload(visitsParsed),
    booked: sheetPayload(bookedParsed),
  };
}

export const _test = {coerceNumber, cellText, mergeHeaderRows, headerLabel, isYyyymm};

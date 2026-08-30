/**
 * TeleCalling Performance Report — Excel parse, metrics engine, published dashboard UI.
 */
import {PerfDashboardApi} from "./api-client.js?v=5.2.36";

const MASTER_FIELDS = [
  {id: "mobile", label: "Mobile", aliases: "mobile, mobile number, phone"},
  {id: "project", label: "Project Name", aliases: "project name, project"},
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
  "siteVisitCancelled",
  "notInterested",
  "overdue",
];
const METRIC_LABELS = {
  totalLeads: "Total Leads (Master + History)",
  activeLeads: "Active Leads (Master)",
  siteVisited: "Site Visited (STE)",
  siteVisitScheduled: "Site Visit Scheduled (SVS)",
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
  {key: "totalLeadsVsSiteVisitedPct", label: PCT_LABELS.totalLeadsVsSiteVisitedPct, kind: "pct"},
  {key: "siteVisitScheduledVsSiteVisitedPct", label: PCT_LABELS.siteVisitScheduledVsSiteVisitedPct, kind: "pct"},
  {key: "siteVisitCancelled", label: METRIC_LABELS.siteVisitCancelled, kind: "count"},
  {key: "notInterested", label: METRIC_LABELS.notInterested, kind: "count"},
  {key: "overdue", label: METRIC_LABELS.overdue, kind: "count"},
];

const PIE_KEYS = ["notInterested", "siteVisitScheduled", "siteVisitCancelled", "siteVisited", "overdue"];
const PIE_LABELS = {
  notInterested: "Not Interested",
  siteVisitScheduled: "Site Visit Scheduled",
  siteVisitCancelled: "Site Visit Cancelled",
  siteVisited: "Site Visited",
  overdue: "Overdue",
};

const CHART_COLORS = {
  bar: "#1f5d45",
  palette: ["#12372a", "#1f5d45", "#3f8c68", "#c57924", "#a33a32", "#2a5f9e", "#6c7771", "#9bb7a8"],
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
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  if (typeof value === "number" && window.XLSX?.SSF) {
    const d = XLSX.SSF.parse_date_code(value);
    if (d) return new Date(d.y, d.m - 1, d.d);
  }
  const s = clean(value);
  if (!s) return null;
  const iso = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (dmy) {
    let y = Number(dmy[3]);
    if (y < 100) y += 2000;
    return new Date(y, Number(dmy[2]) - 1, Number(dmy[1]));
  }
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.valueOf())) {
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  }
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
    siteVisitCancelled: 0,
    notInterested: 0,
    overdue: 0,
  };
}

function emptyPie() {
  return {
    notInterested: 0,
    siteVisitScheduled: 0,
    siteVisitCancelled: 0,
    siteVisited: 0,
    overdue: 0,
  };
}

function emptyTelecallerBucket() {
  return {...emptyMetrics(), pie: emptyPie(), _historyKeys: new Set(), _masterKeys: new Set()};
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

function leadKey(row) {
  let mobile = norm(row.mobile);
  // Excel often stores phones as numbers → "9876543210.0"
  if (/^\d+\.0+$/.test(mobile)) mobile = mobile.replace(/\.0+$/, "");
  const project = norm(row.project);
  if (!mobile && !project) return "";
  return `${mobile}|${project}`;
}

function finalizeBucket(bucket) {
  const masterKeys = bucket._masterKeys || new Set();
  const historyKeys = bucket._historyKeys || new Set();
  // Total Leads = unique leads across Master ∪ History (never History row count).
  const union = new Set([...masterKeys, ...historyKeys]);
  bucket.activeLeads = Number(bucket.activeLeads) || 0;
  bucket.historyLeads = historyKeys.size;
  bucket.totalLeads = union.size;
  bucket.pie = {
    notInterested: Number(bucket.notInterested) || 0,
    siteVisitScheduled: Number(bucket.siteVisitScheduled) || 0,
    siteVisitCancelled: Number(bucket.siteVisitCancelled) || 0,
    siteVisited: Number(bucket.siteVisited) || 0,
    overdue: Number(bucket.overdue) || 0,
  };
  delete bucket._historyKeys;
  delete bucket._masterKeys;
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
      const val = header ? clean(raw[header]) : "";
      obj[field.id] = val;
      if (val) blank = false;
    }
    if (blank) continue;
    obj.registrationDate = parseDateValue(obj.registration);
    obj.nextDate = parseDateValue(obj.next);
    obj.updateDate = parseDateValue(obj.update);
    obj.telecaller = clean(obj.telecaller) || "Unknown";
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

function matchesSentToEnquiry(status) {
  const s = norm(status);
  return s === "sent to enquiry" || s === "send to enquiry";
}

/**
 * Build performance metrics from parsed Master + History rows.
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

  const byTelecaller = {};
  const ensureTc = name => {
    const key = clean(name) || "Unknown";
    if (!byTelecaller[key]) byTelecaller[key] = emptyTelecallerBucket();
    return key;
  };

  const today = todayStart();
  for (const row of masterRows) {
    const tc = ensureTc(row.telecaller);
    const key = leadKey(row);
    byTelecaller[tc].activeLeads += 1;
    if (key) byTelecaller[tc]._masterKeys.add(key);
    if (row.nextDate && row.nextDate < today) {
      byTelecaller[tc].overdue += 1;
    }
  }

  for (const row of historyRows) {
    const tc = ensureTc(row.telecaller);
    const key = leadKey(row);
    // Unique History leads (Mobile+Project) — one lead can have many History rows.
    if (key) byTelecaller[tc]._historyKeys.add(key);
    const st = norm(row.status);
    const tcs = norm(row.telecallingStatus);
    if (st === "not interested") byTelecaller[tc].notInterested += 1;
    if (tcs === "site visit scheduled") byTelecaller[tc].siteVisitScheduled += 1;
    if (tcs === "site visit cancelled") byTelecaller[tc].siteVisitCancelled += 1;
    if (matchesSentToEnquiry(row.status)) byTelecaller[tc].siteVisited += 1;
  }

  for (const bucket of Object.values(byTelecaller)) finalizeBucket(bucket);

  const summary = emptyMetrics();
  for (const bucket of Object.values(byTelecaller)) {
    for (const key of METRIC_KEYS) summary[key] += Number(bucket[key] || 0);
  }

  const pie = sumPieSlices(Object.values(byTelecaller).map(b => b.pie));

  return {
    summary,
    byTelecaller,
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

function renderPieChart(canvas, pie, chartId) {
  const Chart = requireChart();
  const labels = [];
  const values = [];
  const colors = [];
  PIE_KEYS.forEach((key, i) => {
    const val = Number(pie[key] || 0);
    if (val > 0) {
      labels.push(PIE_LABELS[key]);
      values.push(val);
      colors.push(CHART_COLORS.palette[i % CHART_COLORS.palette.length]);
    }
  });
  const id = chartId || canvas.id || "perf-pie-chart";
  canvas.id = id;
  if (perfChartRegistry.has(id)) {
    perfChartRegistry.get(id).destroy();
    perfChartRegistry.delete(id);
  }
  const chart = new Chart(canvas.getContext("2d"), {
    type: "pie",
    data: {
      labels: labels.length ? labels : ["No data"],
      datasets: [{
        data: values.length ? values : [1],
        backgroundColor: values.length ? colors : ["#dfe5e1"],
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {legend: {position: "bottom", labels: {boxWidth: 12, font: {size: 11}}}},
    },
  });
  perfChartRegistry.set(id, chart);
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

function telecallerNames(data) {
  return Object.keys(data.byTelecaller || {}).sort((a, b) => a.localeCompare(b, undefined, {sensitivity: "base"}));
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

function renderTelecallerTable(mount, data) {
  const names = telecallerNames(data);
  if (!names.length) {
    const empty = document.createElement("div");
    empty.className = "empty-card";
    empty.textContent = "No telecaller data.";
    mount.append(empty);
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "perf-table-wrap";
  const table = document.createElement("table");
  table.className = "perf-scorecard";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const columns = [{key: "name", label: "Telecaller Name", kind: "name"}, ...SCORECARD_COLUMNS];
  for (const col of columns) {
    const th = document.createElement("th");
    th.textContent = col.label;
    headRow.append(th);
  }
  thead.append(headRow);
  table.append(thead);

  const tbody = document.createElement("tbody");
  for (const name of names) {
    const bucket = data.byTelecaller[name];
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

function renderSummaryPanel(mount, data) {
  mount.replaceChildren();
  const header = document.createElement("p");
  header.className = "perf-date-range";
  header.textContent = `Report period (from History Lead Update Date): ${formatDisplayDate(data.date_min)} – ${formatDisplayDate(data.date_max)}`;
  mount.append(header);

  const names = telecallerNames(data);
  const title = names.length === 1 ? `${names[0]} · totals` : "All TeleCallers · totals";
  renderTotalsBlock(mount, data.summary, title);

  const tableTitle = document.createElement("h3");
  tableTitle.className = "perf-section-title";
  tableTitle.textContent = "Telecaller breakdown";
  mount.append(tableTitle);
  renderTelecallerTable(mount, data);
}

function renderGraphsPanel(mount, data) {
  destroyPerfCharts();
  mount.replaceChildren();
  const names = telecallerNames(data);
  if (!names.length) {
    mount.innerHTML = '<div class="empty-card">No telecaller data to chart.</div>';
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
    const values = names.map(n => Number(data.byTelecaller[n]?.[metricKey] || 0));
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
      const b = data.byTelecaller[n] || emptyMetrics();
      if (pctKey === "totalLeadsVsSiteVisitedPct") return pct(b.siteVisited, b.totalLeads) ?? 0;
      return pct(b.siteVisited, b.siteVisitScheduled) ?? 0;
    });
    renderBarChart(canvas, names, values, "#2a5f9e");
  }

  const pieSection = document.createElement("div");
  pieSection.className = "perf-pie-section";
  const pieHeading = document.createElement("h3");
  pieHeading.className = "perf-section-title";
  pieHeading.textContent = names.length === 1 ? "Status breakdown" : "Status breakdown by Telecaller";
  pieSection.append(pieHeading);

  const pieGrid = document.createElement("div");
  pieGrid.className = "perf-pie-grid";
  for (const name of names) {
    const block = document.createElement("div");
    block.className = "perf-chart-block perf-chart-block-pie";
    const title = document.createElement("h4");
    title.textContent = name;
    block.append(title);
    const pieWrap = document.createElement("div");
    pieWrap.className = "perf-chart-wrap perf-chart-wrap-pie";
    const pieCanvas = document.createElement("canvas");
    pieWrap.append(pieCanvas);
    block.append(pieWrap);
    pieGrid.append(block);
    const pieData = pieFromBucket(data.byTelecaller[name]);
    renderPieChart(pieCanvas, pieData, `perf-pie-${name.replace(/\W+/g, "-")}`);
  }
  pieSection.append(pieGrid);
  mount.append(pieSection);

  if (names.length > 1) {
    const globalBlock = document.createElement("div");
    globalBlock.className = "perf-chart-block perf-chart-block-pie";
    const globalTitle = document.createElement("h4");
    globalTitle.textContent = "Combined status (all TeleCallers)";
    globalBlock.append(globalTitle);
    const pieWrap = document.createElement("div");
    pieWrap.className = "perf-chart-wrap perf-chart-wrap-pie";
    const pieCanvas = document.createElement("canvas");
    pieWrap.append(pieCanvas);
    globalBlock.append(pieWrap);
    mount.append(globalBlock);
    renderPieChart(pieCanvas, data.pie || emptyPie(), "perf-pie-combined");
  }
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
        byTelecaller: perfReconciled.byTelecaller,
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
let perfTcFilter = "__all__";

function setPerfTab(tab) {
  perfActiveTab = tab;
  document.querySelectorAll(".perf-view-tabs [data-perf-tab]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.perfTab === tab);
  });
  document.getElementById("perf-tab-summary")?.classList.toggle("hidden", tab !== "summary");
  document.getElementById("perf-tab-graphs")?.classList.toggle("hidden", tab !== "graphs");
  if (tab === "graphs" && perfCombinedCache) {
    renderGraphsPanel(document.getElementById("perf-tab-graphs"), filterByTelecaller(perfCombinedCache, perfTcFilter));
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
  document.getElementById("refresh-perf-published")?.addEventListener("click", () => refreshPerfPublished());

  const filterRow = document.getElementById("perf-filter-row");
  const filterSelect = document.getElementById("perf-tc-filter");
  filterSelect?.addEventListener("change", () => {
    perfTcFilter = filterSelect.value || "__all__";
    if (!perfCombinedCache) return;
    const filtered = filterByTelecaller(perfCombinedCache, perfTcFilter);
    renderSummaryPanel(document.getElementById("perf-tab-summary"), filtered);
    if (perfActiveTab === "graphs") {
      renderGraphsPanel(document.getElementById("perf-tab-graphs"), filtered);
    }
  });

  perfPublishedHandlers = {canViewAll, filterRow, filterSelect};
}

export async function refreshPerfPublished() {
  const empty = document.getElementById("perf-published-empty");
  const panel = document.getElementById("perf-published-panel");
  const titleEl = document.getElementById("perf-published-title");
  const metaEl = document.getElementById("perf-published-meta");
  const summaryMount = document.getElementById("perf-tab-summary");
  const graphsMount = document.getElementById("perf-tab-graphs");
  const {filterRow, filterSelect, canViewAll} = perfPublishedHandlers || {};

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

    const showFilter = Boolean(canViewAll?.() && data.view_all);
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

    if (summaryMount) renderSummaryPanel(summaryMount, filterByTelecaller(data, perfTcFilter));
    if (perfActiveTab === "graphs" && graphsMount) {
      renderGraphsPanel(graphsMount, filterByTelecaller(data, perfTcFilter));
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

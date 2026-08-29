/**
 * TeleCaller Performance Report — Master + History Excel → Summary + Graph.
 * No AI; parses with SheetJS; charts with Chart.js.
 */

const norm = value => String(value ?? "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
const clean = value => ["", "nan", "none", "nat", "undefined", "null"].includes(norm(value)) ? "" : String(value).trim();

/** Shared column aliases for Master / History workbooks. */
const PERF_FIELDS = [
  {id: "mobile", aliases: ["mobile", "mobile number", "mobile no", "phone", "phone number"]},
  {id: "project", aliases: ["project name", "project"]},
  {id: "registration", aliases: ["lead registration date", "registration date"]},
  {id: "next", aliases: ["next followup date", "next follow up date", "next follow-up date", "next followup", "next follow up", "followup date", "follow up date"]},
  {id: "update", aliases: ["lead update date", "lead update", "update date", "call date"]},
  {id: "status", aliases: ["telecalling status", "tele calling status", "calling status", "lead status", "status"]},
  {id: "telecaller", aliases: ["telecaller name", "tellecaller name", "tele caller name", "telle caller name", "caller name", "agent name", "executive name"]}
];

const MASTER_REQUIRED = ["mobile", "project", "registration", "next"];
const HISTORY_REQUIRED = ["mobile", "project", "update", "registration", "next", "status"];

const STATUS_NOT_INTERESTED = "not interested";
const STATUS_SV_SCHEDULED = "site visit scheduled";
const STATUS_SV_PENDING = "site visit pending";
const STATUS_SEND_TO_ENQUIRY = "send to enquiry";
const STATUS_SV_CANCELLED = "site visit cancelled";

const STATUS_CHART = [
  {key: "notInterested", label: "Not Interested", color: "#6c7771"},
  {key: "siteVisitScheduled", label: "Site Visit Scheduled", color: "#2f6fed"},
  {key: "siteVisitPending", label: "Site Visit Pending", color: "#c47a1a"},
  {key: "siteVisited", label: "Site Visited", color: "#1f6b4a"},
  {key: "siteVisitCancelled", label: "Site Visit Cancelled", color: "#a33a32"}
];

let statusChart = null;
let metricsChart = null;
let telecallerChart = null;

function parseDate(value){
  if(value instanceof Date && !Number.isNaN(value.valueOf())){
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  if(typeof value === "number" && window.XLSX?.SSF){
    const d = XLSX.SSF.parse_date_code(value);
    if(!d) return null;
    return new Date(d.y, d.m - 1, d.d);
  }
  const s = clean(value);
  if(!s) return null;
  const iso = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if(iso){
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(d.valueOf()) ? null : d;
  }
  const match = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if(match){
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = match[3].length === 2 ? Number(`20${match[3]}`) : Number(match[3]);
    if(month >= 1 && month <= 12 && day >= 1 && day <= 31){
      const d = new Date(year, month - 1, day);
      if(!Number.isNaN(d.valueOf()) && d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day) return d;
    }
  }
  const fallback = new Date(s);
  if(!Number.isNaN(fallback.valueOf())) return new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());
  return null;
}

function formatDate(d){
  if(!d) return "—";
  return d.toLocaleDateString("en-IN", {day: "2-digit", month: "short", year: "numeric"});
}

function sameCalendarDay(a, b){
  if(!a || !b) return false;
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Calendar-day compare: negative if a < b, 0 if equal, positive if a > b. Nulls sort last. */
function compareCalendarDay(a, b){
  if(!a && !b) return 0;
  if(!a) return 1;
  if(!b) return -1;
  const av = a.getFullYear() * 10000 + (a.getMonth() + 1) * 100 + a.getDate();
  const bv = b.getFullYear() * 10000 + (b.getMonth() + 1) * 100 + b.getDate();
  return av - bv;
}

function calendarBefore(a, b){
  return a && b && compareCalendarDay(a, b) < 0;
}

function inDateRange(d, min, max){
  if(!d || !min || !max) return false;
  return compareCalendarDay(d, min) >= 0 && compareCalendarDay(d, max) <= 0;
}

function matchColumns(headers){
  const normalized = (headers || []).map(header => ({header, key: norm(header)}));
  const columns = {};
  for(const field of PERF_FIELDS){
    const hit = field.aliases
      .map(alias => normalized.find(item => item.key === alias))
      .find(Boolean);
    columns[field.id] = hit?.header || "";
  }
  return columns;
}

function isTotalsRow(row, columns){
  const parts = [columns.mobile, columns.project, columns.telecaller]
    .map(col => norm(col ? row[col] : ""))
    .filter(Boolean);
  return parts.some(text => text === "total" || text === "totals" || /\btotals?\b/.test(text));
}

function leadKey(mobile, project){
  return `${norm(mobile)}|${norm(project)}`;
}

function pickBestSheet(workbook, requiredIds){
  const names = workbook.SheetNames || [];
  let best = null;
  for(const name of names){
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], {defval: "", raw: true});
    const headers = rows.length ? Object.keys(rows[0]) : [];
    const columns = matchColumns(headers);
    const requiredHits = requiredIds.filter(id => columns[id]).length;
    const optionalHits = PERF_FIELDS.map(f => f.id).filter(id => !requiredIds.includes(id) && columns[id]).length;
    const score = requiredHits * 10 + optionalHits;
    if(!best || score > best.score) best = {name, rows, headers, columns, score, requiredHits};
  }
  return best;
}

function requiredLabels(ids){
  const labels = {
    mobile: "Mobile",
    project: "Project Name",
    telecaller: "Telecaller Name",
    registration: "Lead Registration Date",
    next: "Next Followup Date",
    update: "Lead Update Date",
    status: "Telecalling Status"
  };
  return ids.map(id => labels[id] || id);
}

/**
 * Parse one workbook into normalized lead/call rows.
 * @param {"master"|"history"} kind
 */
export function parsePerfWorkbook(arrayBuffer, fileName = "workbook.xlsx", kind = "master"){
  if(typeof XLSX === "undefined") throw new Error("SheetJS failed to load. Check your network connection and reload.");
  const required = kind === "history" ? HISTORY_REQUIRED : MASTER_REQUIRED;
  const workbook = XLSX.read(arrayBuffer, {type: "array", cellDates: true});
  const selected = pickBestSheet(workbook, required);
  if(!selected || selected.requiredHits < required.length){
    const missing = required.filter(id => !selected?.columns?.[id]);
    const label = kind === "history" ? "History" : "Master";
    throw new Error(
      `Could not find required ${label} columns (${requiredLabels(missing).join(", ") || requiredLabels(required).join(", ")}). Check header names.`
    );
  }

  const {columns, rows, name: sheetName} = selected;
  const records = [];
  let minRegistration = null;
  let maxRegistration = null;
  let minUpdate = null;
  let maxUpdate = null;

  for(const row of rows){
    if(isTotalsRow(row, columns)) continue;
    const mobile = clean(row[columns.mobile]);
    const project = clean(row[columns.project]);
    if(!mobile && !project) continue;

    const telecaller = clean(row[columns.telecaller]) || "(Unnamed)";
    const registration = parseDate(row[columns.registration]);
    const next = parseDate(row[columns.next]);
    const update = columns.update ? parseDate(row[columns.update]) : null;
    const status = columns.status ? clean(row[columns.status]) : "";

    if(registration){
      if(!minRegistration || registration < minRegistration) minRegistration = registration;
      if(!maxRegistration || registration > maxRegistration) maxRegistration = registration;
    }
    if(update){
      if(!minUpdate || update < minUpdate) minUpdate = update;
      if(!maxUpdate || update > maxUpdate) maxUpdate = update;
    }

    records.push({
      mobile,
      project,
      telecaller,
      registration,
      next,
      update,
      status,
      key: leadKey(mobile, project)
    });
  }

  return {
    kind,
    fileName,
    sheetName,
    rowCount: records.length,
    minRegistration,
    maxRegistration,
    minUpdate,
    maxUpdate,
    records
  };
}

function latestHistoryRow(rows){
  if(!rows?.length) return null;
  let best = rows[0];
  for(let i = 1; i < rows.length; i++){
    const row = rows[i];
    const cmp = compareCalendarDay(row.update, best.update);
    if(cmp > 0) best = row;
    else if(cmp === 0 && (row.update?.valueOf?.() || 0) >= (best.update?.valueOf?.() || 0)) best = row;
  }
  return best;
}

function countOverdueCalls(rows){
  if(!rows || rows.length < 2) return 0;
  const sorted = [...rows].sort((a, b) => {
    const cmp = compareCalendarDay(a.update, b.update);
    if(cmp !== 0) return cmp;
    return (a.update?.valueOf?.() || 0) - (b.update?.valueOf?.() || 0);
  });
  let overdue = 0;
  for(let i = 0; i < sorted.length - 1; i++){
    const nextFollowup = sorted[i].next;
    const nextCallUpdate = sorted[i + 1].update;
    if(calendarBefore(nextFollowup, nextCallUpdate)) overdue += 1;
  }
  return overdue;
}

function collectTelecallers(masterParsed, historyParsed){
  const set = new Set();
  for(const rec of masterParsed.records){
    if(rec.telecaller) set.add(rec.telecaller);
  }
  for(const rec of historyParsed.records){
    if(rec.telecaller) set.add(rec.telecaller);
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, {sensitivity: "base"}));
}

function emptyStatusBucket(){
  return {
    totalActiveLeads: 0,
    totalFreshLeadAssigned: 0,
    notInterested: 0,
    siteVisitScheduled: 0,
    siteVisitPending: 0,
    siteVisited: 0,
    siteVisitCancelled: 0,
    overdueCalls: 0,
    freshLeadsNotCalledYet: 0
  };
}

/**
 * Reconcile Master + History into Summary KPIs.
 * Date range always from full History Lead Update Date min–max.
 * Optional telecaller filter scopes Master/History rows to that agent.
 * @param {{telecaller?: string|null}} [options]
 */
export function reconcilePerf(masterParsed, historyParsed, options = {}){
  const telecallerFilter = clean(options.telecaller || "") || null;
  const telecallers = collectTelecallers(masterParsed, historyParsed);

  let dateMin = historyParsed.minUpdate || null;
  let dateMax = historyParsed.maxUpdate || null;
  if(!dateMin || !dateMax){
    for(const rec of historyParsed.records){
      if(!rec.update) continue;
      if(!dateMin || rec.update < dateMin) dateMin = rec.update;
      if(!dateMax || rec.update > dateMax) dateMax = rec.update;
    }
  }

  const masterRecords = telecallerFilter
    ? masterParsed.records.filter(rec => rec.telecaller === telecallerFilter)
    : masterParsed.records;
  const historyRecords = telecallerFilter
    ? historyParsed.records.filter(rec => rec.telecaller === telecallerFilter)
    : historyParsed.records;

  // Full History key set (unfiltered) for Draft / Fresh-not-called: a lead is "in History"
  // if any History row exists for that Mobile+Project, even from another TeleCaller.
  const allHistoryKeys = new Set(historyParsed.records.map(rec => rec.key));

  const historyByKey = new Map();
  for(const rec of historyRecords){
    if(!historyByKey.has(rec.key)) historyByKey.set(rec.key, []);
    historyByKey.get(rec.key).push(rec);
  }

  let notInterested = 0;
  let siteVisitScheduled = 0;
  let siteVisitPending = 0;
  let siteVisited = 0;
  let siteVisitCancelled = 0;
  let overdueCalls = 0;
  let historyFreshInRange = 0;

  for(const rows of historyByKey.values()){
    overdueCalls += countOverdueCalls(rows);
    const latest = latestHistoryRow(rows);
    const statusKey = norm(latest?.status);
    if(statusKey === STATUS_NOT_INTERESTED) notInterested += 1;
    else if(statusKey === STATUS_SV_SCHEDULED) siteVisitScheduled += 1;
    else if(statusKey === STATUS_SV_PENDING) siteVisitPending += 1;
    else if(statusKey === STATUS_SEND_TO_ENQUIRY) siteVisited += 1;
    else if(statusKey === STATUS_SV_CANCELLED) siteVisitCancelled += 1;

    const reg = latest?.registration || rows.find(r => r.registration)?.registration || null;
    if(inDateRange(reg, dateMin, dateMax)) historyFreshInRange += 1;
  }

  let draftInRange = 0;
  let freshLeadsNotCalledYet = 0;

  for(const rec of masterRecords){
    if(allHistoryKeys.has(rec.key)) continue;
    const regEqualsNext = sameCalendarDay(rec.registration, rec.next);
    if(regEqualsNext){
      freshLeadsNotCalledYet += 1;
    }else if(inDateRange(rec.registration, dateMin, dateMax)){
      draftInRange += 1;
    }
  }

  const totalActiveLeads = masterRecords.length;
  const totalFreshLeadAssigned = historyFreshInRange + draftInRange;

  // Per-TeleCaller breakdown (always from full files) for Graph when viewing All
  const byTelecaller = Object.create(null);
  for(const name of telecallers){
    byTelecaller[name] = emptyStatusBucket();
  }

  const historyByKeyAll = new Map();
  for(const rec of historyParsed.records){
    if(!historyByKeyAll.has(rec.key)) historyByKeyAll.set(rec.key, []);
    historyByKeyAll.get(rec.key).push(rec);
  }

  // Status / overdue / fresh-from-history attributed to latest call's telecaller
  for(const rows of historyByKeyAll.values()){
    const byTc = Object.create(null);
    for(const row of rows){
      if(!byTc[row.telecaller]) byTc[row.telecaller] = [];
      byTc[row.telecaller].push(row);
    }
    for(const [tc, tcRows] of Object.entries(byTc)){
      const bucket = byTelecaller[tc] || (byTelecaller[tc] = emptyStatusBucket());
      bucket.overdueCalls += countOverdueCalls(tcRows);
      const latest = latestHistoryRow(tcRows);
      const statusKey = norm(latest?.status);
      if(statusKey === STATUS_NOT_INTERESTED) bucket.notInterested += 1;
      else if(statusKey === STATUS_SV_SCHEDULED) bucket.siteVisitScheduled += 1;
      else if(statusKey === STATUS_SV_PENDING) bucket.siteVisitPending += 1;
      else if(statusKey === STATUS_SEND_TO_ENQUIRY) bucket.siteVisited += 1;
      else if(statusKey === STATUS_SV_CANCELLED) bucket.siteVisitCancelled += 1;
      const reg = latest?.registration || tcRows.find(r => r.registration)?.registration || null;
      if(inDateRange(reg, dateMin, dateMax)) bucket.totalFreshLeadAssigned += 1;
    }
  }

  for(const rec of masterParsed.records){
    const bucket = byTelecaller[rec.telecaller] || (byTelecaller[rec.telecaller] = emptyStatusBucket());
    bucket.totalActiveLeads += 1;
    if(allHistoryKeys.has(rec.key)) continue;
    const regEqualsNext = sameCalendarDay(rec.registration, rec.next);
    if(regEqualsNext){
      bucket.freshLeadsNotCalledYet += 1;
    }else if(inDateRange(rec.registration, dateMin, dateMax)){
      bucket.totalFreshLeadAssigned += 1;
    }
  }

  return {
    masterFileName: masterParsed.fileName,
    historyFileName: historyParsed.fileName,
    masterSheet: masterParsed.sheetName,
    historySheet: historyParsed.sheetName,
    masterRowCount: masterParsed.rowCount,
    historyRowCount: historyParsed.rowCount,
    telecallerFilter,
    telecallers,
    dateMin,
    dateMax,
    totalActiveLeads,
    totalFreshLeadAssigned,
    notInterested,
    siteVisitScheduled,
    siteVisitPending,
    siteVisited,
    siteVisitCancelled,
    overdueCalls,
    freshLeadsNotCalledYet,
    byTelecaller
  };
}

function setHidden(el, hidden){
  if(!el) return;
  el.classList.toggle("hidden", Boolean(hidden));
}

function destroyCharts(){
  for(const chart of [statusChart, metricsChart, telecallerChart]){
    if(!chart) continue;
    try{ chart.destroy(); }catch{/* ignore */}
  }
  statusChart = null;
  metricsChart = null;
  telecallerChart = null;
}

function renderFileMeta(el, fileName, detail){
  if(!el) return;
  el.innerHTML = "";
  const left = document.createElement("div");
  const icon = document.createElement("span");
  icon.className = "file-icon";
  icon.textContent = "X";
  const copy = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = fileName;
  const p = document.createElement("p");
  p.textContent = detail;
  copy.append(strong, p);
  left.append(icon, copy);
  el.append(left);
  setHidden(el, false);
}

function wireDropZone(dropZone, fileInput, onFile){
  if(!dropZone || !fileInput) return;
  dropZone.onclick = () => fileInput.click();
  dropZone.onkeydown = event => {
    if(["Enter", " "].includes(event.key)){
      event.preventDefault();
      fileInput.click();
    }
  };
  for(const event of ["dragenter", "dragover"]){
    dropZone.addEventListener(event, e => {
      e.preventDefault();
      dropZone.classList.add("dragover");
    });
  }
  for(const event of ["dragleave", "drop"]){
    dropZone.addEventListener(event, e => {
      e.preventDefault();
      dropZone.classList.remove("dragover");
    });
  }
  dropZone.addEventListener("drop", event => {
    const files = [...event.dataTransfer?.files || []].filter(f => /\.(xlsx|xls|xlsm)$/i.test(f.name));
    if(files[0]) onFile(files[0]);
  });
  fileInput.onchange = event => {
    const file = event.target.files?.[0];
    if(file) onFile(file);
    fileInput.value = "";
  };
}

function fillSummary(el, model){
  if(!el) return;
  const items = [
    {label: "Total Active Leads", value: model.totalActiveLeads},
    {label: "Total Fresh Lead Assigned", value: model.totalFreshLeadAssigned},
    {label: "Not Interested", value: model.notInterested},
    {label: "Site Visit Scheduled", value: model.siteVisitScheduled},
    {label: "Site Visit Pending", value: model.siteVisitPending},
    {label: "Site Visited", value: model.siteVisited},
    {label: "Site Visit Cancelled", value: model.siteVisitCancelled},
    {label: "Overdue", value: model.overdueCalls},
    {label: "Fresh Leads Not Called Yet", value: model.freshLeadsNotCalledYet}
  ];
  el.innerHTML = "";
  const dl = document.createElement("dl");
  dl.className = "perf-summary-list";
  for(const item of items){
    const row = document.createElement("div");
    row.className = "perf-summary-row";
    const dt = document.createElement("dt");
    dt.textContent = item.label;
    const dd = document.createElement("dd");
    dd.textContent = Number(item.value).toLocaleString();
    row.append(dt, dd);
    dl.append(row);
  }
  el.append(dl);
}

function fillTelecallerFilter(select, telecallers, selected){
  if(!select) return;
  const current = selected ?? select.value ?? "";
  select.innerHTML = "";
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "All TeleCallers";
  select.append(all);
  for(const name of telecallers){
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    select.append(opt);
  }
  select.value = telecallers.includes(current) ? current : "";
}

function renderGraphs(model){
  destroyCharts();
  if(typeof Chart !== "function") throw new Error("Chart.js failed to load. Check your network connection and reload.");

  const statusCanvas = document.getElementById("perf-status-chart");
  const metricsCanvas = document.getElementById("perf-metrics-chart");
  const tcCanvas = document.getElementById("perf-tc-chart");
  const tcBlock = document.getElementById("perf-tc-chart-block");

  if(statusCanvas){
    const labels = STATUS_CHART.map(s => s.label);
    const data = STATUS_CHART.map(s => model[s.key] || 0);
    const colors = STATUS_CHART.map(s => s.color);
    statusChart = new Chart(statusCanvas.getContext("2d"), {
      type: "doughnut",
      data: {
        labels,
        datasets: [{data, backgroundColor: colors, borderWidth: 0}]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {position: "bottom", labels: {boxWidth: 12, color: "#24312b"}}
        }
      }
    });
  }

  if(metricsCanvas){
    const metricItems = [
      {label: "Active", value: model.totalActiveLeads, color: "#12372a"},
      {label: "Fresh Assigned", value: model.totalFreshLeadAssigned, color: "#1f6b4a"},
      {label: "Overdue", value: model.overdueCalls, color: "#a33a32"},
      {label: "Not Called Yet", value: model.freshLeadsNotCalledYet, color: "#c47a1a"}
    ];
    metricsChart = new Chart(metricsCanvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: metricItems.map(m => m.label),
        datasets: [{
          label: "Count",
          data: metricItems.map(m => m.value),
          backgroundColor: metricItems.map(m => m.color),
          borderWidth: 0,
          borderRadius: 4,
          maxBarThickness: 48
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {legend: {display: false}},
        scales: {
          x: {ticks: {color: "#6c7771"}, grid: {display: false}},
          y: {beginAtZero: true, ticks: {color: "#6c7771", precision: 0}, grid: {color: "rgba(223,229,225,.7)"}}
        }
      }
    });
  }

  const showPerTc = !model.telecallerFilter && model.telecallers?.length;
  setHidden(tcBlock, !showPerTc);
  if(showPerTc && tcCanvas){
    const names = model.telecallers;
    const wrap = document.getElementById("perf-tc-chart-wrap");
    if(wrap) wrap.style.height = `${Math.max(280, names.length * 28)}px`;
    telecallerChart = new Chart(tcCanvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: names,
        datasets: STATUS_CHART.map(status => ({
          label: status.label,
          data: names.map(tc => model.byTelecaller?.[tc]?.[status.key] || 0),
          backgroundColor: status.color,
          borderWidth: 0,
          borderRadius: 2,
          maxBarThickness: 18
        }))
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: "y",
        plugins: {
          legend: {position: "bottom", labels: {boxWidth: 12, color: "#24312b"}}
        },
        scales: {
          x: {stacked: true, beginAtZero: true, ticks: {color: "#6c7771", precision: 0}, grid: {color: "rgba(223,229,225,.7)"}},
          y: {stacked: true, ticks: {color: "#6c7771"}, grid: {display: false}}
        }
      }
    });
  }
}

/**
 * Wire dual upload + Summary/Graph UI inside #view-perf-dashboard.
 * @param {{toast?: (msg: string) => void}} opts
 */
export function mountPerfDashboard(opts = {}){
  const toast = typeof opts.toast === "function" ? opts.toast : () => {};
  const masterDrop = document.getElementById("perf-master-drop");
  const historyDrop = document.getElementById("perf-history-drop");
  const masterInput = document.getElementById("perf-master-input");
  const historyInput = document.getElementById("perf-history-input");
  const masterMeta = document.getElementById("perf-master-meta");
  const historyMeta = document.getElementById("perf-history-meta");
  const validation = document.getElementById("perf-validation");
  const buildBtn = document.getElementById("perf-build");
  const results = document.getElementById("perf-results");
  const dateRangeEl = document.getElementById("perf-date-range");
  const summaryPanel = document.getElementById("perf-summary-panel");
  const graphPanel = document.getElementById("perf-graph-panel");
  const summaryEl = document.getElementById("perf-summary");
  const viewToggle = document.getElementById("perf-view-toggle");
  const telecallerSelect = document.getElementById("perf-telecaller-filter");

  if(!masterDrop || !historyDrop || !buildBtn) return {destroy: destroyCharts};

  let masterParsed = null;
  let historyParsed = null;
  let activeView = "summary";
  let lastModel = null;

  function showValidation(message, isError){
    if(!validation) return;
    validation.textContent = message || "";
    validation.classList.toggle("error", Boolean(isError));
    setHidden(validation, !message);
  }

  function updateBuildEnabled(){
    buildBtn.disabled = !(masterParsed && historyParsed);
  }

  function setView(view){
    activeView = view === "graph" ? "graph" : "summary";
    if(viewToggle){
      for(const btn of viewToggle.querySelectorAll("[data-perf-view]")){
        btn.classList.toggle("active", btn.getAttribute("data-perf-view") === activeView);
      }
    }
    setHidden(summaryPanel, activeView !== "summary");
    setHidden(graphPanel, activeView !== "graph");
    if(activeView === "graph" && lastModel){
      try{ renderGraphs(lastModel); }
      catch(err){ showValidation(err?.message || "Could not render graphs.", true); }
    }
  }

  function applyModel(model){
    lastModel = model;
    if(dateRangeEl){
      if(model.dateMin && model.dateMax){
        dateRangeEl.innerHTML = `<span>Lead Update Date</span><strong>${formatDate(model.dateMin)} – ${formatDate(model.dateMax)}</strong>`;
      }else{
        dateRangeEl.innerHTML = `<span>Lead Update Date</span><strong>No valid dates found</strong>`;
      }
    }
    fillSummary(summaryEl, model);
    if(activeView === "graph") renderGraphs(model);
    else destroyCharts();
  }

  function rebuildFromFilter(){
    if(!masterParsed || !historyParsed) return;
    try{
      const telecaller = telecallerSelect?.value || "";
      const model = reconcilePerf(masterParsed, historyParsed, {telecaller});
      applyModel(model);
      const filterNote = telecaller ? ` · ${telecaller}` : "";
      showValidation(
        `Summary ready${filterNote} · ${model.totalActiveLeads.toLocaleString()} active leads · ${model.historyRowCount.toLocaleString()} History call rows.`,
        false
      );
      setHidden(results, false);
    }catch(err){
      setHidden(results, true);
      destroyCharts();
      showValidation(err?.message || "Could not build dashboard.", true);
      toast(err?.message || "Build failed.");
    }
  }

  async function loadWorkbook(file, kind){
    showValidation(`Reading ${kind === "history" ? "History" : "Master"} workbook…`, false);
    setHidden(results, true);
    destroyCharts();
    lastModel = null;
    try{
      const buffer = await file.arrayBuffer();
      const parsed = parsePerfWorkbook(buffer, file.name, kind);
      if(kind === "master"){
        masterParsed = parsed;
        renderFileMeta(masterMeta, file.name, `${parsed.rowCount.toLocaleString()} leads · sheet “${parsed.sheetName}”`);
      }else{
        historyParsed = parsed;
        renderFileMeta(historyMeta, file.name, `${parsed.rowCount.toLocaleString()} call rows · sheet “${parsed.sheetName}”`);
      }
      updateBuildEnabled();
      const ready = masterParsed && historyParsed;
      showValidation(
        ready
          ? "Both files loaded. Click Build dashboard."
          : `${kind === "history" ? "History" : "Master"} loaded (${parsed.rowCount.toLocaleString()} rows). Upload the other file to continue.`,
        false
      );
      toast(`${kind === "history" ? "History" : "Master"} file ready.`);
    }catch(err){
      if(kind === "master"){
        masterParsed = null;
        setHidden(masterMeta, true);
      }else{
        historyParsed = null;
        setHidden(historyMeta, true);
      }
      updateBuildEnabled();
      showValidation(err?.message || "Could not read that workbook.", true);
      toast(err?.message || "Upload failed.");
    }
  }

  function buildDashboard(){
    if(!masterParsed || !historyParsed){
      showValidation("Upload both Master and History Excel files first.", true);
      return;
    }
    try{
      const telecallers = collectTelecallers(masterParsed, historyParsed);
      fillTelecallerFilter(telecallerSelect, telecallers, telecallerSelect?.value || "");
      rebuildFromFilter();
      setView(activeView);
      toast("Performance summary ready.");
    }catch(err){
      setHidden(results, true);
      destroyCharts();
      showValidation(err?.message || "Could not build dashboard.", true);
      toast(err?.message || "Build failed.");
    }
  }

  wireDropZone(masterDrop, masterInput, file => loadWorkbook(file, "master"));
  wireDropZone(historyDrop, historyInput, file => loadWorkbook(file, "history"));
  buildBtn.onclick = buildDashboard;

  if(telecallerSelect){
    telecallerSelect.addEventListener("change", () => {
      if(!masterParsed || !historyParsed || !lastModel) return;
      rebuildFromFilter();
      toast(telecallerSelect.value ? `Filtered to ${telecallerSelect.value}` : "Showing all TeleCallers");
    });
  }

  if(viewToggle){
    viewToggle.addEventListener("click", event => {
      const btn = event.target.closest("[data-perf-view]");
      if(!btn) return;
      setView(btn.getAttribute("data-perf-view"));
    });
  }

  setView("summary");

  return {destroy: destroyCharts};
}

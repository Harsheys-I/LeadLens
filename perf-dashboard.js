/**
 * TeleCalling Performance Report — Excel parse, metrics engine, published dashboard UI.
 */
import {PerfDashboardApi} from "./api-client.js?v=5.2.33";

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

const METRIC_KEYS = ["totalActiveLeads", "totalNewLeads", "leadsWithoutCalls", "totalCalls", "overdue"];
const METRIC_LABELS = {
  totalActiveLeads: "Total Active Leads",
  totalNewLeads: "Total New Leads",
  leadsWithoutCalls: "Total Leads without Calls",
  totalCalls: "Total Calls",
  overdue: "Overdue",
};

const PIE_KEYS = ["notInterested", "siteVisitScheduled", "siteVisitPending", "siteVisitCancelled", "sentToEnquiry", "draft"];
const PIE_LABELS = {
  notInterested: "Not Interested",
  siteVisitScheduled: "Site Visit Scheduled",
  siteVisitPending: "Site Visit Pending",
  siteVisitCancelled: "Site Visit Cancelled",
  sentToEnquiry: "Sent to Enquiry",
  draft: "Draft",
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
    totalActiveLeads: 0,
    totalNewLeads: 0,
    leadsWithoutCalls: 0,
    totalCalls: 0,
    overdue: 0,
  };
}

function emptyPie() {
  return {
    notInterested: 0,
    siteVisitScheduled: 0,
    siteVisitPending: 0,
    siteVisitCancelled: 0,
    sentToEnquiry: 0,
    draft: 0,
  };
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

function inDateRange(date, min, max) {
  if (!date || !min || !max) return false;
  const t = date.getTime();
  return t >= min.getTime() && t <= max.getTime();
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
    if (!byTelecaller[key]) byTelecaller[key] = emptyMetrics();
    return key;
  };

  const today = todayStart();
  for (const row of masterRows) {
    const tc = ensureTc(row.telecaller);
    byTelecaller[tc].totalActiveLeads += 1;
    if (dateMin && dateMax && inDateRange(row.registrationDate, dateMin, dateMax)) {
      byTelecaller[tc].totalNewLeads += 1;
    }
    if (norm(row.status) === "draft") {
      byTelecaller[tc].leadsWithoutCalls += 1;
    }
    if (row.nextDate && row.nextDate < today) {
      byTelecaller[tc].overdue += 1;
    }
  }

  for (const row of historyRows) {
    const tc = ensureTc(row.telecaller);
    byTelecaller[tc].totalCalls += 1;
  }

  const summary = emptyMetrics();
  for (const metrics of Object.values(byTelecaller)) {
    for (const key of METRIC_KEYS) summary[key] += metrics[key];
  }

  const pie = emptyPie();
  for (const row of historyRows) {
    const st = norm(row.status);
    const tcs = norm(row.telecallingStatus);
    if (st === "not interested") pie.notInterested += 1;
    if (tcs === "site visit scheduled") pie.siteVisitScheduled += 1;
    if (tcs === "site visit pending") pie.siteVisitPending += 1;
    if (tcs === "site visit cancelled") pie.siteVisitCancelled += 1;
    if (matchesSentToEnquiry(row.status)) pie.sentToEnquiry += 1;
  }
  for (const row of masterRows) {
    if (norm(row.status) === "draft") pie.draft += 1;
  }

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

function renderPieChart(canvas, pie) {
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
  const id = canvas.id || "perf-pie-chart";
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
      byTelecaller: {},
    };
  }
  return {
    ...data,
    summary: {...slice},
    byTelecaller: {[tcFilter]: slice},
  };
}

function renderSummaryPanel(mount, data) {
  mount.replaceChildren();
  const header = document.createElement("p");
  header.className = "perf-date-range";
  header.textContent = `Report period (from History Lead Update Date): ${formatDisplayDate(data.date_min)} – ${formatDisplayDate(data.date_max)}`;
  mount.append(header);

  const list = document.createElement("dl");
  list.className = "perf-summary-list";
  for (const key of METRIC_KEYS) {
    const row = document.createElement("div");
    row.className = "perf-summary-row";
    const dt = document.createElement("dt");
    dt.textContent = METRIC_LABELS[key];
    const dd = document.createElement("dd");
    dd.textContent = String(data.summary?.[key] ?? 0);
    row.append(dt, dd);
    list.append(row);
  }
  mount.append(list);
}

function renderGraphsPanel(mount, data) {
  destroyPerfCharts();
  mount.replaceChildren();
  const names = Object.keys(data.byTelecaller || {}).sort((a, b) => a.localeCompare(b, undefined, {sensitivity: "base"}));
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

  const pieBlock = document.createElement("div");
  pieBlock.className = "perf-chart-block perf-chart-block-pie";
  const pieTitle = document.createElement("h3");
  pieTitle.textContent = "Status breakdown";
  pieBlock.append(pieTitle);
  const pieWrap = document.createElement("div");
  pieWrap.className = "perf-chart-wrap perf-chart-wrap-pie";
  const pieCanvas = document.createElement("canvas");
  pieWrap.append(pieCanvas);
  pieBlock.append(pieWrap);
  mount.append(pieBlock);
  renderPieChart(pieCanvas, data.pie || emptyPie());
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
    const dashboards = selected.map(name => ({
      telecaller_name: name,
      title: `${name} · Performance`,
      summary: perfReconciled.byTelecaller[name] || emptyMetrics(),
      byTelecaller: perfReconciled.byTelecaller,
      pie: perfReconciled.pie,
      date_min: perfReconciled.dateMin,
      date_max: perfReconciled.dateMax,
    }));
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
    if (perfActiveTab === "graphs") {
      renderGraphsPanel(
        document.getElementById("perf-tab-graphs"),
        filterByTelecaller(perfCombinedCache, perfTcFilter),
      );
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

    if (summaryMount) renderSummaryPanel(summaryMount, data);
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

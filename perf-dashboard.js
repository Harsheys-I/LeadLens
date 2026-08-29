/**
 * TeleCaller Performance Report — Master + History Excel reconcile + KPIs.
 * No AI; parses with SheetJS and renders with Chart.js (both already on the page).
 */

const norm = value => String(value ?? "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
const clean = value => ["", "nan", "none", "nat", "undefined", "null"].includes(norm(value)) ? "" : String(value).trim();

/** Shared column aliases for Master / History workbooks. */
const PERF_FIELDS = [
  {id: "mobile", aliases: ["mobile", "mobile number", "mobile no", "phone", "phone number"]},
  {id: "project", aliases: ["project name", "project"]},
  {id: "registration", aliases: ["lead registration date", "registration date"]},
  {id: "next", aliases: ["next followup date", "next follow up date", "next follow-up date", "next followup", "next follow up", "followup date", "follow up date"]},
  {id: "update", aliases: ["lead update", "lead update date", "update date", "call date"]},
  {id: "telecaller", aliases: ["telecaller name", "tellecaller name", "tele caller name", "telle caller name", "caller name", "agent name", "executive name"]}
];

const MASTER_REQUIRED = ["mobile", "project", "telecaller", "registration", "next"];
const HISTORY_REQUIRED = ["mobile", "project", "telecaller", "registration", "next"];

const STATUS_MATCHED = "Matched — audit TBD";
const STATUS_DRAFT = "Draft";
const STATUS_MISSING_HISTORY = "First call made, missing from History";

let overdueChart = null;

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

/** Integer overdue days: (today − nextDay) / 86400000. Missing next → "". Today → 0. Matches audit.js overdueDays. */
function overdueDays(next){
  const nextDay = next instanceof Date && !Number.isNaN(next.valueOf())
    ? new Date(next.getFullYear(), next.getMonth(), next.getDate())
    : parseDate(next);
  if(!nextDay) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((today - nextDay) / 86400000);
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
    update: "Lead Update"
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

  for(const row of rows){
    if(isTotalsRow(row, columns)) continue;
    const mobile = clean(row[columns.mobile]);
    const project = clean(row[columns.project]);
    if(!mobile && !project) continue;

    const telecaller = clean(row[columns.telecaller]) || "(Unnamed)";
    const registration = parseDate(row[columns.registration]);
    const next = parseDate(row[columns.next]);
    const update = columns.update ? parseDate(row[columns.update]) : null;

    if(registration){
      if(!minRegistration || registration < minRegistration) minRegistration = registration;
      if(!maxRegistration || registration > maxRegistration) maxRegistration = registration;
    }

    records.push({
      mobile,
      project,
      telecaller,
      registration,
      next,
      update,
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
    records
  };
}

function emptyTcBucket(){
  return {leadsInHistory: 0, calls: 0, missed: 0, overdueLeads: 0, overdueDaysSum: 0};
}

/**
 * Reconcile Master + History: match on Mobile+Project, orphans, Draft/missing + overdue.
 */
export function reconcilePerf(masterParsed, historyParsed){
  const historyByKey = new Map();
  for(const rec of historyParsed.records){
    if(!historyByKey.has(rec.key)) historyByKey.set(rec.key, []);
    historyByKey.get(rec.key).push(rec);
  }

  const masterKeys = new Set();
  const masterResults = [];
  const byTelecaller = Object.create(null);

  function ensureTc(name){
    if(!byTelecaller[name]) byTelecaller[name] = emptyTcBucket();
    return byTelecaller[name];
  }

  for(const rec of masterParsed.records){
    masterKeys.add(rec.key);
    const histRows = historyByKey.get(rec.key);
    let status;
    let overdue = "";

    if(histRows?.length){
      status = STATUS_MATCHED;
    }else{
      const isDraft = sameCalendarDay(rec.registration, rec.next);
      status = isDraft ? STATUS_DRAFT : STATUS_MISSING_HISTORY;
      overdue = overdueDays(rec.next);
      const bucket = ensureTc(rec.telecaller);
      bucket.missed += 1;
      if(typeof overdue === "number" && overdue > 0){
        bucket.overdueLeads += 1;
        bucket.overdueDaysSum += overdue;
      }
    }

    masterResults.push({
      mobile: rec.mobile,
      project: rec.project,
      telecaller: rec.telecaller,
      status,
      overdue,
      matched: Boolean(histRows?.length)
    });
  }

  const orphanKeys = [];
  for(const key of historyByKey.keys()){
    if(!masterKeys.has(key)){
      const sample = historyByKey.get(key)[0];
      orphanKeys.push({mobile: sample.mobile, project: sample.project});
    }
  }
  orphanKeys.sort((a, b) =>
    a.project.localeCompare(b.project, undefined, {sensitivity: "base"})
    || a.mobile.localeCompare(b.mobile, undefined, {sensitivity: "base"})
  );

  // History metrics: distinct leads + call rows per telecaller (History telecaller)
  const historyLeadKeysByTc = Object.create(null);
  for(const rec of historyParsed.records){
    const bucket = ensureTc(rec.telecaller);
    bucket.calls += 1;
    if(!historyLeadKeysByTc[rec.telecaller]) historyLeadKeysByTc[rec.telecaller] = new Set();
    historyLeadKeysByTc[rec.telecaller].add(rec.key);
  }
  for(const [tc, keys] of Object.entries(historyLeadKeysByTc)){
    ensureTc(tc).leadsInHistory = keys.size;
  }

  const historyLeadCount = historyByKey.size;
  const callsTotal = historyParsed.records.length;
  const missedTotal = masterResults.filter(r => !r.matched).length;
  const matchedTotal = masterResults.filter(r => r.matched).length;
  const overdueLeadTotal = masterResults.filter(r => typeof r.overdue === "number" && r.overdue > 0).length;

  let minRegistration = null;
  let maxRegistration = null;
  for(const parsed of [masterParsed, historyParsed]){
    if(parsed.minRegistration && (!minRegistration || parsed.minRegistration < minRegistration)) minRegistration = parsed.minRegistration;
    if(parsed.maxRegistration && (!maxRegistration || parsed.maxRegistration > maxRegistration)) maxRegistration = parsed.maxRegistration;
  }

  const telecallers = Object.keys(byTelecaller).sort((a, b) => a.localeCompare(b, undefined, {sensitivity: "base"}));

  return {
    masterFileName: masterParsed.fileName,
    historyFileName: historyParsed.fileName,
    masterSheet: masterParsed.sheetName,
    historySheet: historyParsed.sheetName,
    masterRowCount: masterParsed.rowCount,
    historyRowCount: historyParsed.rowCount,
    minRegistration,
    maxRegistration,
    historyLeadCount,
    callsTotal,
    missedTotal,
    matchedTotal,
    overdueLeadTotal,
    orphans: orphanKeys,
    masterResults,
    telecallers,
    byTelecaller
  };
}

function destroyChart(){
  if(overdueChart){
    try{ overdueChart.destroy(); }catch{/* ignore */}
    overdueChart = null;
  }
}

function renderOverdueChart(canvas, model){
  destroyChart();
  if(typeof Chart !== "function") throw new Error("Chart.js failed to load. Check your network connection and reload.");

  const labels = model.telecallers.filter(tc => (model.byTelecaller[tc]?.overdueLeads || 0) > 0);
  const dataLabels = labels.length ? labels : model.telecallers;
  const data = dataLabels.map(tc => model.byTelecaller[tc]?.overdueLeads || 0);
  const many = dataLabels.length > 8;

  overdueChart = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: dataLabels,
      datasets: [{
        label: "Overdue leads",
        data,
        backgroundColor: "#a33a32",
        borderWidth: 0,
        borderRadius: 3,
        maxBarThickness: 36
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: many ? "y" : "x",
      plugins: {
        legend: {display: false},
        tooltip: {
          callbacks: {
            afterLabel(ctx){
              const tc = dataLabels[ctx.dataIndex];
              const sum = model.byTelecaller[tc]?.overdueDaysSum || 0;
              return sum ? `Sum of overdue days: ${sum}` : "";
            }
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: {color: "#6c7771", maxRotation: many ? 0 : 45, minRotation: 0, precision: many ? 0 : undefined},
          grid: {color: "rgba(223,229,225,.7)"}
        },
        y: {
          beginAtZero: true,
          ticks: {color: "#6c7771", precision: many ? undefined : 0},
          grid: {color: "rgba(223,229,225,.7)"}
        }
      }
    }
  });
  return overdueChart;
}

function setHidden(el, hidden){
  if(!el) return;
  el.classList.toggle("hidden", Boolean(hidden));
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

function fillKpis(el, model){
  if(!el) return;
  const items = [
    {label: "Leads in History", value: model.historyLeadCount},
    {label: "Calls in History", value: model.callsTotal},
    {label: "Missed leads", value: model.missedTotal},
    {label: "Matched leads", value: model.matchedTotal},
    {label: "Overdue leads", value: model.overdueLeadTotal},
    {label: "History-only errors", value: model.orphans.length}
  ];
  el.innerHTML = "";
  for(const item of items){
    const card = document.createElement("div");
    card.className = "perf-kpi";
    const span = document.createElement("span");
    span.textContent = item.label;
    const strong = document.createElement("strong");
    strong.textContent = Number(item.value).toLocaleString();
    card.append(span, strong);
    el.append(card);
  }
}

function fillTelecallerTable(tbody, model){
  if(!tbody) return;
  tbody.innerHTML = "";
  for(const tc of model.telecallers){
    const b = model.byTelecaller[tc];
    const tr = document.createElement("tr");
    const cells = [tc, b.leadsInHistory, b.calls, b.missed, b.overdueLeads];
    cells.forEach((val, i) => {
      const td = document.createElement(i === 0 ? "th" : "td");
      if(i === 0) td.scope = "row";
      td.textContent = typeof val === "number" ? val.toLocaleString() : val;
      tr.append(td);
    });
    tbody.append(tr);
  }
  if(!model.telecallers.length){
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.textContent = "No telecaller rows found.";
    tr.append(td);
    tbody.append(tr);
  }
}

function fillOrphanTable(tbody, panel, orphans){
  if(!tbody) return;
  tbody.innerHTML = "";
  for(const row of orphans){
    const tr = document.createElement("tr");
    const mobile = document.createElement("td");
    mobile.textContent = row.mobile || "—";
    const project = document.createElement("td");
    project.textContent = row.project || "—";
    tr.append(mobile, project);
    tbody.append(tr);
  }
  setHidden(panel, !orphans.length);
}

function fillStatusTable(tbody, results){
  if(!tbody) return;
  tbody.innerHTML = "";
  const sorted = [...results].sort((a, b) => {
    const rank = r => (r.matched ? 2 : (r.status === STATUS_DRAFT ? 0 : 1));
    return rank(a) - rank(b)
      || a.telecaller.localeCompare(b.telecaller, undefined, {sensitivity: "base"})
      || a.project.localeCompare(b.project, undefined, {sensitivity: "base"});
  });
  for(const row of sorted){
    const tr = document.createElement("tr");
    if(!row.matched) tr.classList.add("perf-row-miss");
    const vals = [
      row.mobile || "—",
      row.project || "—",
      row.telecaller,
      row.status,
      row.overdue === "" ? "—" : String(row.overdue)
    ];
    vals.forEach((val, i) => {
      const td = document.createElement("td");
      td.textContent = val;
      if(i === 3) td.className = "perf-status-cell";
      tr.append(td);
    });
    tbody.append(tr);
  }
}

/**
 * Wire dual upload + reconcile UI inside #view-perf-dashboard.
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
  const kpiStrip = document.getElementById("perf-kpi-strip");
  const canvas = document.getElementById("perf-overdue-chart");
  const chartWrap = document.getElementById("perf-chart-wrap");
  const telecallerTbody = document.getElementById("perf-telecaller-tbody");
  const orphanPanel = document.getElementById("perf-orphan-panel");
  const orphanTbody = document.getElementById("perf-orphan-tbody");
  const statusTbody = document.getElementById("perf-status-tbody");

  if(!masterDrop || !historyDrop || !buildBtn || !canvas) return {destroy: destroyChart};

  let masterParsed = null;
  let historyParsed = null;

  function showValidation(message, isError){
    if(!validation) return;
    validation.textContent = message || "";
    validation.classList.toggle("error", Boolean(isError));
    setHidden(validation, !message);
  }

  function updateBuildEnabled(){
    buildBtn.disabled = !(masterParsed && historyParsed);
  }

  async function loadWorkbook(file, kind){
    showValidation(`Reading ${kind === "history" ? "History" : "Master"} workbook…`, false);
    setHidden(results, true);
    destroyChart();
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
      const model = reconcilePerf(masterParsed, historyParsed);

      if(dateRangeEl){
        if(model.minRegistration && model.maxRegistration){
          dateRangeEl.innerHTML = `<span>Lead Registration Date</span><strong>${formatDate(model.minRegistration)} – ${formatDate(model.maxRegistration)}</strong>`;
        }else{
          dateRangeEl.innerHTML = `<span>Lead Registration Date</span><strong>No valid dates found</strong>`;
        }
      }

      fillKpis(kpiStrip, model);
      fillTelecallerTable(telecallerTbody, model);
      fillOrphanTable(orphanTbody, orphanPanel, model.orphans);
      fillStatusTable(statusTbody, model.masterResults);

      if(chartWrap){
        const overdueLabels = model.telecallers.filter(tc => (model.byTelecaller[tc]?.overdueLeads || 0) > 0);
        const n = overdueLabels.length || model.telecallers.length || 1;
        chartWrap.style.height = `${Math.max(280, n > 8 ? n * 36 : 280)}px`;
      }
      renderOverdueChart(canvas, model);

      const orphanNote = model.orphans.length
        ? ` · ${model.orphans.length} History-only error(s)`
        : "";
      showValidation(
        `Reconciled ${model.masterRowCount.toLocaleString()} Master leads with ${model.callsTotal.toLocaleString()} History calls · ${model.missedTotal.toLocaleString()} missed · ${model.matchedTotal.toLocaleString()} matched (audit TBD)${orphanNote}.`,
        false
      );
      setHidden(results, false);
      toast("Performance dashboard ready.");
    }catch(err){
      setHidden(results, true);
      showValidation(err?.message || "Could not build dashboard.", true);
      toast(err?.message || "Build failed.");
    }
  }

  wireDropZone(masterDrop, masterInput, file => loadWorkbook(file, "master"));
  wireDropZone(historyDrop, historyInput, file => loadWorkbook(file, "history"));
  buildBtn.onclick = buildDashboard;

  return {destroy: destroyChart};
}

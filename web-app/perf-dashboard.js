/**
 * TeleCaller Performance Report — Master + History Excel → Summary KPIs.
 * No AI; parses with SheetJS. Graph view is a stub for now.
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

/**
 * Reconcile Master + History into Summary KPIs.
 */
export function reconcilePerf(masterParsed, historyParsed){
  const historyByKey = new Map();
  for(const rec of historyParsed.records){
    if(!historyByKey.has(rec.key)) historyByKey.set(rec.key, []);
    historyByKey.get(rec.key).push(rec);
  }

  let dateMin = historyParsed.minUpdate || null;
  let dateMax = historyParsed.maxUpdate || null;
  if(!dateMin || !dateMax){
    for(const rec of historyParsed.records){
      if(!rec.update) continue;
      if(!dateMin || rec.update < dateMin) dateMin = rec.update;
      if(!dateMax || rec.update > dateMax) dateMax = rec.update;
    }
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

    // Distinct History lead: use any row's registration (prefer latest)
    const reg = latest?.registration || rows.find(r => r.registration)?.registration || null;
    if(inDateRange(reg, dateMin, dateMax)) historyFreshInRange += 1;
  }

  let draftInRange = 0;
  let freshLeadsNotCalledYet = 0;

  for(const rec of masterParsed.records){
    if(historyByKey.has(rec.key)) continue;
    const regEqualsNext = sameCalendarDay(rec.registration, rec.next);
    if(regEqualsNext){
      freshLeadsNotCalledYet += 1;
    }else{
      // Draft: not in History and Reg ≠ Next
      if(inDateRange(rec.registration, dateMin, dateMax)) draftInRange += 1;
    }
  }

  const totalActiveLeads = masterParsed.rowCount;
  const totalFreshLeadAssigned = historyFreshInRange + draftInRange;

  return {
    masterFileName: masterParsed.fileName,
    historyFileName: historyParsed.fileName,
    masterSheet: masterParsed.sheetName,
    historySheet: historyParsed.sheetName,
    masterRowCount: masterParsed.rowCount,
    historyRowCount: historyParsed.rowCount,
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
    freshLeadsNotCalledYet
  };
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

/**
 * Wire dual upload + Summary UI inside #view-perf-dashboard.
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

  if(!masterDrop || !historyDrop || !buildBtn) return {destroy(){}};

  let masterParsed = null;
  let historyParsed = null;
  let activeView = "summary";

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
  }

  async function loadWorkbook(file, kind){
    showValidation(`Reading ${kind === "history" ? "History" : "Master"} workbook…`, false);
    setHidden(results, true);
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
        if(model.dateMin && model.dateMax){
          dateRangeEl.innerHTML = `<span>Lead Update Date</span><strong>${formatDate(model.dateMin)} – ${formatDate(model.dateMax)}</strong>`;
        }else{
          dateRangeEl.innerHTML = `<span>Lead Update Date</span><strong>No valid dates found</strong>`;
        }
      }

      fillSummary(summaryEl, model);
      setView(activeView);

      showValidation(
        `Summary ready · ${model.totalActiveLeads.toLocaleString()} active leads · ${model.historyRowCount.toLocaleString()} History call rows.`,
        false
      );
      setHidden(results, false);
      toast("Performance summary ready.");
    }catch(err){
      setHidden(results, true);
      showValidation(err?.message || "Could not build dashboard.", true);
      toast(err?.message || "Build failed.");
    }
  }

  wireDropZone(masterDrop, masterInput, file => loadWorkbook(file, "master"));
  wireDropZone(historyDrop, historyInput, file => loadWorkbook(file, "history"));
  buildBtn.onclick = buildDashboard;

  if(viewToggle){
    viewToggle.addEventListener("click", event => {
      const btn = event.target.closest("[data-perf-view]");
      if(!btn) return;
      setView(btn.getAttribute("data-perf-view"));
    });
  }

  setView("summary");

  return {destroy(){}};
}

/**
 * In-app TeleCaller Review dashboard (KPIs, scorecard, Chart.js charts, error table).
 */

import {buildDashboardModel} from "./dashboard-metrics.js?v=5.0.7";

/** Panel switcher labels (presentation) → internal section titles stay as-built. */
const DASHBOARD_PANELS = [
  {id: "summary", label: "Summary"},
  {id: "performance", label: "Performance"},
  {id: "graphs", label: "Graphs"},
  {id: "errors", label: "Detailed Error Report"}
];

const CHART_COLORS = {
  green2: "#1f5d45",
  amber: "#c57924",
  red: "#a33a32",
  line: "#dfe5e1",
  ink: "#17211d",
  muted: "#6c7771",
  palette: ["#12372a", "#1f5d45", "#3f8c68", "#c57924", "#a33a32", "#2a5f9e", "#6c7771", "#9bb7a8"]
};

/** @type {Map<string, {destroy: Function, resize?: Function}>} */
const chartRegistry = new Map();

function destroyCharts(){
  for(const chart of chartRegistry.values()){
    try{chart.destroy();}catch{/* ignore */}
  }
  chartRegistry.clear();
}

function resizeCharts(){
  for(const chart of chartRegistry.values()){
    try{chart.resize();}catch{/* ignore */}
  }
}

function requireChart(){
  const Chart = window.Chart;
  if(typeof Chart !== "function") throw new Error("Chart.js failed to load. Check your network connection and reload.");
  return Chart;
}

function el(tag, className, text){
  const node = document.createElement(tag);
  if(className) node.className = className;
  if(text != null) node.textContent = text;
  return node;
}

function pct(value){
  return `${(Number(value) || 0).toFixed(1)}%`;
}

function num(value){
  return Number(value || 0).toLocaleString();
}

function flattenJobResults(jobs){
  return (jobs || []).flatMap(job => job?.results || []);
}

function readMulti(form, name){
  return [...form.querySelectorAll(`select[name="${name}"] option:checked`)].map(o => o.value).filter(Boolean);
}

function readFilters(form){
  if(!form) return {};
  const data = new FormData(form);
  return {
    telecallers: readMulti(form, "telecallers"),
    projects: readMulti(form, "projects"),
    dateFrom: String(data.get("dateFrom") || ""),
    dateTo: String(data.get("dateTo") || ""),
    severities: readMulti(form, "severities"),
    errorTypes: readMulti(form, "errorTypes")
  };
}

function fillMultiSelect(select, values, selected){
  select.replaceChildren();
  select.multiple = true;
  const selectedSet = new Set(selected || []);
  for(const value of values){
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = value;
    if(selectedSet.has(value)) opt.selected = true;
    select.append(opt);
  }
}

function setMultiSelectAll(select, selected){
  for(const opt of select.options) opt.selected = selected;
  select.dispatchEvent(new Event("change", {bubbles: true}));
}

function buildFilterSelectActions(select){
  const actions = el("span", "dashboard-filter-actions");
  const selectAll = el("button", "dashboard-filter-action", "Select All");
  selectAll.type = "button";
  const selectNone = el("button", "dashboard-filter-action", "Select None");
  selectNone.type = "button";
  selectAll.addEventListener("click", () => setMultiSelectAll(select, true));
  selectNone.addEventListener("click", () => setMultiSelectAll(select, false));
  actions.append(selectAll, selectNone);
  return actions;
}

function syncFiltersBodyPadding(aside){
  const open = aside && !aside.classList.contains("is-collapsed") && document.body.contains(aside);
  document.body.classList.toggle("dashboard-filters-open", Boolean(open));
  // Charts must reflow after padding / rail width changes (all roles).
  requestAnimationFrame(() => {
    resizeCharts();
    requestAnimationFrame(resizeCharts);
  });
}

function buildFilters(filterOptions, filters){
  const aside = el("aside", "dashboard-filters-rail");
  const toggle = el("button", "filters-tab-toggle", "Filters");
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", "true");

  const panel = el("div", "dashboard-filters-panel");
  const form = el("form", "dashboard-filters");
  const head = el("div", "filters-panel-head");
  head.append(el("h3", null, "Filters"));
  const hint = el("p", "filters-panel-hint", "Hold Ctrl/Cmd to multi-select");
  head.append(hint);
  form.append(head);

  const fields = [
    ["telecallers", "TeleCaller", filterOptions.telecallers, filters.telecallers],
    ["projects", "Project", filterOptions.projects, filters.projects],
    ["severities", "Severity", filterOptions.severities, filters.severities],
    ["errorTypes", "Error Type", filterOptions.errorTypes, filters.errorTypes]
  ];

  for(const [name, label, options, selected] of fields){
    const wrap = el("div", "dashboard-filter");
    const head = el("div", "dashboard-filter-head");
    head.append(el("span", "dashboard-filter-label", label));
    const select = document.createElement("select");
    select.name = name;
    select.className = "dashboard-filter-select";
    select.size = Math.min(5, Math.max(3, (options || []).length || 3));
    fillMultiSelect(select, options || [], selected || []);
    head.append(buildFilterSelectActions(select));
    wrap.append(head, select);
    form.append(wrap);
  }

  const dates = el("div", "dashboard-filter-dates");
  for(const [name, label] of [["dateFrom", "Reg. from"], ["dateTo", "Reg. to"]]){
    const wrap = el("label", "dashboard-filter");
    wrap.append(el("span", "dashboard-filter-label", label));
    const input = document.createElement("input");
    input.type = "date";
    input.name = name;
    input.className = "dashboard-filter-date";
    input.value = filters[name] || "";
    wrap.append(input);
    dates.append(wrap);
  }
  form.append(dates);

  const reset = el("button", "secondary-button dashboard-filter-reset", "Reset filters");
  reset.type = "button";
  form.append(reset);
  panel.append(form);
  aside.append(toggle, panel);

  toggle.addEventListener("click", () => {
    const open = !aside.classList.contains("is-collapsed");
    aside.classList.toggle("is-collapsed", open);
    toggle.setAttribute("aria-expanded", open ? "false" : "true");
    syncFiltersBodyPadding(aside);
  });

  queueMicrotask(() => syncFiltersBodyPadding(aside));

  return {aside, form, reset};
}

function renderKpis(kpis, {showComparativeKpis = true} = {}){
  const mount = el("div", "dashboard-kpis");
  const items = [
    ["Reporting period", kpis.reportingPeriod],
    ["Total leads", num(kpis.totalLeads)],
    ["Total errors", num(kpis.totalErrors)],
    ["Accuracy", pct(kpis.accuracyPct)],
    ["Critical", num(kpis.criticalCount)],
    ["Medium", num(kpis.mediumCount)]
  ];
  if(showComparativeKpis){
    items.push(
      ["Best TeleCaller", kpis.bestTelecaller],
      ["Lowest TeleCaller", kpis.lowestTelecaller]
    );
  }
  for(const [label, value] of items){
    const cell = el("div", "dashboard-kpi");
    cell.append(el("span", null, label), el("strong", null, value));
    mount.append(cell);
  }
  return mount;
}

function renderScorecard(scorecard){
  const wrap = el("div", "dashboard-table-wrap");
  const table = el("table", "dashboard-table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for(const h of ["TeleCaller", "Leads", "Correct", "Errors", "Accuracy %", "Rating", "Critical", "Medium"]){
    headRow.append(el("th", null, h));
  }
  thead.append(headRow);
  const tbody = document.createElement("tbody");
  if(!scorecard.length){
    const tr = document.createElement("tr");
    const td = el("td", "dashboard-empty", "No TeleCaller rows for the current filters.");
    td.colSpan = 8;
    tr.append(td);
    tbody.append(tr);
  }else{
    for(const row of scorecard){
      const tr = document.createElement("tr");
      tr.append(
        el("td", null, row.name),
        el("td", null, num(row.leads)),
        el("td", null, num(row.correct)),
        el("td", null, num(row.errors)),
        el("td", null, pct(row.accuracyPct)),
        el("td", "dashboard-rating", row.rating),
        el("td", null, num(row.critical)),
        el("td", null, num(row.medium))
      );
      tbody.append(tr);
    }
  }
  table.append(thead, tbody);
  wrap.append(table);
  return wrap;
}

function baseChartOptions(extra = {}){
  return {
    responsive: true,
    maintainAspectRatio: false,
    layout: {
      padding: {top: 4, right: 8, bottom: 12, left: 4, ...(extra.layout?.padding || {})}
    },
    plugins: {
      legend: {display: false, labels: {color: CHART_COLORS.ink}},
      ...extra.plugins
    },
    scales: extra.scales
  };
}

function barScaleOptions(){
  return {
    x: {
      ticks: {
        color: CHART_COLORS.muted,
        maxRotation: 45,
        minRotation: 0,
        autoSkip: true,
        padding: 8
      },
      grid: {display: false, drawBorder: false}
    },
    y: {
      beginAtZero: true,
      ticks: {color: CHART_COLORS.muted, precision: 0, padding: 6},
      grid: {color: CHART_COLORS.line, drawBorder: false}
    }
  };
}

function renderCharts(charts){
  destroyCharts();
  const mount = el("div", "dashboard-charts");
  const Chart = requireChart();

  const specs = [
    ["accuracy", "TeleCaller Accuracy %", "bar", charts.telecallerAccuracy, {
      scales: {
        ...barScaleOptions(),
        y: {min: 0, max: 100, ticks: {color: CHART_COLORS.muted, callback: v => `${v}%`, padding: 6}, grid: {color: CHART_COLORS.line, drawBorder: false}}
      }
    }, CHART_COLORS.green2],
    ["errors", "Errors by TeleCaller", "bar", charts.errorsByTelecaller, {
      scales: barScaleOptions()
    }, CHART_COLORS.amber],
    ["errorTypes", "Error Type Distribution", "doughnut", charts.errorTypeDistribution, {
      plugins: {legend: {display: true, position: "bottom", labels: {color: CHART_COLORS.ink, boxWidth: 12, padding: 10}}}
    }],
    ["projects", "Project-wise Errors", "bar", charts.projectErrors, {
      scales: barScaleOptions()
    }, CHART_COLORS.red],
    ["severity", "Severity Distribution", "doughnut", charts.severityDistribution, {
      plugins: {legend: {display: true, position: "bottom", labels: {color: CHART_COLORS.ink, boxWidth: 12, padding: 10}}}
    }],
    ["commentQuality", "Comment Quality Score", "pie", charts.commentQualityDistribution, {
      plugins: {legend: {display: true, position: "bottom", labels: {color: CHART_COLORS.ink, boxWidth: 12, padding: 10}}}
    }]
  ];

  for(const [id, title, type, series, options, solidColor] of specs){
    const card = el("div", "dashboard-chart-card");
    card.append(el("h3", null, title));
    const canvasWrap = el("div", "dashboard-chart-canvas");
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-label", title);
    canvasWrap.append(canvas);
    card.append(canvasWrap);
    mount.append(card);

    const labels = series?.labels || [];
    const values = series?.values || [];
    const isSegmented = type === "doughnut" || type === "pie";
    const backgroundColor = isSegmented
      ? (id === "severity"
        ? [CHART_COLORS.red, CHART_COLORS.amber]
        : labels.map((_, i) => CHART_COLORS.palette[i % CHART_COLORS.palette.length]))
      : solidColor;

    const chart = new Chart(canvas.getContext("2d"), {
      type,
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor,
          borderWidth: 0,
          borderRadius: isSegmented ? 0 : 4,
          maxBarThickness: 42
        }]
      },
      options: baseChartOptions(options)
    });
    chartRegistry.set(id, chart);
  }
  queueMicrotask(() => resizeCharts());
  return mount;
}

function clipCell(className, text){
  const td = el("td", className, text);
  const full = String(text || "");
  if(full){
    td.dataset.fullText = full;
    td.tabIndex = 0;
  }
  return td;
}

function ensureClipPopover(){
  let tip = document.getElementById("dashboard-clip-popover");
  if(tip) return tip;
  tip = el("div", "dashboard-clip-popover");
  tip.id = "dashboard-clip-popover";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  document.body.append(tip);
  return tip;
}

function hideClipPopover(){
  const tip = document.getElementById("dashboard-clip-popover");
  if(!tip) return;
  tip.hidden = true;
  tip.textContent = "";
  tip.classList.remove("is-visible");
}

function showClipPopover(cell){
  const full = cell?.dataset?.fullText || cell?.textContent || "";
  if(!full || !cell) return;
  // Only pop when the cell is actually truncated (or long enough to matter).
  if(cell.scrollWidth <= cell.clientWidth + 1) return;

  const tip = ensureClipPopover();
  tip.textContent = full;
  tip.hidden = false;
  tip.classList.add("is-visible");

  const rect = cell.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  const pad = 10;
  let left = rect.left;
  let top = rect.top - tipRect.height - 8;
  if(top < pad) top = rect.bottom + 8;
  if(left + tipRect.width > window.innerWidth - pad) left = window.innerWidth - tipRect.width - pad;
  if(left < pad) left = pad;
  tip.style.left = `${Math.round(left + window.scrollX)}px`;
  tip.style.top = `${Math.round(top + window.scrollY)}px`;
}

function wireClipHovers(root){
  let active = null;
  const show = (cell) => {
    if(active === cell) return;
    active = cell;
    showClipPopover(cell);
  };
  const hide = () => {
    active = null;
    hideClipPopover();
  };
  root.addEventListener("pointerover", (e) => {
    const cell = e.target.closest?.(".dashboard-clip[data-full-text]");
    if(!cell || !root.contains(cell)) return;
    show(cell);
  });
  root.addEventListener("pointerout", (e) => {
    const cell = e.target.closest?.(".dashboard-clip[data-full-text]");
    if(!cell || !root.contains(cell)) return;
    const next = e.relatedTarget;
    if(next && cell.contains(next)) return;
    if(active === cell) hide();
  });
  root.addEventListener("focusin", (e) => {
    const cell = e.target.closest?.(".dashboard-clip[data-full-text]");
    if(cell && root.contains(cell)) show(cell);
  });
  root.addEventListener("focusout", (e) => {
    const cell = e.target.closest?.(".dashboard-clip[data-full-text]");
    if(!cell) return;
    const next = e.relatedTarget;
    if(next && cell.contains(next)) return;
    if(active === cell) hide();
  });
  root.addEventListener("scroll", hide, true);
}

function renderErrorDetails(rows){
  const wrap = el("div", "dashboard-table-wrap dashboard-errors-wrap");
  const table = el("table", "dashboard-table dashboard-errors");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for(const h of ["Project", "Mobile", "TeleCaller", "Error Type", "Details", "Action", "Severity"]){
    headRow.append(el("th", null, h));
  }
  thead.append(headRow);
  const tbody = document.createElement("tbody");
  if(!rows.length){
    const tr = document.createElement("tr");
    const td = el("td", "dashboard-empty", "No errors for the current filters.");
    td.colSpan = 7;
    tr.append(td);
    tbody.append(tr);
  }else{
    for(const row of rows){
      const tr = document.createElement("tr");
      const sevClass = `dashboard-clip dashboard-sev dashboard-sev-${String(row.severity || "").toLowerCase()}`;
      tr.append(
        el("td", null, row.project || ""),
        el("td", null, row.mobile || ""),
        el("td", null, row.telecaller || ""),
        el("td", null, row.errorType || ""),
        clipCell("dashboard-clip", row.details || ""),
        clipCell("dashboard-clip", row.action || ""),
        clipCell(sevClass, row.severity || "")
      );
      tbody.append(tr);
    }
  }
  table.append(thead, tbody);
  wrap.append(table);
  wireClipHovers(wrap);
  return wrap;
}

function section(title, noteText, child, panelId){
  const node = el("section", "dashboard-section");
  if(panelId) node.dataset.panel = panelId;
  node.append(el("h2", null, title));
  if(noteText != null) node.append(el("p", "dashboard-section-note", noteText));
  node.append(child);
  return node;
}

function buildPanelSwitcher(activeId, onChange){
  const bar = el("div", "dashboard-panel-switcher");
  const label = el("label", "dashboard-panel-switcher-label");
  label.append(el("span", null, "Panel"));
  const select = document.createElement("select");
  select.className = "dashboard-panel-select";
  select.setAttribute("aria-label", "Dashboard panel");
  for(const panel of DASHBOARD_PANELS){
    const opt = document.createElement("option");
    opt.value = panel.id;
    opt.textContent = panel.label;
    if(panel.id === activeId) opt.selected = true;
    select.append(opt);
  }
  label.append(select);
  bar.append(label);

  // Compact segmented control for wider viewports; select remains the source of truth.
  const segs = el("div", "dashboard-panel-segments");
  segs.setAttribute("role", "tablist");
  segs.setAttribute("aria-label", "Dashboard panels");
  for(const panel of DASHBOARD_PANELS){
    const btn = el("button", "dashboard-panel-seg", panel.label);
    btn.type = "button";
    btn.dataset.panel = panel.id;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", panel.id === activeId ? "true" : "false");
    if(panel.id === activeId) btn.classList.add("is-active");
    btn.addEventListener("click", () => {
      select.value = panel.id;
      onChange(panel.id);
    });
    segs.append(btn);
  }
  bar.append(segs);

  select.addEventListener("change", () => onChange(select.value));
  return {bar, select, segs};
}

function applyActivePanel(body, activeId){
  const id = DASHBOARD_PANELS.some(p => p.id === activeId) ? activeId : "summary";
  for(const sectionNode of body.querySelectorAll(".dashboard-section[data-panel]")){
    const on = sectionNode.dataset.panel === id;
    sectionNode.classList.toggle("is-panel-hidden", !on);
    sectionNode.hidden = !on;
  }
  const select = body.querySelector(".dashboard-panel-select");
  if(select && select.value !== id) select.value = id;
  for(const btn of body.querySelectorAll(".dashboard-panel-seg")){
    const on = btn.dataset.panel === id;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  }
  if(id === "graphs"){
    requestAnimationFrame(() => {
      resizeCharts();
      requestAnimationFrame(resizeCharts);
    });
  }
  return id;
}

/**
 * Render (or refresh) the Review Mode dashboard into a container.
 * @param {HTMLElement} container
 * @param {object[]} jobs Ready review jobs with results
 * @param {{highSeverityErrors?: Set<string>|string[], showComparativeKpis?: boolean}} [options]
 */
export function renderReviewDashboard(container, jobs, options = {}){
  if(!container) return;
  const results = flattenJobResults(jobs);
  const highSeverityErrors = options.highSeverityErrors;
  const showComparativeKpis = options.showComparativeKpis !== false;

  destroyCharts();
  hideClipPopover();
  container.replaceChildren();
  container.classList.add("dashboard-root", "dashboard-with-filters");

  if(!results.length){
    container.append(el("div", "dashboard-empty-state", "No audited rows available for the dashboard."));
    return;
  }

  let filters = {
    telecallers: [],
    projects: [],
    dateFrom: "",
    dateTo: "",
    severities: [],
    errorTypes: []
  };
  let activePanel = "summary";

  const paint = () => {
    destroyCharts();
    hideClipPopover();
    container.replaceChildren();
    container.classList.add("dashboard-root", "dashboard-with-filters");

    const model = buildDashboardModel(results, filters, {highSeverityErrors});
    const {aside, form, reset} = buildFilters(model.filterOptions, filters);
    const body = el("div", "dashboard-body");

    const {bar} = buildPanelSwitcher(activePanel, (id) => {
      activePanel = applyActivePanel(body, id);
    });
    body.append(bar);
    body.append(section("Executive KPIs", null, renderKpis(model.kpis, {showComparativeKpis}), "summary"));
    body.append(section("TeleCaller Performance", null, renderScorecard(model.scorecard), "performance"));
    body.append(section("Charts", null, renderCharts(model.charts), "graphs"));
    body.append(section("Detailed Error Report", `${num(model.errorDetails.length)} error row(s)`, renderErrorDetails(model.errorDetails), "errors"));
    container.append(body, aside);
    activePanel = applyActivePanel(body, activePanel);

    const apply = () => {
      filters = readFilters(form);
      paint();
    };
    form.addEventListener("change", apply);
    reset.addEventListener("click", () => {
      filters = {
        telecallers: [],
        projects: [],
        dateFrom: "",
        dateTo: "",
        severities: [],
        errorTypes: []
      };
      paint();
    });
  };

  paint();
}

export function destroyReviewDashboard(){
  destroyCharts();
  hideClipPopover();
  document.body.classList.remove("dashboard-filters-open");
}

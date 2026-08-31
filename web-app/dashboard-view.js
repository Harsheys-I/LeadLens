/**
 * In-app TeleCaller Review dashboard (KPIs, scorecard, Chart.js charts, error table).
 */

import {
  buildDashboardModel,
  OVERDUE_BUCKETS,
  commentQualityBucketKeyFromLabel
} from "./dashboard-metrics.js?v=5.2.43";
import {storageKey} from "./db.js?v=5.2.43";

/** Panel switcher labels (presentation) → internal section titles stay as-built. */
const DASHBOARD_PANELS = [
  {id: "summary", label: "Summary"},
  {id: "performance", label: "Performance"},
  {id: "graphs", label: "Graphs"},
  {id: "errors", label: "Detailed Error Report"}
];

/** Search is useful for table/list panels; hide on KPI Summary and Graphs. */
const SEARCH_VISIBLE_PANELS = new Set(["performance", "errors"]);

const FILTERS_COLLAPSED_PREF = "dashboardFiltersCollapsed";

function readFiltersCollapsedPref(){
  try{
    const raw = localStorage.getItem(storageKey(FILTERS_COLLAPSED_PREF));
    if(raw == null) return true;
    return raw === "1";
  }catch{
    return true;
  }
}

function writeFiltersCollapsedPref(collapsed){
  try{
    localStorage.setItem(storageKey(FILTERS_COLLAPSED_PREF), collapsed ? "1" : "0");
  }catch{/* ignore */}
}

const CHART_COLORS = {
  green2: "#1f5d45",
  amber: "#c57924",
  red: "#a33a32",
  line: "#dfe5e1",
  ink: "#17211d",
  muted: "#6c7771",
  palette: ["#12372a", "#1f5d45", "#3f8c68", "#c57924", "#a33a32", "#2a5f9e", "#6c7771", "#9bb7a8"]
};

const EYE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M2.5 12s3.6-7 9.5-7 9.5 7 9.5 7-3.6 7-9.5 7-9.5-7-9.5-7z"/>
  <circle cx="12" cy="12" r="3"/>
</svg>`;

/** Fields shown in the lead-detail modal (label → row key). Order is presentation order. */
const LEAD_DETAIL_FIELDS = [
  ["Project", "project"],
  ["Mobile", "mobile"],
  ["TeleCaller", "telecaller"],
  ["Error Type", "errorType"],
  ["Severity", "severity"],
  ["Details", "details"],
  ["Action", "action"],
  ["Comments", "comments"],
  ["Status", "status"],
  ["Connected", "connected"],
  ["Comment Quality", "commentQuality"],
  ["Buying Intent", "buyingIntent"],
  ["Location", "location"],
  ["Requirement", "requirement"],
  ["Budget", "budget"],
  ["Parameter", "parameter"],
  ["Registration", "registration"],
  ["Next Follow-up", "next"],
  ["Overdue (days)", "overdue"],
  ["Source", "source"],
  ["Source Name", "sourceName"],
  ["Audit Status", "auditStatus"]
];

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

function readFilters(form, searchInput){
  if(!form) return {};
  const data = new FormData(form);
  return {
    search: String(searchInput?.value ?? "").trim(),
    telecallers: readMulti(form, "telecallers"),
    projects: readMulti(form, "projects"),
    dateFrom: String(data.get("dateFrom") || ""),
    dateTo: String(data.get("dateTo") || ""),
    severities: readMulti(form, "severities"),
    errorTypes: readMulti(form, "errorTypes"),
    overdueBuckets: readMulti(form, "overdueBuckets")
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

function buildMainSearch(filters){
  const wrap = el("div", "dashboard-main-search");
  const head = el("div", "dashboard-main-search-head");
  head.append(el("span", "dashboard-filter-label", "Search"));
  const clearSearch = el("button", "dashboard-filter-action", "Clear");
  clearSearch.type = "button";
  clearSearch.setAttribute("aria-label", "Clear search");
  head.append(clearSearch);
  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.name = "search";
  searchInput.className = "dashboard-filter-search-input dashboard-main-search-input";
  searchInput.placeholder = "Search anything…";
  searchInput.autocomplete = "off";
  searchInput.spellcheck = false;
  searchInput.value = filters.search || "";
  searchInput.setAttribute("aria-label", "Search anything across all fields");
  wrap.append(head, searchInput);
  return {wrap, searchInput, clearSearch};
}

function buildFilters(filterOptions, filters, {collapsed = true, onCollapseChange} = {}){
  const aside = el("aside", "dashboard-filters-rail");
  const toggle = el("button", "filters-tab-toggle", "Filters");
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  if(collapsed) aside.classList.add("is-collapsed");

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
    ["errorTypes", "Error Type", filterOptions.errorTypes, filters.errorTypes],
    ["overdueBuckets", "Overdue (days)", filterOptions.overdueBuckets || OVERDUE_BUCKETS, filters.overdueBuckets]
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
    const willCollapse = !aside.classList.contains("is-collapsed");
    aside.classList.toggle("is-collapsed", willCollapse);
    toggle.setAttribute("aria-expanded", willCollapse ? "false" : "true");
    onCollapseChange?.(willCollapse);
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

/**
 * Map a Chart.js click hit → filter patch for the Detailed Error Report popup.
 * @returns {{filters: object, subtitle: string}|null}
 */
function filtersFromChartClick(chartId, chart, elements){
  if(!elements?.length || !chart) return null;
  const hit = elements[0];
  const index = hit.index;
  const datasetIndex = hit.datasetIndex;
  const labels = chart.data?.labels || [];
  const axisLabel = labels[index];
  if(axisLabel == null || axisLabel === "") return null;
  const label = String(axisLabel);
  const seriesLabel = String(chart.data?.datasets?.[datasetIndex]?.label || "");

  switch(chartId){
    case "accuracy":
    case "errors":
      return {filters: {telecallers: [label]}, subtitle: label};
    case "errorTypes":
      return {filters: {errorTypes: [label]}, subtitle: label};
    case "projects":
      return {filters: {projects: [label]}, subtitle: label};
    case "severity":
      if(!seriesLabel) return null;
      return {
        filters: {telecallers: [label], severities: [seriesLabel]},
        subtitle: `${label} · ${seriesLabel}`
      };
    case "commentQuality": {
      const cqKey = commentQualityBucketKeyFromLabel(seriesLabel);
      if(!cqKey) return null;
      return {
        filters: {telecallers: [label], commentQualityBuckets: [cqKey]},
        subtitle: `${label} · ${seriesLabel}`
      };
    }
    case "overdue":
      return {filters: {overdueBuckets: [label]}, subtitle: `Overdue ${label}`};
    default:
      return null;
  }
}

function renderCharts(charts, {onSegmentClick} = {}){
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
    ["severity", "Severity Distribution", "bar", charts.severityDistribution, {
      scales: barScaleOptions(),
      plugins: {legend: {display: true, position: "bottom", labels: {color: CHART_COLORS.ink, boxWidth: 12, padding: 10}}}
    }],
    ["commentQuality", "Comment Quality Score", "bar", charts.commentQualityDistribution, {
      scales: barScaleOptions(),
      plugins: {legend: {display: true, position: "bottom", labels: {color: CHART_COLORS.ink, boxWidth: 12, padding: 10}}}
    }],
    ["overdue", "Overdue Days", "pie", charts.overdueDistribution, {
      plugins: {legend: {display: true, position: "bottom", labels: {color: CHART_COLORS.ink, boxWidth: 12, padding: 10}}}
    }]
  ];

  for(const [id, title, type, series, options, solidColor] of specs){
    const card = el("div", "dashboard-chart-card");
    card.append(el("h3", null, title));
    if(id === "overdue"){
      card.append(el("p", "dashboard-section-note", "1–5, 5–20, 20–50, 50–100, 100+ · Lost/Beyond Budget excluded"));
    }
    const canvasWrap = el("div", "dashboard-chart-canvas");
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-label", `${title} (click a segment for details)`);
    canvas.classList.add("dashboard-chart-clickable");
    canvas.style.cursor = "pointer";
    canvasWrap.append(canvas);
    card.append(canvasWrap);
    mount.append(card);

    const labels = series?.labels || [];
    const grouped = Array.isArray(series?.datasets) && series.datasets.length > 0;
    const values = series?.values || [];
    const isSegmented = type === "doughnut" || type === "pie";
    const severitySeriesColors = {Critical: CHART_COLORS.red, Medium: CHART_COLORS.amber};
    /** CQ bands: Bad→Excellent = red→green (not palette order). */
    const cqSeriesColors = {
      Bad: CHART_COLORS.red,
      Average: CHART_COLORS.amber,
      Good: "#c9a227",
      "Very good": "#3f8c68",
      Excellent: CHART_COLORS.green2
    };

    let datasets;
    if(grouped){
      datasets = series.datasets.map((ds, i) => {
        let color = CHART_COLORS.palette[i % CHART_COLORS.palette.length];
        if(id === "severity") color = severitySeriesColors[ds.label] || color;
        else if(id === "commentQuality") color = cqSeriesColors[ds.label] || color;
        return {
          label: ds.label,
          data: ds.values || [],
          backgroundColor: color,
          borderWidth: 0,
          borderRadius: 4,
          maxBarThickness: 28
        };
      });
    }else{
      const backgroundColor = isSegmented
        ? labels.map((_, i) => CHART_COLORS.palette[i % CHART_COLORS.palette.length])
        : solidColor;
      datasets = [{
        data: values,
        backgroundColor,
        borderWidth: 0,
        borderRadius: isSegmented ? 0 : 4,
        maxBarThickness: 42
      }];
    }

    const chartOptions = baseChartOptions(options);
    if(typeof onSegmentClick === "function"){
      chartOptions.onClick = (_evt, elements, chart) => {
        const mapped = filtersFromChartClick(id, chart, elements);
        if(mapped) onSegmentClick(mapped);
      };
    }

    const chart = new Chart(canvas.getContext("2d"), {
      type,
      data: {labels, datasets},
      options: chartOptions
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

function formatLeadDetailValue(key, value){
  if(value == null || value === "") return "";
  if(value instanceof Date && !Number.isNaN(value.valueOf())){
    const hasTime = value.getHours() || value.getMinutes() || value.getSeconds();
    if(hasTime){
      return value.toLocaleString(undefined, {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit"
      });
    }
    return value.toLocaleDateString(undefined, {day: "2-digit", month: "short", year: "numeric"});
  }
  if(key === "commentQuality" && (value === 0 || value)) return String(value);
  if(key === "overdue"){
    if(value === "-" || value === 0 || value) return String(value);
    return "";
  }
  return String(value);
}

function onLeadModalKeydown(e){
  if(e.key === "Escape"){
    e.preventDefault();
    closeLeadDetailModal();
  }
}

function closeLeadDetailModal(){
  const modal = document.getElementById("dashboard-lead-modal");
  if(!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  document.removeEventListener("keydown", onLeadModalKeydown);
}

function onChartReportModalKeydown(e){
  if(e.key === "Escape"){
    e.preventDefault();
    // Prefer closing nested lead detail first if open.
    const lead = document.getElementById("dashboard-lead-modal");
    if(lead && !lead.classList.contains("hidden")){
      closeLeadDetailModal();
      return;
    }
    closeChartErrorReportModal();
  }
}

function closeChartErrorReportModal(){
  const modal = document.getElementById("dashboard-chart-report-modal");
  if(!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  document.removeEventListener("keydown", onChartReportModalKeydown);
  const body = modal.querySelector("#dashboard-chart-report-body");
  if(body) body.replaceChildren();
}

function ensureChartErrorReportModal(){
  let modal = document.getElementById("dashboard-chart-report-modal");
  if(modal) return modal;

  modal = el("div", "dashboard-lead-modal dashboard-chart-report-modal hidden");
  modal.id = "dashboard-chart-report-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "dashboard-chart-report-title");
  modal.setAttribute("aria-hidden", "true");

  const backdrop = el("div", "dashboard-lead-modal-backdrop");
  backdrop.addEventListener("click", closeChartErrorReportModal);

  const card = el("div", "dashboard-lead-modal-card dashboard-chart-report-card");
  card.setAttribute("role", "document");
  card.addEventListener("click", e => e.stopPropagation());

  const head = el("div", "dashboard-lead-modal-head");
  const titleWrap = el("div", "dashboard-chart-report-title-wrap");
  const title = el("h2", null, "Detailed Error Report");
  title.id = "dashboard-chart-report-title";
  const note = el("p", "dashboard-chart-report-subtitle");
  note.id = "dashboard-chart-report-subtitle";
  titleWrap.append(title, note);
  const closeBtn = el("button", "dashboard-lead-modal-close", "×");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close detailed error report");
  closeBtn.addEventListener("click", closeChartErrorReportModal);
  head.append(titleWrap, closeBtn);

  const body = el("div", "dashboard-lead-modal-body dashboard-chart-report-body");
  body.id = "dashboard-chart-report-body";

  card.append(head, body);
  modal.append(backdrop, card);
  document.body.append(modal);
  return modal;
}

/**
 * Open Detailed Error Report popup filtered to a chart segment (plus current sidebar filters).
 * @param {{results: object[], baseFilters: object, segmentFilters: object, subtitle?: string, highSeverityErrors?: Set|string[]}} opts
 */
function openChartErrorReportModal(opts){
  const {
    results,
    baseFilters = {},
    segmentFilters = {},
    subtitle = "",
    highSeverityErrors
  } = opts || {};

  hideClipPopover();
  closeLeadDetailModal();

  const mergedFilters = {...baseFilters, ...segmentFilters};
  const model = buildDashboardModel(results, mergedFilters, {highSeverityErrors});
  const rows = model.errorDetails || [];

  const modal = ensureChartErrorReportModal();
  const body = modal.querySelector("#dashboard-chart-report-body");
  const note = modal.querySelector("#dashboard-chart-report-subtitle");
  if(!body) return;

  if(note){
    const countLabel = `${num(rows.length)} error row(s)`;
    note.textContent = subtitle ? `${subtitle} · ${countLabel}` : countLabel;
  }

  body.replaceChildren();
  body.append(renderErrorDetails(rows));

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  document.removeEventListener("keydown", onChartReportModalKeydown);
  document.addEventListener("keydown", onChartReportModalKeydown);
  const closeBtn = modal.querySelector(".dashboard-lead-modal-close");
  closeBtn?.focus();
}

function ensureLeadDetailModal(){
  let modal = document.getElementById("dashboard-lead-modal");
  if(modal) return modal;

  modal = el("div", "dashboard-lead-modal hidden");
  modal.id = "dashboard-lead-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "dashboard-lead-modal-title");
  modal.setAttribute("aria-hidden", "true");

  const backdrop = el("div", "dashboard-lead-modal-backdrop");
  backdrop.addEventListener("click", closeLeadDetailModal);

  const card = el("div", "dashboard-lead-modal-card");
  card.setAttribute("role", "document");
  card.addEventListener("click", e => e.stopPropagation());

  const head = el("div", "dashboard-lead-modal-head");
  const title = el("h2", null, "Lead details");
  title.id = "dashboard-lead-modal-title";
  const closeBtn = el("button", "dashboard-lead-modal-close", "×");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close lead details");
  closeBtn.addEventListener("click", closeLeadDetailModal);
  head.append(title, closeBtn);

  const body = el("div", "dashboard-lead-modal-body");
  body.id = "dashboard-lead-modal-body";

  card.append(head, body);
  modal.append(backdrop, card);
  document.body.append(modal);
  return modal;
}

function openLeadDetailModal(row){
  hideClipPopover();
  const modal = ensureLeadDetailModal();
  const body = modal.querySelector("#dashboard-lead-modal-body");
  if(!body) return;
  body.replaceChildren();

  const grid = el("div", "dashboard-lead-detail-grid");
  for(const [label, key] of LEAD_DETAIL_FIELDS){
    const text = formatLeadDetailValue(key, row?.[key]);
    if(!text && key !== "commentQuality" && key !== "overdue") continue;
    if((key === "commentQuality" || key === "overdue") && (row?.[key] == null || row?.[key] === "")) continue;

    const item = el("div", key === "comments" || key === "details" || key === "action" || key === "errorType"
      ? "dashboard-lead-detail-item dashboard-lead-detail-wide"
      : "dashboard-lead-detail-item");
    item.append(el("span", "dashboard-lead-detail-label", label));
    const value = el("div", "dashboard-lead-detail-value", text || "—");
    if(key === "severity"){
      value.classList.add(`dashboard-sev`, `dashboard-sev-${String(row?.severity || "").toLowerCase()}`);
    }
    item.append(value);
    grid.append(item);
  }
  if(!grid.childElementCount){
    body.append(el("p", "dashboard-lead-detail-empty", "No details available for this row."));
  }else{
    body.append(grid);
  }

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  document.removeEventListener("keydown", onLeadModalKeydown);
  // When nested under the chart report popup, that modal owns Escape (closes lead first).
  const chartReport = document.getElementById("dashboard-chart-report-modal");
  const chartOpen = chartReport && !chartReport.classList.contains("hidden");
  if(!chartOpen) document.addEventListener("keydown", onLeadModalKeydown);
  const closeBtn = modal.querySelector(".dashboard-lead-modal-close");
  closeBtn?.focus();
}

function buildViewLeadButton(row){
  const td = el("td", "dashboard-errors-view-cell");
  const btn = el("button", "dashboard-eye-btn");
  btn.type = "button";
  btn.setAttribute("aria-label", "View lead details");
  btn.title = "View lead details";
  btn.innerHTML = EYE_SVG;
  btn.addEventListener("click", e => {
    e.preventDefault();
    e.stopPropagation();
    openLeadDetailModal(row);
  });
  btn.addEventListener("mousedown", e => e.stopPropagation());
  btn.addEventListener("pointerdown", e => e.stopPropagation());
  td.append(btn);
  return td;
}

function renderErrorDetails(rows){
  const wrap = el("div", "dashboard-table-wrap dashboard-errors-wrap");
  const table = el("table", "dashboard-table dashboard-errors");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for(const h of ["Project", "Mobile", "TeleCaller", "Error Type", "Details", "Action", "Severity"]){
    headRow.append(el("th", null, h));
  }
  const viewTh = el("th", "dashboard-errors-view-col");
  viewTh.setAttribute("scope", "col");
  viewTh.innerHTML = `<span class="dashboard-errors-view-label">View</span>`;
  headRow.append(viewTh);
  thead.append(headRow);
  const tbody = document.createElement("tbody");
  if(!rows.length){
    const tr = document.createElement("tr");
    const td = el("td", "dashboard-empty", "No errors for the current filters.");
    td.colSpan = 8;
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
        clipCell(sevClass, row.severity || ""),
        buildViewLeadButton(row)
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

function buildPanelSwitcher(activeId, onChange, {onExportPdf} = {}){
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

  if(typeof onExportPdf === "function"){
    const exportBtn = el("button", "secondary-button dashboard-export-pdf", "Export PDF");
    exportBtn.type = "button";
    exportBtn.addEventListener("click", () => onExportPdf());
    bar.append(exportBtn);
  }

  select.addEventListener("change", () => onChange(select.value));
  return {bar, select, segs};
}

function syncSearchVisibility(body, activeId){
  const searchBar = body?.querySelector(".dashboard-main-search");
  if(!searchBar) return;
  const show = SEARCH_VISIBLE_PANELS.has(activeId);
  searchBar.hidden = !show;
  searchBar.classList.toggle("is-panel-hidden", !show);
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
  syncSearchVisibility(body, id);
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
  closeLeadDetailModal();
  closeChartErrorReportModal();
  container.replaceChildren();
  container.classList.add("dashboard-root", "dashboard-with-filters");

  if(!results.length){
    container.append(el("div", "dashboard-empty-state", "No audited rows available for the dashboard."));
    return;
  }

  let filters = {
    search: "",
    telecallers: [],
    projects: [],
    dateFrom: "",
    dateTo: "",
    severities: [],
    errorTypes: [],
    overdueBuckets: []
  };
  let activePanel = "summary";
  let filtersCollapsed = readFiltersCollapsedPref();

  const paint = () => {
    const prevSearch = container.querySelector('input[name="search"]');
    const searchShown = SEARCH_VISIBLE_PANELS.has(activePanel);
    const restoreSearch = searchShown && prevSearch && document.activeElement === prevSearch
      ? {caret: prevSearch.selectionStart}
      : null;

    destroyCharts();
    hideClipPopover();
    closeLeadDetailModal();
    closeChartErrorReportModal();
    container.replaceChildren();
    container.classList.add("dashboard-root", "dashboard-with-filters");

    const model = buildDashboardModel(results, filters, {highSeverityErrors});
    const {aside, form, reset} = buildFilters(model.filterOptions, filters, {
      collapsed: filtersCollapsed,
      onCollapseChange: (collapsed) => {
        filtersCollapsed = collapsed;
        writeFiltersCollapsedPref(collapsed);
      }
    });
    const {wrap: searchBar, searchInput, clearSearch} = buildMainSearch(filters);
    const body = el("div", "dashboard-body");

    const {bar} = buildPanelSwitcher(activePanel, (id) => {
      activePanel = applyActivePanel(body, id);
    }, {onExportPdf: typeof options.onExportPdf === "function" ? options.onExportPdf : null});
    body.append(searchBar, bar);
    body.append(section("Executive KPIs", null, renderKpis(model.kpis, {showComparativeKpis}), "summary"));
    body.append(section("TeleCaller Performance", null, renderScorecard(model.scorecard), "performance"));
    body.append(section("Charts", null, renderCharts(model.charts, {
      onSegmentClick: ({filters: segmentFilters, subtitle}) => {
        openChartErrorReportModal({
          results,
          baseFilters: filters,
          segmentFilters,
          subtitle,
          highSeverityErrors
        });
      }
    }), "graphs"));
    body.append(section("Detailed Error Report", `${num(model.errorDetails.length)} error row(s)`, renderErrorDetails(model.errorDetails), "errors"));
    container.append(body, aside);
    activePanel = applyActivePanel(body, activePanel);

    const apply = () => {
      filters = readFilters(form, searchInput);
      paint();
    };
    form.addEventListener("submit", (e) => e.preventDefault());
    form.addEventListener("change", apply);
    searchInput.addEventListener("input", apply);
    clearSearch.addEventListener("click", () => {
      if(!searchInput.value && !filters.search) return;
      searchInput.value = "";
      filters = {...readFilters(form, searchInput), search: ""};
      paint();
    });
    reset.addEventListener("click", () => {
      filters = {
        search: "",
        telecallers: [],
        projects: [],
        dateFrom: "",
        dateTo: "",
        severities: [],
        errorTypes: [],
        overdueBuckets: []
      };
      paint();
    });

    if(restoreSearch){
      searchInput.focus();
      if(typeof restoreSearch.caret === "number"){
        try{searchInput.setSelectionRange(restoreSearch.caret, restoreSearch.caret);}catch{/* ignore */}
      }
    }
  };

  paint();
}

export function destroyReviewDashboard(){
  destroyCharts();
  hideClipPopover();
  closeLeadDetailModal();
  closeChartErrorReportModal();
  document.body.classList.remove("dashboard-filters-open");
}

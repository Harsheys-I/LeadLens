/**
 * In-app TeleCaller Review dashboard (KPIs, scorecard, Chart.js charts, error table).
 */

import {buildDashboardModel} from "./dashboard-metrics.js?v=5.0.1";

const CHART_COLORS = {
  green2: "#1f5d45",
  amber: "#c57924",
  red: "#a33a32",
  line: "#dfe5e1",
  ink: "#17211d",
  muted: "#6c7771",
  palette: ["#12372a", "#1f5d45", "#3f8c68", "#c57924", "#a33a32", "#2a5f9e", "#6c7771", "#9bb7a8"]
};

/** @type {Map<string, {destroy: Function}>} */
const chartRegistry = new Map();

function destroyCharts(){
  for(const chart of chartRegistry.values()){
    try{chart.destroy();}catch{/* ignore */}
  }
  chartRegistry.clear();
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

function syncFiltersBodyPadding(aside){
  const open = aside && !aside.classList.contains("is-collapsed") && document.body.contains(aside);
  document.body.classList.toggle("dashboard-filters-open", Boolean(open));
}

function buildFilters(filterOptions, filters){
  const aside = el("aside", "dashboard-filters-rail");
  const toggle = el("button", "filters-tab-toggle", "Filters");
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", "true");

  const panel = el("div", "dashboard-filters-panel");
  const form = el("form", "dashboard-filters");
  form.append(el("h3", null, "Filters"));

  const fields = [
    ["telecallers", "TeleCaller", filterOptions.telecallers, filters.telecallers],
    ["projects", "Project", filterOptions.projects, filters.projects],
    ["severities", "Severity", filterOptions.severities, filters.severities],
    ["errorTypes", "Error Type", filterOptions.errorTypes, filters.errorTypes]
  ];

  for(const [name, label, options, selected] of fields){
    const wrap = el("label", "dashboard-filter");
    wrap.append(el("span", null, label + " (multi)"));
    const select = document.createElement("select");
    select.name = name;
    select.size = Math.min(6, Math.max(3, (options || []).length || 3));
    fillMultiSelect(select, options || [], selected || []);
    wrap.append(select);
    form.append(wrap);
  }

  for(const [name, label] of [["dateFrom", "Reg. from"], ["dateTo", "Reg. to"]]){
    const wrap = el("label", "dashboard-filter");
    wrap.append(el("span", null, label));
    const input = document.createElement("input");
    input.type = "date";
    input.name = name;
    input.value = filters[name] || "";
    wrap.append(input);
    form.append(wrap);
  }

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

function renderKpis(kpis){
  const mount = el("div", "dashboard-kpis");
  const items = [
    ["Reporting period", kpis.reportingPeriod],
    ["Total leads", num(kpis.totalLeads)],
    ["Total errors", num(kpis.totalErrors)],
    ["Accuracy", pct(kpis.accuracyPct)],
    ["Critical", num(kpis.criticalCount)],
    ["Medium", num(kpis.mediumCount)],
    ["Best TeleCaller", kpis.bestTelecaller],
    ["Lowest TeleCaller", kpis.lowestTelecaller]
  ];
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
    plugins: {
      legend: {display: false, labels: {color: CHART_COLORS.ink}},
      ...extra.plugins
    },
    scales: extra.scales
  };
}

function renderCharts(charts){
  destroyCharts();
  const mount = el("div", "dashboard-charts");
  const Chart = requireChart();

  const specs = [
    ["accuracy", "TeleCaller Accuracy %", "bar", charts.telecallerAccuracy, {
      scales: {
        x: {ticks: {color: CHART_COLORS.muted, maxRotation: 45, minRotation: 0}},
        y: {min: 0, max: 100, ticks: {color: CHART_COLORS.muted, callback: v => `${v}%`}, grid: {color: CHART_COLORS.line}}
      }
    }, CHART_COLORS.green2],
    ["errors", "Errors by TeleCaller", "bar", charts.errorsByTelecaller, {
      scales: {
        x: {ticks: {color: CHART_COLORS.muted, maxRotation: 45, minRotation: 0}},
        y: {beginAtZero: true, ticks: {color: CHART_COLORS.muted, precision: 0}, grid: {color: CHART_COLORS.line}}
      }
    }, CHART_COLORS.amber],
    ["errorTypes", "Error Type Distribution", "doughnut", charts.errorTypeDistribution, {
      plugins: {legend: {display: true, position: "bottom", labels: {color: CHART_COLORS.ink, boxWidth: 12}}}
    }],
    ["projects", "Project-wise Errors", "bar", charts.projectErrors, {
      scales: {
        x: {ticks: {color: CHART_COLORS.muted, maxRotation: 45, minRotation: 0}},
        y: {beginAtZero: true, ticks: {color: CHART_COLORS.muted, precision: 0}, grid: {color: CHART_COLORS.line}}
      }
    }, CHART_COLORS.red],
    ["severity", "Severity Distribution", "doughnut", charts.severityDistribution, {
      plugins: {legend: {display: true, position: "bottom", labels: {color: CHART_COLORS.ink, boxWidth: 12}}}
    }],
    ["commentQuality", "Comment Quality Score", "pie", charts.commentQualityDistribution, {
      plugins: {legend: {display: true, position: "bottom", labels: {color: CHART_COLORS.ink, boxWidth: 12}}}
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
  return mount;
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
      const sevClass = `dashboard-sev dashboard-sev-${String(row.severity || "").toLowerCase()}`;
      tr.append(
        el("td", null, row.project || ""),
        el("td", null, row.mobile || ""),
        el("td", null, row.telecaller || ""),
        el("td", null, row.errorType || ""),
        el("td", "dashboard-clip", row.details || ""),
        el("td", "dashboard-clip", row.action || ""),
        el("td", sevClass, row.severity || "")
      );
      tbody.append(tr);
    }
  }
  table.append(thead, tbody);
  wrap.append(table);
  return wrap;
}

function section(title, noteText, child){
  const node = el("section", "dashboard-section");
  node.append(el("h2", null, title));
  if(noteText != null) node.append(el("p", "dashboard-section-note", noteText));
  node.append(child);
  return node;
}

/**
 * Render (or refresh) the Review Mode dashboard into a container.
 * @param {HTMLElement} container
 * @param {object[]} jobs Ready review jobs with results
 * @param {{highSeverityErrors?: Set<string>|string[]}} [options]
 */
export function renderReviewDashboard(container, jobs, options = {}){
  if(!container) return;
  const results = flattenJobResults(jobs);
  const highSeverityErrors = options.highSeverityErrors;

  destroyCharts();
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

  const paint = () => {
    destroyCharts();
    container.replaceChildren();
    container.classList.add("dashboard-root", "dashboard-with-filters");

    const model = buildDashboardModel(results, filters, {highSeverityErrors});
    const {aside, form, reset} = buildFilters(model.filterOptions, filters);
    const body = el("div", "dashboard-body");
    body.append(section("Executive KPIs", null, renderKpis(model.kpis)));
    body.append(section("TeleCaller Performance", null, renderScorecard(model.scorecard)));
    body.append(section("Charts", null, renderCharts(model.charts)));
    body.append(section("Detailed Error Report", `${num(model.errorDetails.length)} error row(s)`, renderErrorDetails(model.errorDetails)));
    container.append(body, aside);

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
  document.body.classList.remove("dashboard-filters-open");
}

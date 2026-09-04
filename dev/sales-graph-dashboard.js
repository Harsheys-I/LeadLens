/**
 * Sales Graph dashboard — KPI strip, multi-style chart gallery, tabular views.
 * Destroy/recreate Chart.js instances on every render.
 */

/** @type {Map<string, import("chart.js").Chart>} */
const chartRegistry = new Map();

const PALETTE = [
  "#1f5d45", "#3d8b6e", "#c4a35a", "#5b7c99", "#8b5a3c",
  "#2a6f7a", "#6b4f8a", "#a65d57", "#4a7c59", "#7a6a4f",
  "#3a5a7c", "#9a6b3c", "#5a7a6a", "#7c5a6a", "#4f6b8a",
];

const COLOR_LEADS = "#1f5d45";
const COLOR_VISITS = "#c4a35a";
const COLOR_BOOKED = "#5b7c99";
const COLOR_BOOKED_DL = "#5b7c99";
const COLOR_BOOKED_CANCEL = "#a65d57";

const STATUS_DEMAND = "Demand Letter";
const STATUS_CANCEL = "Cancel";

const TOP_N = 10;
const HERO_CHART_HEIGHT = 1200;

function requireChart() {
  const Chart = window.Chart;
  if (typeof Chart !== "function") throw new Error("Chart.js failed to load. Reload the page.");
  return Chart;
}

export function destroySalesGraphCharts() {
  for (const chart of chartRegistry.values()) {
    try { chart.destroy(); } catch { /* ignore */ }
  }
  chartRegistry.clear();
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null && text !== "") node.textContent = text;
  return node;
}

function num(n) {
  const v = Number(n) || 0;
  return v.toLocaleString(undefined, {maximumFractionDigits: 1});
}

function pct(n) {
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function formatMonth(ym) {
  const s = String(ym || "");
  if (!/^\d{6}$/.test(s)) return s;
  const y = s.slice(0, 4);
  const m = Number(s.slice(4, 6));
  const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${names[m - 1] || s.slice(4)} ${y}`;
}

function inkColor() {
  return getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#1a2e24";
}

function mutedColor() {
  return getComputedStyle(document.documentElement).getPropertyValue("--muted").trim() || "#6b7c72";
}

function sheetTotals(sheet) {
  if (!sheet) return {grand: 0, byMonth: {}};
  if (sheet.totals?.grand != null) return sheet.totals;
  const byMonth = sheet.byMonth || {};
  let grand = 0;
  for (const v of Object.values(byMonth)) grand += Number(v) || 0;
  return {grand, byMonth};
}

function bucketTotal(bucket) {
  if (!bucket) return 0;
  if (typeof bucket.total === "number") return bucket.total;
  let t = 0;
  for (const v of Object.values(bucket.byMonth || {})) t += Number(v) || 0;
  return t;
}

function sortedKeysByTotal(map, limit = Infinity) {
  return Object.entries(map || {})
    .map(([k, b]) => [k, bucketTotal(b)])
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([k]) => k);
}

function monthSeries(sheet, months) {
  const byMonth = sheet?.byMonth || sheet?.totals?.byMonth || {};
  return months.map(m => Number(byMonth[m] || 0));
}

function makeSection(title, subtitle) {
  const section = el("section", "sg-section");
  const head = el("div", "sg-section-head");
  head.append(el("h3", null, title));
  if (subtitle) head.append(el("p", "sg-section-sub", subtitle));
  section.append(head);
  return section;
}

function chartCard(title, canvasHeight = 260, extraClass = "") {
  const card = el("div", `dashboard-chart-card sg-chart-card${extraClass ? ` ${extraClass}` : ""}`);
  card.append(el("h3", null, title));
  const wrap = el("div", "dashboard-chart-canvas");
  wrap.style.height = `${canvasHeight}px`;
  const canvas = document.createElement("canvas");
  wrap.append(canvas);
  card.append(wrap);
  return {card, canvas};
}

function registerChart(id, config) {
  const Chart = requireChart();
  const existing = chartRegistry.get(id);
  if (existing) {
    try { existing.destroy(); } catch { /* ignore */ }
    chartRegistry.delete(id);
  }
  const chart = new Chart(config.canvas.getContext("2d"), {
    type: config.type,
    data: config.data,
    options: config.options,
  });
  chartRegistry.set(id, chart);
  return chart;
}

function baseOptions({stacked = false, indexAxis = "x", yTickCallback} = {}) {
  const ink = inkColor();
  const muted = mutedColor();
  return {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis,
    interaction: {mode: "index", intersect: false},
    plugins: {
      legend: {
        labels: {color: ink, boxWidth: 12, font: {size: 11}},
      },
      tooltip: {mode: "index", intersect: false},
    },
    scales: {
      x: {
        stacked,
        ticks: {color: muted, maxRotation: 45, font: {size: 10}},
        grid: {color: "transparent"},
      },
      y: {
        stacked,
        beginAtZero: true,
        ticks: {
          color: muted,
          font: {size: 10},
          callback: yTickCallback || (v => v),
        },
        grid: {color: "rgba(0,0,0,0.06)"},
      },
    },
  };
}

function pieOptions() {
  const ink = inkColor();
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "right",
        labels: {color: ink, boxWidth: 10, font: {size: 10}},
      },
    },
  };
}

function colorsFor(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(PALETTE[i % PALETTE.length]);
  return out;
}

function renderKpis(mount, payload) {
  const leads = sheetTotals(payload.leads);
  const visits = sheetTotals(payload.visits);
  const booked = sheetTotals(payload.booked);
  const visitRate = leads.grand > 0 ? visits.grand / leads.grand : null;
  const bookedVisitRate = visits.grand > 0 ? booked.grand / visits.grand : null;
  const bookedLeadRate = leads.grand > 0 ? booked.grand / leads.grand : null;
  const strip = el("div", "dashboard-kpis sg-kpis");
  const items = [
    ["Total Leads", num(leads.grand)],
    ["Total Visits", num(visits.grand)],
    ["Total Booked", num(booked.grand)],
    ["Visits / Leads", visitRate == null ? "—" : pct(visitRate)],
    ["Booked / Visits", bookedVisitRate == null ? "—" : pct(bookedVisitRate)],
    ["Booked / Leads", bookedLeadRate == null ? "—" : pct(bookedLeadRate)],
    ["Months", String((payload.months || []).length)],
    ["Projects (Booked)", String(Object.keys(payload.booked?.byProject || {}).length)],
  ];
  for (const [label, value] of items) {
    const kpi = el("div", "dashboard-kpi");
    kpi.append(el("span", null, label), el("strong", null, value));
    strip.append(kpi);
  }
  mount.append(strip);
}

function dualAxisOptions() {
  const ink = inkColor();
  const muted = mutedColor();
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {mode: "index", intersect: false},
    plugins: {
      legend: {
        labels: {color: ink, boxWidth: 12, font: {size: 11}},
      },
      tooltip: {mode: "index", intersect: false},
    },
    scales: {
      x: {
        ticks: {color: muted, maxRotation: 45, font: {size: 10}},
        grid: {color: "transparent"},
      },
      y: {
        type: "linear",
        position: "left",
        beginAtZero: true,
        title: {display: true, text: "Leads / Visits", color: muted, font: {size: 11}},
        ticks: {color: muted, font: {size: 10}},
        grid: {color: "rgba(0,0,0,0.06)"},
      },
      y1: {
        type: "linear",
        position: "right",
        beginAtZero: true,
        title: {display: true, text: "Booked (right axis)", color: COLOR_BOOKED, font: {size: 11}},
        ticks: {color: COLOR_BOOKED, font: {size: 10}},
        grid: {drawOnChartArea: false},
      },
    },
  };
}

function findStatusKey(byStatus, wanted) {
  const keys = Object.keys(byStatus || {});
  const lower = String(wanted || "").toLowerCase();
  return keys.find(k => String(k).toLowerCase() === lower) || wanted;
}

function bookedStatusMonthSeries(booked, statusLabel, months) {
  const key = findStatusKey(booked?.byStatus, statusLabel);
  const byMonth = booked?.byStatus?.[key]?.byMonth || {};
  return months.map(m => Number(byMonth[m] || 0));
}

function bookedStatusDimTotals(booked, statusLabel, dimNames, dimKind) {
  const key = findStatusKey(booked?.byStatus, statusLabel);
  const nested = dimKind === "project"
    ? booked?.byStatus?.[key]?.byProject
    : booked?.byStatus?.[key]?.bySource;
  if (nested) return dimNames.map(n => bucketTotal(nested[n]));

  const statusLower = String(statusLabel || "").toLowerCase();
  const rows = booked?.rows || [];
  return dimNames.map(name => {
    let sum = 0;
    for (const row of rows) {
      if (String(row.status || "").toLowerCase() !== statusLower) continue;
      const dim = dimKind === "project" ? row.project : row.sourceNormalized;
      if ((dim || "") !== name) continue;
      for (const v of Object.values(row.months || {})) sum += Number(v) || 0;
    }
    return sum;
  });
}

function lvbSplitBarDatasets(leadsData, visitsData, demandData, cancelData) {
  return [
    {label: "Leads", data: leadsData, backgroundColor: COLOR_LEADS, borderRadius: 4, maxBarThickness: 36, yAxisID: "y"},
    {label: "Visits", data: visitsData, backgroundColor: COLOR_VISITS, borderRadius: 4, maxBarThickness: 36, yAxisID: "y"},
    {label: "Booked · Demand Letter (right)", data: demandData, backgroundColor: COLOR_BOOKED_DL, borderRadius: 4, maxBarThickness: 36, yAxisID: "y1"},
    {label: "Booked · Cancel (right)", data: cancelData, backgroundColor: COLOR_BOOKED_CANCEL, borderRadius: 4, maxBarThickness: 36, yAxisID: "y1"},
  ];
}

function addHeroDualAxisBar(grid, id, title, labels, datasets) {
  const {card, canvas} = chartCard(title, HERO_CHART_HEIGHT, "sg-chart-card--hero");
  grid.append(card);
  registerChart(id, {
    canvas,
    type: "bar",
    data: {labels, datasets},
    options: dualAxisOptions(),
  });
}

function addDoughnut(grid, id, title, labels, values) {
  const {card, canvas} = chartCard(title, 280);
  grid.append(card);
  registerChart(id, {
    canvas,
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colorsFor(labels.length),
        borderWidth: 0,
      }],
    },
    options: pieOptions(),
  });
}

function addStackedBar(grid, id, title, labels, datasets) {
  const {card, canvas} = chartCard(title, 300);
  grid.append(card);
  registerChart(id, {
    canvas,
    type: "bar",
    data: {labels, datasets},
    options: baseOptions({stacked: true}),
  });
}

function isDarkTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark";
}

/** @returns {{r:number,g:number,b:number}} */
function heatmapRgb(t) {
  t = Math.max(0, Math.min(1, Number(t) || 0));
  if (isDarkTheme()) {
    // Deep forest → bright green (never near-white; stays readable on dark UI)
    return {
      r: Math.round(14 + t * 58),
      g: Math.round(42 + t * 158),
      b: Math.round(32 + t * 88),
    };
  }
  // Soft mint → deep green
  return {
    r: Math.round(232 - t * 180),
    g: Math.round(240 - t * 90),
    b: Math.round(228 - t * 140),
  };
}

/** Dark text on light cells, light text on dark — independent of theme --ink. */
function contrastOnRgb(r, g, b) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.42 ? "#17211d" : "#ffffff";
}

function renderHeatmap(mount, title, projects, months, matrix, maxVal) {
  const block = el("div", "sg-heatmap-block");
  block.append(el("h4", null, title));
  if (!projects.length || !months.length) {
    block.append(el("p", "dashboard-empty-state", "No data for heatmap."));
    mount.append(block);
    return;
  }
  const wrap = el("div", "sg-heatmap-wrap");
  const table = el("table", "sg-heatmap");
  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  hr.append(el("th", null, "Project"));
  for (const m of months) hr.append(el("th", null, formatMonth(m)));
  thead.append(hr);
  table.append(thead);
  const tbody = document.createElement("tbody");
  const denom = maxVal > 0 ? maxVal : 1;
  for (let i = 0; i < projects.length; i++) {
    const tr = document.createElement("tr");
    tr.append(el("th", null, projects[i]));
    for (let j = 0; j < months.length; j++) {
      const v = matrix[i][j] || 0;
      const td = el("td", null, num(v));
      const rgb = heatmapRgb(v / denom);
      td.style.background = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
      td.style.color = contrastOnRgb(rgb.r, rgb.g, rgb.b);
      td.title = `${projects[i]} · ${formatMonth(months[j])}: ${num(v)}`;
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  wrap.append(table);
  block.append(wrap);
  const legend = el("div", "sg-heatmap-legend");
  legend.append(el("span", null, "Low"), el("span", "sg-heatmap-scale"), el("span", null, "High"));
  block.append(legend);
  mount.append(block);
}

function projectMonthMatrix(sheet, projects, months) {
  const byProject = sheet?.byProject || {};
  let maxVal = 0;
  const matrix = projects.map(p => {
    const bucket = byProject[p] || {};
    const byMonth = bucket.byMonth || {};
    return months.map(m => {
      const v = Number(byMonth[m] || 0);
      if (v > maxVal) maxVal = v;
      return v;
    });
  });
  return {matrix, maxVal};
}

function renderChartsGallery(mount, payload) {
  const months = payload.months || [];
  const monthLabels = months.map(formatMonth);
  const leads = payload.leads || {};
  const visits = payload.visits || {};
  const booked = payload.booked || {};

  // —— Trends ——
  const trends = makeSection("Trends", "Monthly volume (Leads → Visits → Booked by status)");
  const trendsGrid = el("div", "dashboard-charts sg-chart-grid");
  addHeroDualAxisBar(
    trendsGrid, "sg-bar-month",
    "Leads vs Visits vs Booked by month",
    monthLabels,
    lvbSplitBarDatasets(
      monthSeries(leads, months),
      monthSeries(visits, months),
      bookedStatusMonthSeries(booked, STATUS_DEMAND, months),
      bookedStatusMonthSeries(booked, STATUS_CANCEL, months)
    )
  );
  trends.append(trendsGrid);
  mount.append(trends);

  // —— Project comparison ——
  const projectKeys = [...new Set([
    ...sortedKeysByTotal(leads.byProject),
    ...sortedKeysByTotal(visits.byProject),
    ...sortedKeysByTotal(booked.byProject),
  ])].sort((a, b) => {
    const la = bucketTotal(leads.byProject?.[a]) + bucketTotal(booked.byProject?.[a]);
    const lb = bucketTotal(leads.byProject?.[b]) + bucketTotal(booked.byProject?.[b]);
    return lb - la || a.localeCompare(b);
  });
  const topProjects = projectKeys.slice(0, TOP_N);
  const projects = makeSection("By project", "Grouped bars (all projects) and share of volume");
  const projGrid = el("div", "dashboard-charts sg-chart-grid");
  addHeroDualAxisBar(
    projGrid, "sg-bar-project",
    "Leads vs Visits vs Booked by project",
    projectKeys,
    lvbSplitBarDatasets(
      projectKeys.map(p => bucketTotal(leads.byProject?.[p])),
      projectKeys.map(p => bucketTotal(visits.byProject?.[p])),
      bookedStatusDimTotals(booked, STATUS_DEMAND, projectKeys, "project"),
      bookedStatusDimTotals(booked, STATUS_CANCEL, projectKeys, "project")
    )
  );
  addDoughnut(
    projGrid, "sg-pie-leads-project",
    "Leads share by project",
    topProjects,
    topProjects.map(p => bucketTotal(leads.byProject?.[p]))
  );
  addDoughnut(
    projGrid, "sg-pie-visits-project",
    "Visits share by project",
    topProjects,
    topProjects.map(p => bucketTotal(visits.byProject?.[p]))
  );
  addDoughnut(
    projGrid, "sg-pie-booked-project",
    "Booked share by project",
    topProjects,
    topProjects.map(p => bucketTotal(booked.byProject?.[p]))
  );
  projects.append(projGrid);
  mount.append(projects);

  // —— Source ——
  const sourceKeys = [...new Set([
    ...sortedKeysByTotal(leads.bySource),
    ...sortedKeysByTotal(visits.bySource),
    ...sortedKeysByTotal(booked.bySource),
  ])].sort((a, b) => {
    const la = bucketTotal(leads.bySource?.[a]) + bucketTotal(booked.bySource?.[a]);
    const lb = bucketTotal(leads.bySource?.[b]) + bucketTotal(booked.bySource?.[b]);
    return lb - la || a.localeCompare(b);
  });
  const topSources = sourceKeys.slice(0, TOP_N);
  const sources = makeSection("By source", "Normalized Meta sources · all sources");
  const srcGrid = el("div", "dashboard-charts sg-chart-grid");
  addHeroDualAxisBar(
    srcGrid, "sg-bar-source",
    "Leads vs Visits vs Booked by source",
    sourceKeys,
    lvbSplitBarDatasets(
      sourceKeys.map(s => bucketTotal(leads.bySource?.[s])),
      sourceKeys.map(s => bucketTotal(visits.bySource?.[s])),
      bookedStatusDimTotals(booked, STATUS_DEMAND, sourceKeys, "source"),
      bookedStatusDimTotals(booked, STATUS_CANCEL, sourceKeys, "source")
    )
  );
  addDoughnut(
    srcGrid, "sg-pie-leads-source",
    "Leads share by source",
    topSources,
    topSources.map(s => bucketTotal(leads.bySource?.[s]))
  );
  addDoughnut(
    srcGrid, "sg-pie-visits-source",
    "Visits share by source",
    topSources,
    topSources.map(s => bucketTotal(visits.bySource?.[s]))
  );
  addDoughnut(
    srcGrid, "sg-pie-booked-source",
    "Booked share by source",
    topSources,
    topSources.map(s => bucketTotal(booked.bySource?.[s]))
  );
  sources.append(srcGrid);
  mount.append(sources);

  // —— Booked status ——
  if (booked.byStatus && Object.keys(booked.byStatus).length) {
    const statusKeys = sortedKeysByTotal(booked.byStatus);
    const statusSec = makeSection("Booked by status", "Demand Letter vs Cancel (and other statuses)");
    const statusGrid = el("div", "dashboard-charts sg-chart-grid");
    addDoughnut(
      statusGrid, "sg-pie-booked-status",
      "Booked share by status",
      statusKeys,
      statusKeys.map(s => bucketTotal(booked.byStatus?.[s]))
    );
    addStackedBar(
      statusGrid, "sg-stack-booked-status-month",
      "Booked · status stacked by month",
      monthLabels,
      statusKeys.map((name, i) => ({
        label: name,
        data: months.map(m => Number(booked.byStatus?.[name]?.byMonth?.[m] || 0)),
        backgroundColor: PALETTE[i % PALETTE.length],
        borderWidth: 0,
        maxBarThickness: 40,
      }))
    );
    statusSec.append(statusGrid);
    mount.append(statusSec);
  }

  // —— Heatmaps ——
  const heat = makeSection("Heatmaps", "Project × Month intensity (Leads, Visits, Booked)");
  const heatProjects = projectKeys.slice(0, 20);
  const leadsHm = projectMonthMatrix(leads, heatProjects, months);
  const visitsHm = projectMonthMatrix(visits, heatProjects, months);
  const bookedHm = projectMonthMatrix(booked, heatProjects, months);
  renderHeatmap(heat, "Leads · Project × Month", heatProjects, months, leadsHm.matrix, leadsHm.maxVal);
  renderHeatmap(heat, "Visits · Project × Month", heatProjects, months, visitsHm.matrix, visitsHm.maxVal);
  renderHeatmap(heat, "Booked · Project × Month", heatProjects, months, bookedHm.matrix, bookedHm.maxVal);
  mount.append(heat);
}

function sortableTable(headers, rows, {numericCols = new Set()} = {}) {
  const wrap = el("div", "dashboard-table-wrap sg-table-wrap");
  const table = el("table", "dashboard-table");
  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  const state = {col: 0, dir: 1};
  headers.forEach((h, i) => {
    const th = el("th", "sg-sortable", h);
    th.tabIndex = 0;
    th.addEventListener("click", () => {
      if (state.col === i) state.dir *= -1;
      else { state.col = i; state.dir = 1; }
      redraw();
    });
    hr.append(th);
  });
  thead.append(hr);
  table.append(thead);
  const tbody = document.createElement("tbody");
  table.append(tbody);
  wrap.append(table);

  function redraw() {
    const sorted = [...rows].sort((a, b) => {
      const av = a[state.col];
      const bv = b[state.col];
      if (numericCols.has(state.col)) {
        return (Number(av) - Number(bv)) * state.dir;
      }
      return String(av).localeCompare(String(bv), undefined, {sensitivity: "base"}) * state.dir;
    });
    tbody.replaceChildren();
    if (!sorted.length) {
      const tr = document.createElement("tr");
      const td = el("td", "dashboard-empty", "No rows.");
      td.colSpan = headers.length;
      tr.append(td);
      tbody.append(tr);
      return;
    }
    for (const row of sorted) {
      const tr = document.createElement("tr");
      row.forEach((cell, i) => {
        const td = el("td", null, numericCols.has(i) ? num(cell) : String(cell ?? ""));
        tr.append(td);
      });
      tbody.append(tr);
    }
  }
  redraw();
  return wrap;
}

function monthVal(sheet, m) {
  return Number(sheet?.byMonth?.[m] || sheet?.totals?.byMonth?.[m] || 0);
}

function renderTables(mount, payload) {
  const section = makeSection("Tables", "Sortable breakdowns by month, project, source, and status");
  const tabs = el("div", "sg-table-tabs", null);
  const panels = el("div", "sg-table-panels");
  const months = payload.months || [];
  const leads = payload.leads || {};
  const visits = payload.visits || {};
  const booked = payload.booked || {};

  const tabDefs = [
    {
      id: "month",
      label: "By Month",
      build() {
        const rows = months.map(m => {
          const L = monthVal(leads, m);
          const V = monthVal(visits, m);
          const B = monthVal(booked, m);
          return [
            formatMonth(m),
            L, V, B,
            Number(((L > 0 ? V / L : 0) * 100).toFixed(2)),
            Number(((V > 0 ? B / V : 0) * 100).toFixed(2)),
            Number(((L > 0 ? B / L : 0) * 100).toFixed(2)),
          ];
        });
        return sortableTable(
          ["Month", "Leads", "Visits", "Booked", "V/L %", "B/V %", "B/L %"],
          rows,
          {numericCols: new Set([1, 2, 3, 4, 5, 6])}
        );
      },
    },
    {
      id: "project",
      label: "By Project",
      build() {
        const names = [...new Set([
          ...Object.keys(leads.byProject || {}),
          ...Object.keys(visits.byProject || {}),
          ...Object.keys(booked.byProject || {}),
        ])].sort();
        const rows = names.map(n => [
          n,
          bucketTotal(leads.byProject?.[n]),
          bucketTotal(visits.byProject?.[n]),
          bucketTotal(booked.byProject?.[n]),
        ]);
        return sortableTable(
          ["Project", "Leads", "Visits", "Booked"],
          rows,
          {numericCols: new Set([1, 2, 3])}
        );
      },
    },
    {
      id: "source",
      label: "By Source",
      build() {
        const names = [...new Set([
          ...Object.keys(leads.bySource || {}),
          ...Object.keys(visits.bySource || {}),
          ...Object.keys(booked.bySource || {}),
        ])].sort();
        const rows = names.map(n => [
          n,
          bucketTotal(leads.bySource?.[n]),
          bucketTotal(visits.bySource?.[n]),
          bucketTotal(booked.bySource?.[n]),
        ]);
        return sortableTable(
          ["Source", "Leads", "Visits", "Booked"],
          rows,
          {numericCols: new Set([1, 2, 3])}
        );
      },
    },
    {
      id: "status",
      label: "By Status",
      build() {
        const names = Object.keys(booked.byStatus || {}).sort();
        const rows = names.map(n => [n, bucketTotal(booked.byStatus?.[n])]);
        return sortableTable(
          ["Status", "Booked"],
          rows,
          {numericCols: new Set([1])}
        );
      },
    },
  ];

  let active = "month";
  const panelNodes = {};

  for (const def of tabDefs) {
    const btn = el("button", "sg-table-tab", def.label);
    btn.type = "button";
    btn.dataset.tab = def.id;
    btn.addEventListener("click", () => {
      active = def.id;
      sync();
    });
    tabs.append(btn);
    const panel = el("div", "sg-table-panel hidden");
    panel.dataset.tab = def.id;
    panel.append(def.build());
    panels.append(panel);
    panelNodes[def.id] = {btn, panel};
  }

  function sync() {
    for (const def of tabDefs) {
      const {btn, panel} = panelNodes[def.id];
      const on = def.id === active;
      btn.classList.toggle("active", on);
      panel.classList.toggle("hidden", !on);
    }
  }
  sync();
  section.append(tabs, panels);
  mount.append(section);
}

/**
 * Render full Sales Graph dashboard into mount.
 * @param {HTMLElement} mount
 * @param {object|null} payload
 * @param {{meta?: object, preview?: boolean}} opts
 */
export function renderSalesGraphDashboard(mount, payload, opts = {}) {
  destroySalesGraphCharts();
  if (!mount) return;
  mount.replaceChildren();

  if (!payload || !payload.leads || !payload.visits) {
    mount.append(el("div", "dashboard-empty-state", opts.preview
      ? "Create a preview from Leads + Visits + Booked first."
      : "No Sales Graph has been published yet."));
    return;
  }
  // Legacy published payloads may have booked: null — treat as empty sheet
  if (!payload.booked) {
    payload = {
      ...payload,
      booked: {
        fileName: "",
        totals: {grand: 0, byMonth: {}},
        byMonth: {},
        byProject: {},
        bySource: {},
        byStatus: {},
        rows: [],
      },
    };
  }

  if (opts.preview) {
    mount.append(el("p", "sg-preview-banner", "Local preview — not yet published."));
  } else if (opts.meta || payload.title) {
    const bits = [];
    if (payload.title) bits.push(payload.title);
    if (opts.meta?.uploaded_by_name) bits.push(`by ${opts.meta.uploaded_by_name}`);
    if (opts.meta?.uploaded_at || payload.uploaded_at) {
      bits.push(String(opts.meta?.uploaded_at || payload.uploaded_at));
    }
    if (bits.length) mount.append(el("p", "sg-meta-line", bits.join(" · ")));
  }

  renderKpis(mount, payload);
  try {
    renderChartsGallery(mount, payload);
  } catch (err) {
    mount.append(el("div", "validation error", err.message || "Chart render failed."));
  }
  renderTables(mount, payload);
}

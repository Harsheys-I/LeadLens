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
/** Fixed px width per category group (4 series) so bars stay readable. */
const CATEGORY_WIDTH_PX = 56;
const CATEGORY_WIDTH_STACKED_PX = 48;

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

function makeSection(title, subtitle) {
  const section = el("section", "sg-section");
  const head = el("div", "sg-section-head");
  head.append(el("h3", null, title));
  if (subtitle) head.append(el("p", "sg-section-sub", subtitle));
  section.append(head);
  return section;
}

/** Strip Chart.js dual-axis " (right)" suffix from legend labels. */
function legendLabelsWithoutRight(Chart) {
  const ink = inkColor();
  return {
    color: ink,
    boxWidth: 12,
    font: {size: 11},
    generateLabels(chart) {
      const base = Chart.defaults.plugins.legend.labels.generateLabels;
      const items = typeof base === "function" ? base(chart) : [];
      return items.map(item => ({
        ...item,
        text: String(item.text || "").replace(/\s*\(right\)\s*/gi, "").trim(),
      }));
    },
  };
}

function sizeScrollableCanvas(scrollEl, canvasWrap, categoryCount, categoryWidth) {
  if (!scrollEl || !canvasWrap) return;
  const count = Math.max(1, Number(categoryCount) || 1);
  const minW = count * categoryWidth;
  const containerW = scrollEl.clientWidth || 0;
  const width = Math.max(containerW, minW);
  canvasWrap.style.width = `${width}px`;
  canvasWrap.style.minWidth = `${width}px`;
}

/**
 * Chart card with optional horizontal scroll for multi-category bar charts.
 * @returns {{card: HTMLElement, canvas: HTMLCanvasElement, scrollEl: HTMLElement|null, canvasWrap: HTMLElement, setCategoryCount: Function}}
 */
function chartCard(title, canvasHeight = 260, {
  extraClass = "",
  scrollable = false,
  categoryWidth = CATEGORY_WIDTH_PX,
} = {}) {
  const card = el("div", `dashboard-chart-card sg-chart-card${extraClass ? ` ${extraClass}` : ""}`);
  card.append(el("h3", null, title));
  const canvasWrap = el("div", "dashboard-chart-canvas");
  canvasWrap.style.height = `${canvasHeight}px`;
  const canvas = document.createElement("canvas");
  canvasWrap.append(canvas);

  let scrollEl = null;
  if (scrollable) {
    scrollEl = el("div", "sg-chart-scroll");
    scrollEl.append(canvasWrap);
    card.append(scrollEl);
  } else {
    card.append(canvasWrap);
  }

  function setCategoryCount(n) {
    if (!scrollable || !scrollEl) return;
    sizeScrollableCanvas(scrollEl, canvasWrap, n, categoryWidth);
  }

  return {card, canvas, scrollEl, canvasWrap, setCategoryCount};
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
  const Chart = requireChart();
  const muted = mutedColor();
  return {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis,
    interaction: {mode: "index", intersect: false},
    plugins: {
      legend: {labels: legendLabelsWithoutRight(Chart)},
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
  const Chart = requireChart();
  const muted = mutedColor();
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {mode: "index", intersect: false},
    plugins: {
      legend: {labels: legendLabelsWithoutRight(Chart)},
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
        title: {display: true, text: "Booked", color: COLOR_BOOKED, font: {size: 11}},
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

function lvbSplitBarDatasets(leadsData, visitsData, demandData, cancelData) {
  return [
    {label: "Leads", data: leadsData, backgroundColor: COLOR_LEADS, borderRadius: 4, maxBarThickness: 28, yAxisID: "y"},
    {label: "Visits", data: visitsData, backgroundColor: COLOR_VISITS, borderRadius: 4, maxBarThickness: 28, yAxisID: "y"},
    {label: "Booked · Demand Letter", data: demandData, backgroundColor: COLOR_BOOKED_DL, borderRadius: 4, maxBarThickness: 28, yAxisID: "y1"},
    {label: "Booked · Cancel", data: cancelData, backgroundColor: COLOR_BOOKED_CANCEL, borderRadius: 4, maxBarThickness: 28, yAxisID: "y1"},
  ];
}

// —— Filter / slicer helpers ——

function collectDimKeys(payload) {
  const leads = payload.leads || {};
  const visits = payload.visits || {};
  const booked = payload.booked || {};
  const projects = [...new Set([
    ...Object.keys(leads.byProject || {}),
    ...Object.keys(visits.byProject || {}),
    ...Object.keys(booked.byProject || {}),
  ])].sort((a, b) => a.localeCompare(b));
  const sources = [...new Set([
    ...Object.keys(leads.bySource || {}),
    ...Object.keys(visits.bySource || {}),
    ...Object.keys(booked.bySource || {}),
  ])].sort((a, b) => a.localeCompare(b));
  const statuses = Object.keys(booked.byStatus || {}).sort((a, b) => a.localeCompare(b));
  return {projects, sources, statuses};
}

function cloneFilterState(state) {
  return {
    projects: new Set(state.projects),
    sources: new Set(state.sources),
    statuses: new Set(state.statuses),
    monthFrom: state.monthFrom,
    monthTo: state.monthTo,
  };
}

function makeFilterState(dims, months) {
  return {
    projects: new Set(dims.projects),
    sources: new Set(dims.sources),
    statuses: new Set(dims.statuses.length ? dims.statuses : [STATUS_DEMAND, STATUS_CANCEL]),
    monthFrom: months[0] || "",
    monthTo: months[months.length - 1] || "",
  };
}

function filteredMonths(months, state) {
  return (months || []).filter(m =>
    (!state.monthFrom || m >= state.monthFrom) &&
    (!state.monthTo || m <= state.monthTo)
  );
}

function statusAllowed(state, statusLabel, byStatus) {
  if (!state.statuses.size) return true;
  const key = findStatusKey(byStatus, statusLabel);
  if (state.statuses.has(key)) return true;
  const lower = String(statusLabel || "").toLowerCase();
  for (const s of state.statuses) {
    if (String(s).toLowerCase() === lower) return true;
  }
  return false;
}

function rowMatches(row, state, {ignoreProject = false, ignoreSource = false, ignoreStatus = false} = {}) {
  if (!ignoreProject && state.projects.size && !state.projects.has(row.project)) return false;
  if (!ignoreSource && state.sources.size && !state.sources.has(row.sourceNormalized)) return false;
  if (!ignoreStatus && row.status != null && state.statuses.size && !state.statuses.has(row.status)) return false;
  return true;
}

function sumSheetByMonths(sheet, months, state, opts = {}) {
  const out = months.map(() => 0);
  const rows = sheet?.rows;
  if (rows?.length) {
    for (const row of rows) {
      if (!rowMatches(row, state, opts)) continue;
      for (let i = 0; i < months.length; i++) {
        out[i] += Number(row.months?.[months[i]] || 0);
      }
    }
    return out;
  }
  // Fallback: pre-aggregated byMonth (no project/source filter possible)
  const byMonth = sheet?.byMonth || sheet?.totals?.byMonth || {};
  return months.map(m => Number(byMonth[m] || 0));
}

function sumSheetByDim(sheet, dimNames, dimKind, months, state, opts = {}) {
  const monthSet = new Set(months);
  const out = dimNames.map(() => 0);
  const rows = sheet?.rows;
  if (rows?.length) {
    const ignore = dimKind === "project"
      ? {ignoreProject: true, ...opts}
      : {ignoreSource: true, ...opts};
    for (const row of rows) {
      if (!rowMatches(row, state, ignore)) continue;
      const dim = dimKind === "project" ? row.project : row.sourceNormalized;
      const idx = dimNames.indexOf(dim);
      if (idx < 0) continue;
      for (const m of months) out[idx] += Number(row.months?.[m] || 0);
    }
    return out;
  }
  const map = dimKind === "project" ? sheet?.byProject : sheet?.bySource;
  return dimNames.map(name => {
    const bucket = map?.[name];
    if (!bucket) return 0;
    let t = 0;
    for (const [m, v] of Object.entries(bucket.byMonth || {})) {
      if (monthSet.has(m)) t += Number(v) || 0;
    }
    return t || (monthSet.size === Object.keys(bucket.byMonth || {}).length ? bucketTotal(bucket) : t);
  });
}

function bookedStatusByMonths(booked, statusLabel, months, state, opts = {}) {
  if (!statusAllowed(state, statusLabel, booked?.byStatus)) return months.map(() => 0);
  const key = findStatusKey(booked?.byStatus, statusLabel);
  const rows = booked?.rows;
  if (rows?.length) {
    const statusLower = String(statusLabel || "").toLowerCase();
    const out = months.map(() => 0);
    for (const row of rows) {
      if (String(row.status || "").toLowerCase() !== statusLower) continue;
      if (!rowMatches(row, state, {...opts, ignoreStatus: true})) continue;
      for (let i = 0; i < months.length; i++) {
        out[i] += Number(row.months?.[months[i]] || 0);
      }
    }
    return out;
  }
  const byMonth = booked?.byStatus?.[key]?.byMonth || {};
  return months.map(m => Number(byMonth[m] || 0));
}

function bookedStatusByDim(booked, statusLabel, dimNames, dimKind, months, state) {
  if (!statusAllowed(state, statusLabel, booked?.byStatus)) return dimNames.map(() => 0);
  const statusLower = String(statusLabel || "").toLowerCase();
  const rows = booked?.rows;
  if (rows?.length) {
    const out = dimNames.map(() => 0);
    const ignore = dimKind === "project"
      ? {ignoreProject: true, ignoreStatus: true}
      : {ignoreSource: true, ignoreStatus: true};
    for (const row of rows) {
      if (String(row.status || "").toLowerCase() !== statusLower) continue;
      if (!rowMatches(row, state, ignore)) continue;
      const dim = dimKind === "project" ? row.project : row.sourceNormalized;
      const idx = dimNames.indexOf(dim);
      if (idx < 0) continue;
      for (const m of months) out[idx] += Number(row.months?.[m] || 0);
    }
    return out;
  }
  const key = findStatusKey(booked?.byStatus, statusLabel);
  const nested = dimKind === "project"
    ? booked?.byStatus?.[key]?.byProject
    : booked?.byStatus?.[key]?.bySource;
  const monthSet = new Set(months);
  return dimNames.map(name => {
    const bucket = nested?.[name];
    if (!bucket) return 0;
    let t = 0;
    for (const [m, v] of Object.entries(bucket.byMonth || {})) {
      if (monthSet.has(m)) t += Number(v) || 0;
    }
    return t;
  });
}

function filterDimNames(names, selected, kind) {
  if (kind === "project") return names.filter(n => selected.projects.has(n));
  if (kind === "source") return names.filter(n => selected.sources.has(n));
  return names;
}

/**
 * Compact per-card slicer bar.
 * @param {object} opts
 * @param {string[]} opts.months
 * @param {{projects:string[],sources:string[],statuses:string[]}} opts.dims
 * @param {object} opts.state
 * @param {Function} opts.onChange
 * @param {{project?:boolean,source?:boolean,month?:boolean,status?:boolean}} opts.show
 */
function attachSlicers(card, {months, dims, state, onChange, show = {}}) {
  const bar = el("div", "sg-slicer-bar");
  const flags = {
    project: show.project !== false,
    source: show.source !== false,
    month: show.month !== false,
    status: show.status !== false && dims.statuses.length > 0,
  };

  function multiSlicer(label, allValues, selectedSet) {
    const details = el("details", "sg-slicer");
    const summary = el("summary", "sg-slicer-summary");
    const updateSummary = () => {
      const n = selectedSet.size;
      const total = allValues.length;
      summary.textContent = n >= total ? `${label}: All` : `${label}: ${n}/${total}`;
    };
    updateSummary();
    details.append(summary);
    const panel = el("div", "sg-slicer-panel");
    const actions = el("div", "sg-slicer-actions");
    const btnAll = el("button", "sg-slicer-link", "All");
    btnAll.type = "button";
    const btnNone = el("button", "sg-slicer-link", "None");
    btnNone.type = "button";
    btnAll.addEventListener("click", e => {
      e.preventDefault();
      allValues.forEach(v => selectedSet.add(v));
      panel.querySelectorAll("input[type=checkbox]").forEach(cb => { cb.checked = true; });
      updateSummary();
      onChange();
    });
    btnNone.addEventListener("click", e => {
      e.preventDefault();
      selectedSet.clear();
      panel.querySelectorAll("input[type=checkbox]").forEach(cb => { cb.checked = false; });
      updateSummary();
      onChange();
    });
    actions.append(btnAll, btnNone);
    panel.append(actions);
    for (const value of allValues) {
      const row = el("label", "sg-slicer-option");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = selectedSet.has(value);
      cb.addEventListener("change", () => {
        if (cb.checked) selectedSet.add(value);
        else selectedSet.delete(value);
        updateSummary();
        onChange();
      });
      row.append(cb, document.createTextNode(value || "(blank)"));
      panel.append(row);
    }
    details.append(panel);
    return details;
  }

  if (flags.project && dims.projects.length) {
    bar.append(multiSlicer("Project", dims.projects, state.projects));
  }
  if (flags.source && dims.sources.length) {
    bar.append(multiSlicer("Source", dims.sources, state.sources));
  }
  if (flags.status && dims.statuses.length) {
    bar.append(multiSlicer("Booked status", dims.statuses, state.statuses));
  }
  if (flags.month && months.length) {
    const monthWrap = el("div", "sg-slicer-months");
    const fromLabel = el("label", "sg-slicer-month");
    fromLabel.append(document.createTextNode("From"));
    const fromSel = document.createElement("select");
    fromSel.setAttribute("aria-label", "Month from");
    const toLabel = el("label", "sg-slicer-month");
    toLabel.append(document.createTextNode("To"));
    const toSel = document.createElement("select");
    toSel.setAttribute("aria-label", "Month to");
    for (const m of months) {
      const o1 = document.createElement("option");
      o1.value = m;
      o1.textContent = formatMonth(m);
      if (m === state.monthFrom) o1.selected = true;
      fromSel.append(o1);
      const o2 = document.createElement("option");
      o2.value = m;
      o2.textContent = formatMonth(m);
      if (m === state.monthTo) o2.selected = true;
      toSel.append(o2);
    }
    fromSel.addEventListener("change", () => {
      state.monthFrom = fromSel.value;
      if (state.monthTo && state.monthFrom > state.monthTo) {
        state.monthTo = state.monthFrom;
        toSel.value = state.monthTo;
      }
      onChange();
    });
    toSel.addEventListener("change", () => {
      state.monthTo = toSel.value;
      if (state.monthFrom && state.monthTo < state.monthFrom) {
        state.monthFrom = state.monthTo;
        fromSel.value = state.monthFrom;
      }
      onChange();
    });
    fromLabel.append(fromSel);
    toLabel.append(toSel);
    monthWrap.append(fromLabel, toLabel);
    bar.append(monthWrap);
  }

  const titleEl = card.querySelector("h3, h4");
  if (titleEl?.nextSibling) card.insertBefore(bar, titleEl.nextSibling);
  else if (titleEl) titleEl.after(bar);
  else card.prepend(bar);
  return bar;
}

function mountHeroDualAxis(grid, id, title, getData, slicerOpts) {
  const {card, canvas, setCategoryCount} = chartCard(title, HERO_CHART_HEIGHT, {
    extraClass: "sg-chart-card--hero",
    scrollable: true,
    categoryWidth: CATEGORY_WIDTH_PX,
  });
  grid.append(card);

  const state = cloneFilterState(slicerOpts.baseState);
  const paint = () => {
    const {labels, datasets} = getData(state);
    setCategoryCount(labels.length);
    registerChart(id, {
      canvas,
      type: "bar",
      data: {labels, datasets},
      options: dualAxisOptions(),
    });
  };
  attachSlicers(card, {
    months: slicerOpts.months,
    dims: slicerOpts.dims,
    state,
    show: slicerOpts.show,
    onChange: paint,
  });
  paint();
  // Re-measure after layout
  requestAnimationFrame(() => {
    const {labels} = getData(state);
    setCategoryCount(labels.length);
    const chart = chartRegistry.get(id);
    try { chart?.resize(); } catch { /* ignore */ }
  });
}

function mountDoughnut(grid, id, title, getData, slicerOpts) {
  const {card, canvas} = chartCard(title, 280);
  grid.append(card);
  const state = cloneFilterState(slicerOpts.baseState);
  const paint = () => {
    const {labels, values} = getData(state);
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
  };
  attachSlicers(card, {
    months: slicerOpts.months,
    dims: slicerOpts.dims,
    state,
    show: slicerOpts.show,
    onChange: paint,
  });
  paint();
}

function mountStackedBar(grid, id, title, getData, slicerOpts) {
  const {card, canvas, setCategoryCount} = chartCard(title, 300, {
    scrollable: true,
    categoryWidth: CATEGORY_WIDTH_STACKED_PX,
  });
  grid.append(card);
  const state = cloneFilterState(slicerOpts.baseState);
  const paint = () => {
    const {labels, datasets} = getData(state);
    setCategoryCount(labels.length);
    registerChart(id, {
      canvas,
      type: "bar",
      data: {labels, datasets},
      options: baseOptions({stacked: true}),
    });
  };
  attachSlicers(card, {
    months: slicerOpts.months,
    dims: slicerOpts.dims,
    state,
    show: slicerOpts.show,
    onChange: paint,
  });
  paint();
  requestAnimationFrame(() => {
    const {labels} = getData(state);
    setCategoryCount(labels.length);
    try { chartRegistry.get(id)?.resize(); } catch { /* ignore */ }
  });
}

function isDarkTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark";
}

/** @returns {{r:number,g:number,b:number}} */
function heatmapRgb(t) {
  t = Math.max(0, Math.min(1, Number(t) || 0));
  if (isDarkTheme()) {
    return {
      r: Math.round(14 + t * 58),
      g: Math.round(42 + t * 158),
      b: Math.round(32 + t * 88),
    };
  }
  return {
    r: Math.round(232 - t * 180),
    g: Math.round(240 - t * 90),
    b: Math.round(228 - t * 140),
  };
}

function contrastOnRgb(r, g, b) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.42 ? "#17211d" : "#ffffff";
}

function projectMonthMatrixFiltered(sheet, projects, months, state) {
  let maxVal = 0;
  const matrix = projects.map(p => months.map(m => {
    let v = 0;
    const rows = sheet?.rows;
    if (rows?.length) {
      for (const row of rows) {
        if (row.project !== p) continue;
        if (!rowMatches(row, state, {ignoreProject: true})) continue;
        v += Number(row.months?.[m] || 0);
      }
    } else {
      v = Number(sheet?.byProject?.[p]?.byMonth?.[m] || 0);
    }
    if (v > maxVal) maxVal = v;
    return v;
  }));
  return {matrix, maxVal};
}

function renderChartsGallery(mount, payload) {
  const months = payload.months || [];
  const leads = payload.leads || {};
  const visits = payload.visits || {};
  const booked = payload.booked || {};
  const dims = collectDimKeys(payload);
  const baseState = makeFilterState(dims, months);

  const projectKeys = [...new Set([
    ...sortedKeysByTotal(leads.byProject),
    ...sortedKeysByTotal(visits.byProject),
    ...sortedKeysByTotal(booked.byProject),
  ])].sort((a, b) => {
    const la = bucketTotal(leads.byProject?.[a]) + bucketTotal(booked.byProject?.[a]);
    const lb = bucketTotal(leads.byProject?.[b]) + bucketTotal(booked.byProject?.[b]);
    return lb - la || a.localeCompare(b);
  });
  const sourceKeys = [...new Set([
    ...sortedKeysByTotal(leads.bySource),
    ...sortedKeysByTotal(visits.bySource),
    ...sortedKeysByTotal(booked.bySource),
  ])].sort((a, b) => {
    const la = bucketTotal(leads.bySource?.[a]) + bucketTotal(booked.bySource?.[a]);
    const lb = bucketTotal(leads.bySource?.[b]) + bucketTotal(booked.bySource?.[b]);
    return lb - la || a.localeCompare(b);
  });

  const slicerBase = {months, dims, baseState};

  // —— Trends ——
  const trends = makeSection("Trends", "Monthly volume (Leads → Visits → Booked by status)");
  const trendsGrid = el("div", "dashboard-charts sg-chart-grid");
  mountHeroDualAxis(
    trendsGrid, "sg-bar-month",
    "Leads vs Visits vs Booked by month",
    (state) => {
      const ms = filteredMonths(months, state);
      return {
        labels: ms.map(formatMonth),
        datasets: lvbSplitBarDatasets(
          sumSheetByMonths(leads, ms, state),
          sumSheetByMonths(visits, ms, state),
          bookedStatusByMonths(booked, STATUS_DEMAND, ms, state),
          bookedStatusByMonths(booked, STATUS_CANCEL, ms, state)
        ),
      };
    },
    {...slicerBase, show: {project: true, source: true, month: true, status: true}}
  );
  trends.append(trendsGrid);
  mount.append(trends);

  // —— Project comparison ——
  const projects = makeSection("By project", "Grouped bars (all projects) and share of volume");
  const projGrid = el("div", "dashboard-charts sg-chart-grid");
  mountHeroDualAxis(
    projGrid, "sg-bar-project",
    "Leads vs Visits vs Booked by project",
    (state) => {
      const ms = filteredMonths(months, state);
      const names = filterDimNames(projectKeys, state, "project");
      return {
        labels: names,
        datasets: lvbSplitBarDatasets(
          sumSheetByDim(leads, names, "project", ms, state),
          sumSheetByDim(visits, names, "project", ms, state),
          bookedStatusByDim(booked, STATUS_DEMAND, names, "project", ms, state),
          bookedStatusByDim(booked, STATUS_CANCEL, names, "project", ms, state)
        ),
      };
    },
    {...slicerBase, show: {project: true, source: true, month: true, status: true}}
  );
  mountDoughnut(
    projGrid, "sg-pie-leads-project",
    "Leads share by project",
    (state) => {
      const ms = filteredMonths(months, state);
      const names = filterDimNames(projectKeys, state, "project").slice(0, TOP_N);
      return {labels: names, values: sumSheetByDim(leads, names, "project", ms, state)};
    },
    {...slicerBase, show: {project: true, source: true, month: true, status: false}}
  );
  mountDoughnut(
    projGrid, "sg-pie-visits-project",
    "Visits share by project",
    (state) => {
      const ms = filteredMonths(months, state);
      const names = filterDimNames(projectKeys, state, "project").slice(0, TOP_N);
      return {labels: names, values: sumSheetByDim(visits, names, "project", ms, state)};
    },
    {...slicerBase, show: {project: true, source: true, month: true, status: false}}
  );
  mountDoughnut(
    projGrid, "sg-pie-booked-project",
    "Booked share by project",
    (state) => {
      const ms = filteredMonths(months, state);
      const names = filterDimNames(projectKeys, state, "project").slice(0, TOP_N);
      return {
        labels: names,
        values: sumSheetByDim(booked, names, "project", ms, state, {ignoreStatus: false}),
      };
    },
    {...slicerBase, show: {project: true, source: true, month: true, status: true}}
  );
  projects.append(projGrid);
  mount.append(projects);

  // —— Source ——
  const sources = makeSection("By source", "Normalized Meta sources · all sources");
  const srcGrid = el("div", "dashboard-charts sg-chart-grid");
  mountHeroDualAxis(
    srcGrid, "sg-bar-source",
    "Leads vs Visits vs Booked by source",
    (state) => {
      const ms = filteredMonths(months, state);
      const names = filterDimNames(sourceKeys, state, "source");
      return {
        labels: names,
        datasets: lvbSplitBarDatasets(
          sumSheetByDim(leads, names, "source", ms, state),
          sumSheetByDim(visits, names, "source", ms, state),
          bookedStatusByDim(booked, STATUS_DEMAND, names, "source", ms, state),
          bookedStatusByDim(booked, STATUS_CANCEL, names, "source", ms, state)
        ),
      };
    },
    {...slicerBase, show: {project: true, source: true, month: true, status: true}}
  );
  mountDoughnut(
    srcGrid, "sg-pie-leads-source",
    "Leads share by source",
    (state) => {
      const ms = filteredMonths(months, state);
      const names = filterDimNames(sourceKeys, state, "source").slice(0, TOP_N);
      return {labels: names, values: sumSheetByDim(leads, names, "source", ms, state)};
    },
    {...slicerBase, show: {project: true, source: true, month: true, status: false}}
  );
  mountDoughnut(
    srcGrid, "sg-pie-visits-source",
    "Visits share by source",
    (state) => {
      const ms = filteredMonths(months, state);
      const names = filterDimNames(sourceKeys, state, "source").slice(0, TOP_N);
      return {labels: names, values: sumSheetByDim(visits, names, "source", ms, state)};
    },
    {...slicerBase, show: {project: true, source: true, month: true, status: false}}
  );
  mountDoughnut(
    srcGrid, "sg-pie-booked-source",
    "Booked share by source",
    (state) => {
      const ms = filteredMonths(months, state);
      const names = filterDimNames(sourceKeys, state, "source").slice(0, TOP_N);
      return {labels: names, values: sumSheetByDim(booked, names, "source", ms, state)};
    },
    {...slicerBase, show: {project: true, source: true, month: true, status: true}}
  );
  sources.append(srcGrid);
  mount.append(sources);

  // —— Booked status ——
  if (booked.byStatus && Object.keys(booked.byStatus).length) {
    const statusKeys = sortedKeysByTotal(booked.byStatus);
    const statusSec = makeSection("Booked by status", "Demand Letter vs Cancel (and other statuses)");
    const statusGrid = el("div", "dashboard-charts sg-chart-grid");
    mountDoughnut(
      statusGrid, "sg-pie-booked-status",
      "Booked share by status",
      (state) => {
        const ms = filteredMonths(months, state);
        const names = statusKeys.filter(s => !state.statuses.size || state.statuses.has(s));
        const values = names.map(name => {
          const local = cloneFilterState(state);
          local.statuses = new Set([name]);
          const series = sumSheetByMonths(booked, ms, local);
          return series.reduce((a, b) => a + b, 0);
        });
        return {labels: names, values};
      },
      {...slicerBase, show: {project: true, source: true, month: true, status: true}}
    );
    mountStackedBar(
      statusGrid, "sg-stack-booked-status-month",
      "Booked · status stacked by month",
      (state) => {
        const ms = filteredMonths(months, state);
        const names = statusKeys.filter(s => !state.statuses.size || state.statuses.has(s));
        return {
          labels: ms.map(formatMonth),
          datasets: names.map((name, i) => {
            const local = cloneFilterState(state);
            local.statuses = new Set([name]);
            return {
              label: name,
              data: sumSheetByMonths(booked, ms, local),
              backgroundColor: PALETTE[i % PALETTE.length],
              borderWidth: 0,
              maxBarThickness: 40,
            };
          }),
        };
      },
      {...slicerBase, show: {project: true, source: true, month: true, status: true}}
    );
    statusSec.append(statusGrid);
    mount.append(statusSec);
  }

  // —— Heatmaps ——
  const heat = makeSection("Heatmaps", "Project × Month intensity (Leads, Visits, Booked)");
  const heatProjectsAll = projectKeys.slice(0, 20);

  function mountFilteredHeatmap(sheetTitle, sheet) {
    const block = el("div", "sg-heatmap-block");
    block.append(el("h4", null, sheetTitle));
    const state = cloneFilterState(baseState);
    const body = el("div", "sg-heatmap-body");

    const paint = () => {
      const ms = filteredMonths(months, state);
      const projs = heatProjectsAll.filter(p => state.projects.has(p));
      const {matrix, maxVal} = projectMonthMatrixFiltered(sheet, projs, ms, state);
      body.replaceChildren();
      if (!projs.length || !ms.length) {
        body.append(el("p", "dashboard-empty-state", "No data for heatmap."));
        return;
      }
      const wrap = el("div", "sg-heatmap-wrap");
      const table = el("table", "sg-heatmap");
      const thead = document.createElement("thead");
      const hr = document.createElement("tr");
      hr.append(el("th", null, "Project"));
      for (const m of ms) hr.append(el("th", null, formatMonth(m)));
      thead.append(hr);
      table.append(thead);
      const tbody = document.createElement("tbody");
      const denom = maxVal > 0 ? maxVal : 1;
      for (let i = 0; i < projs.length; i++) {
        const tr = document.createElement("tr");
        tr.append(el("th", null, projs[i]));
        for (let j = 0; j < ms.length; j++) {
          const v = matrix[i][j] || 0;
          const td = el("td", null, num(v));
          const rgb = heatmapRgb(v / denom);
          td.style.background = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
          td.style.color = contrastOnRgb(rgb.r, rgb.g, rgb.b);
          td.title = `${projs[i]} · ${formatMonth(ms[j])}: ${num(v)}`;
          tr.append(td);
        }
        tbody.append(tr);
      }
      table.append(tbody);
      wrap.append(table);
      body.append(wrap);
      const legend = el("div", "sg-heatmap-legend");
      legend.append(el("span", null, "Low"), el("span", "sg-heatmap-scale"), el("span", null, "High"));
      body.append(legend);
    };

    attachSlicers(block, {
      months,
      dims,
      state,
      show: {project: true, source: true, month: true, status: false},
      onChange: paint,
    });
    block.append(body);
    paint();
    heat.append(block);
  }

  mountFilteredHeatmap("Leads · Project × Month", leads);
  mountFilteredHeatmap("Visits · Project × Month", visits);
  mountFilteredHeatmap("Booked · Project × Month", booked);
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

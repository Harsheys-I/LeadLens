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
const COLOR_BOOKED_DECL = "#2a6f7a";

/** Excel / internal status keys — keep compatible with sheet parsing. */
const STATUS_DEMAND = "Demand Letter";
const STATUS_CANCEL = "Cancel";

/** User-facing labels (UI only; data keys stay Demand Letter / Cancel). */
const LABEL_SALES_DECLARATION = "Sales Declaration";
const LABEL_BOOKED = "Booked";
const LABEL_CANCELED = "Canceled";

/** Global Metrics filter keys (series / KPI visibility). */
const METRIC_LEADS = "leads";
const METRIC_VISITS = "visits";
const METRIC_SALES_DECLARATION = "salesDeclaration";
const METRIC_BOOKED = "booked";
const METRIC_CANCELED = "canceled";
const ALL_METRICS = [
  METRIC_LEADS,
  METRIC_VISITS,
  METRIC_SALES_DECLARATION,
  METRIC_BOOKED,
  METRIC_CANCELED,
];
const METRIC_LABELS = {
  [METRIC_LEADS]: "Leads",
  [METRIC_VISITS]: "Visits",
  [METRIC_SALES_DECLARATION]: LABEL_SALES_DECLARATION,
  [METRIC_BOOKED]: LABEL_BOOKED,
  [METRIC_CANCELED]: LABEL_CANCELED,
};

const STATUS_DISPLAY_ORDER = [STATUS_DEMAND, STATUS_CANCEL];

const TOP_N = 10;
/** Viewport-friendly hero height (~55–70vh / 480–640px); CSS also clamps with vh. */
const HERO_CHART_HEIGHT = 560;
/** Fixed px width per category group (5 series) so hero bars + value labels stay readable. */
const CATEGORY_WIDTH_PX = 82;

/** Map internal Excel status → UI label. */
function statusDisplayLabel(statusKey) {
  const lower = String(statusKey || "").toLowerCase();
  if (lower === STATUS_DEMAND.toLowerCase()) return LABEL_BOOKED;
  if (lower === STATUS_CANCEL.toLowerCase()) return LABEL_CANCELED;
  return statusKey || "(blank)";
}

/** Stable display order for Demand Letter then Cancel (Booked → Canceled). */
function orderStatusKeys(keys) {
  const list = [...(keys || [])];
  const rank = (k) => {
    const lower = String(k || "").toLowerCase();
    const idx = STATUS_DISPLAY_ORDER.findIndex(s => s.toLowerCase() === lower);
    return idx >= 0 ? idx : STATUS_DISPLAY_ORDER.length;
  };
  return list.sort((a, b) => rank(a) - rank(b) || String(a).localeCompare(String(b)));
}

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

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const ALL_MONTH_KEYS = ["01","02","03","04","05","06","07","08","09","10","11","12"];

function formatMonth(ym) {
  const s = String(ym || "");
  if (!/^\d{6}$/.test(s)) return s;
  const y = s.slice(0, 4);
  const m = Number(s.slice(4, 6));
  return `${MONTH_SHORT[m - 1] || s.slice(4)} ${y}`;
}

function monthKeyLabel(mm) {
  const n = Number(mm);
  return MONTH_SHORT[n - 1] || String(mm);
}

function yearsFromMonths(months) {
  const years = new Set();
  for (const m of months || []) {
    const s = String(m || "");
    if (/^\d{6}$/.test(s)) years.add(s.slice(0, 4));
  }
  return [...years].sort((a, b) => a.localeCompare(b));
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
  // Prefer measured scrollport; fall back to card/parent if not laid out yet.
  let containerW = scrollEl.clientWidth || 0;
  if (!containerW) {
    const parent = scrollEl.parentElement;
    containerW = parent?.clientWidth || 0;
  }
  const width = Math.max(containerW || minW, minW);
  // Only the inner wrap is wider than the scrollport — never stretch the card/page.
  canvasWrap.style.width = `${width}px`;
  canvasWrap.style.minWidth = `${width}px`;
  canvasWrap.style.maxWidth = "none";
  canvasWrap.style.flexShrink = "0";
}

/** Keep horizontal wheel/trackpad/touch scroll inside the chart scrollport. */
function bindScrollContainment(scrollEl) {
  if (!scrollEl || scrollEl.dataset.sgScrollBound === "1") return;
  scrollEl.dataset.sgScrollBound = "1";
  const stopBubble = (e) => {
    e.stopPropagation();
  };
  scrollEl.addEventListener("wheel", (e) => {
    const dx = e.deltaX;
    const dy = e.deltaY;
    const horizontal = Math.abs(dx) > Math.abs(dy) || e.shiftKey;
    if (!horizontal) return;
    const maxScroll = scrollEl.scrollWidth - scrollEl.clientWidth;
    if (maxScroll <= 0) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const delta = e.shiftKey && !dx ? dy : dx;
    const next = Math.max(0, Math.min(maxScroll, scrollEl.scrollLeft + delta));
    if (next !== scrollEl.scrollLeft) scrollEl.scrollLeft = next;
    // Always kill document/shell horizontal pan while gesturing on the chart.
    e.preventDefault();
    e.stopPropagation();
  }, {passive: false});
  scrollEl.addEventListener("touchstart", stopBubble, {passive: true});
  scrollEl.addEventListener("touchmove", (e) => {
    e.stopPropagation();
  }, {passive: true});
  scrollEl.addEventListener("scroll", stopBubble, {passive: true});
}

/**
 * Chart card. Only hero grouped-bars use horizontal scroll + fixed category width.
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
    scrollEl.style.height = `${canvasHeight}px`;
    scrollEl.append(canvasWrap);
    card.append(scrollEl);
    bindScrollContainment(scrollEl);
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
    plugins: config.plugins,
  });
  chartRegistry.set(id, chart);
  return chart;
}

/**
 * Paint locale-formatted values above each hero grouped bar.
 * Skips zeros when the chart is dense; shows zeros when sparse (few categories).
 */
const heroBarValueLabels = {
  id: "sgHeroBarValueLabels",
  afterDatasetsDraw(chart) {
    const {ctx, data} = chart;
    const labels = data.labels || [];
    const datasets = data.datasets || [];
    let totalPts = 0;
    let nonZero = 0;
    for (let di = 0; di < datasets.length; di++) {
      const meta = chart.getDatasetMeta(di);
      if (!meta || meta.hidden) continue;
      const vals = datasets[di].data || [];
      for (let i = 0; i < vals.length; i++) {
        totalPts += 1;
        if ((Number(vals[i]) || 0) !== 0) nonZero += 1;
      }
    }
    // Sparse: few categories or few points overall → show 0s; else skip zeros.
    const sparse = labels.length <= 10 || totalPts <= 32 || nonZero <= 8;
    const skipZeros = !sparse;
    const ink = inkColor();
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    const fill = dark ? "#e8f2ec" : ink;
    const halo = dark ? "rgba(8,18,14,0.85)" : "rgba(255,255,255,0.92)";

    ctx.save();
    ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";

    for (let di = 0; di < datasets.length; di++) {
      const meta = chart.getDatasetMeta(di);
      if (!meta || meta.hidden || !meta.data) continue;
      const vals = datasets[di].data || [];
      for (let i = 0; i < meta.data.length; i++) {
        const raw = Number(vals[i]);
        const value = Number.isFinite(raw) ? raw : 0;
        if (skipZeros && value === 0) continue;
        const el = meta.data[i];
        if (!el || typeof el.x !== "number" || typeof el.y !== "number") continue;
        const text = value.toLocaleString(undefined, {maximumFractionDigits: 1});
        const x = el.x;
        const y = Math.min(el.y, el.base ?? el.y) - 3;
        ctx.strokeStyle = halo;
        ctx.fillStyle = fill;
        ctx.strokeText(text, x, y);
        ctx.fillText(text, x, y);
      }
    }
    ctx.restore();
  },
};

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

function renderKpis(mount, payload, state) {
  mount.replaceChildren();
  const months = payload.months || [];
  const ms = filteredMonths(months, state);
  const leads = payload.leads || {};
  const visits = payload.visits || {};
  const booked = payload.booked || {};

  const leadsTotal = sumSeries(sumSheetByMonths(leads, ms, state));
  const visitsTotal = sumSeries(sumSheetByMonths(visits, ms, state));
  const bookedTotal = sumSeries(sumSheetByMonths(booked, ms, state));
  const demandTotal = sumSeries(bookedStatusByMonths(booked, STATUS_DEMAND, ms, state));
  const cancelTotal = sumSeries(bookedStatusByMonths(booked, STATUS_CANCEL, ms, state));
  const leadDecl = demandTotal + cancelTotal;

  const showL = metricOn(state, METRIC_LEADS);
  const showV = metricOn(state, METRIC_VISITS);
  const showSD = metricOn(state, METRIC_SALES_DECLARATION);
  const showB = metricOn(state, METRIC_BOOKED);
  const showC = metricOn(state, METRIC_CANCELED);
  const showBookedFamily = showSD || showB || showC;

  const items = [];
  if (showL) items.push(["Total Leads", num(leadsTotal)]);
  if (showV) items.push(["Total Visits", num(visitsTotal)]);
  if (showBookedFamily) items.push(["Total Booked", num(bookedTotal)]);
  if (showSD) items.push([LABEL_SALES_DECLARATION, num(leadDecl)]);
  if (showB) items.push([LABEL_BOOKED, num(demandTotal)]);
  if (showC) items.push([LABEL_CANCELED, num(cancelTotal)]);
  if (showL && showV) {
    items.push(["Visits / Leads", leadsTotal > 0 ? pct(visitsTotal / leadsTotal) : "—"]);
  }
  if (showV && showBookedFamily) {
    items.push(["Booked / Visits", visitsTotal > 0 ? pct(bookedTotal / visitsTotal) : "—"]);
  }
  if (showL && showBookedFamily) {
    items.push(["Booked / Leads", leadsTotal > 0 ? pct(bookedTotal / leadsTotal) : "—"]);
  }
  items.push(["Months", String(ms.length)]);
  const projNames = filterDimNames(
    [...new Set(Object.keys(booked.byProject || {}))],
    state,
    "project"
  );
  items.push(["Projects (Booked)", String(projNames.length)]);

  const strip = el("div", "dashboard-kpis sg-kpis");
  if (!state.metrics.size) {
    strip.append(el("p", "dashboard-empty-state", "Select at least one metric."));
  } else {
    for (const [label, value] of items) {
      const kpi = el("div", "dashboard-kpi");
      kpi.append(el("span", null, label), el("strong", null, value));
      strip.append(kpi);
    }
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
    layout: {padding: {top: 16}},
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

/** Element-wise sum of parallel series (e.g. Demand Letter + Cancel → Sales Declaration). */
function zipSum(...seriesList) {
  const len = Math.max(0, ...seriesList.map(s => (s || []).length));
  const out = new Array(len).fill(0);
  for (const series of seriesList) {
    for (let i = 0; i < len; i++) out[i] += Number(series?.[i]) || 0;
  }
  return out;
}

/** Hero datasets: Sales Declaration → Booked → Canceled (UI labels; data keys unchanged). */
function lvbSplitBarDatasets(leadsData, visitsData, demandData, cancelData, declarationData) {
  return [
    {label: "Leads", data: leadsData, backgroundColor: COLOR_LEADS, borderRadius: 4, maxBarThickness: 28, yAxisID: "y"},
    {label: "Visits", data: visitsData, backgroundColor: COLOR_VISITS, borderRadius: 4, maxBarThickness: 28, yAxisID: "y"},
    {label: LABEL_SALES_DECLARATION, data: declarationData, backgroundColor: COLOR_BOOKED_DECL, borderRadius: 4, maxBarThickness: 28, yAxisID: "y1"},
    {label: LABEL_BOOKED, data: demandData, backgroundColor: COLOR_BOOKED_DL, borderRadius: 4, maxBarThickness: 28, yAxisID: "y1"},
    {label: LABEL_CANCELED, data: cancelData, backgroundColor: COLOR_BOOKED_CANCEL, borderRadius: 4, maxBarThickness: 28, yAxisID: "y1"},
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
  const statuses = orderStatusKeys(Object.keys(booked.byStatus || {}));
  return {projects, sources, statuses};
}

function cloneFilterState(state) {
  return {
    projects: new Set(state.projects),
    sources: new Set(state.sources),
    statuses: new Set(state.statuses),
    years: new Set(state.years),
    monthsOfYear: new Set(state.monthsOfYear),
    metrics: new Set(state.metrics),
  };
}

function makeFilterState(dims, months) {
  return {
    projects: new Set(dims.projects),
    sources: new Set(dims.sources),
    // Booked/Canceled visibility is driven by Metrics; keep all statuses in data filters.
    statuses: new Set(dims.statuses.length ? dims.statuses : [STATUS_DEMAND, STATUS_CANCEL]),
    years: new Set(yearsFromMonths(months)),
    monthsOfYear: new Set(ALL_MONTH_KEYS),
    metrics: new Set(ALL_METRICS),
  };
}

function metricOn(state, key) {
  return !state.metrics.size || state.metrics.has(key);
}

function metricKeyForLabel(label) {
  const s = String(label || "");
  if (s === "Leads") return METRIC_LEADS;
  if (s === "Visits") return METRIC_VISITS;
  if (s === LABEL_SALES_DECLARATION) return METRIC_SALES_DECLARATION;
  if (s === LABEL_BOOKED || s === STATUS_DEMAND) return METRIC_BOOKED;
  if (s === LABEL_CANCELED || s === STATUS_CANCEL) return METRIC_CANCELED;
  return null;
}

function filterDatasetsByMetrics(datasets, state) {
  return (datasets || []).filter(ds => {
    const key = metricKeyForLabel(ds.label);
    return !key || metricOn(state, key);
  });
}

function sumSeries(arr) {
  return (arr || []).reduce((a, b) => a + (Number(b) || 0), 0);
}

function filteredMonths(months, state) {
  const years = state.years;
  const mos = state.monthsOfYear;
  return (months || []).filter(m => {
    const s = String(m || "");
    if (!/^\d{6}$/.test(s)) return true;
    const y = s.slice(0, 4);
    const mo = s.slice(4, 6);
    const yearOk = !years.size || years.has(y);
    const monthOk = !mos.size || mos.has(mo);
    return yearOk && monthOk;
  });
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
  if (kind === "project") {
    if (!selected.projects.size) return names;
    return names.filter(n => selected.projects.has(n));
  }
  if (kind === "source") {
    if (!selected.sources.size) return names;
    return names.filter(n => selected.sources.has(n));
  }
  return names;
}

/**
 * Shared multi-checkbox slicer control.
 * @param {object} opts
 * @param {number} [opts.minSelected=0] — refuse to clear below this many
 */
function multiSlicer(label, allValues, selectedSet, {
  displayFn = null,
  onChange,
  minSelected = 0,
} = {}) {
  const details = el("details", "sg-slicer");
  const summary = el("summary", "sg-slicer-summary");
  const updateSummary = () => {
    const n = selectedSet.size;
    const total = allValues.length;
    summary.textContent = n >= total && total > 0 ? `${label}: All` : `${label}: ${n}/${total}`;
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
    if (minSelected > 0) {
      const keep = allValues.slice(0, minSelected);
      selectedSet.clear();
      keep.forEach(v => selectedSet.add(v));
      panel.querySelectorAll("input[type=checkbox]").forEach(cb => {
        cb.checked = selectedSet.has(cb.dataset.value);
      });
    } else {
      selectedSet.clear();
      panel.querySelectorAll("input[type=checkbox]").forEach(cb => { cb.checked = false; });
    }
    updateSummary();
    onChange();
  });
  actions.append(btnAll, btnNone);
  panel.append(actions);
  for (const value of allValues) {
    const row = el("label", "sg-slicer-option");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.dataset.value = String(value);
    cb.checked = selectedSet.has(value);
    cb.addEventListener("change", () => {
      if (cb.checked) {
        selectedSet.add(value);
      } else {
        if (minSelected && selectedSet.size <= minSelected) {
          cb.checked = true;
          return;
        }
        selectedSet.delete(value);
      }
      updateSummary();
      onChange();
    });
    const shown = displayFn ? displayFn(value) : value;
    row.append(cb, document.createTextNode(shown || "(blank)"));
    panel.append(row);
  }
  details.append(panel);
  return details;
}

/**
 * One sticky global filter bar for the whole dashboard / preview.
 */
function mountGlobalFilterBar(mount, {months, dims, state, onChange}) {
  const bar = el("div", "sg-global-filters sg-slicer-bar");
  const label = el("div", "sg-global-filters-label", "Filters");
  bar.append(label);

  if (dims.projects.length) {
    bar.append(multiSlicer("Project", dims.projects, state.projects, {onChange}));
  }
  if (dims.sources.length) {
    bar.append(multiSlicer("Source Name", dims.sources, state.sources, {onChange}));
  }
  const yearOpts = yearsFromMonths(months);
  if (yearOpts.length) {
    bar.append(multiSlicer("Year", yearOpts, state.years, {onChange}));
  }
  bar.append(multiSlicer("Month", ALL_MONTH_KEYS, state.monthsOfYear, {
    displayFn: monthKeyLabel,
    onChange,
  }));
  bar.append(multiSlicer("Metrics", ALL_METRICS, state.metrics, {
    displayFn: k => METRIC_LABELS[k] || k,
    onChange,
    minSelected: 1,
  }));

  // Close other open slicers when one opens (cleaner sticky bar).
  bar.addEventListener("toggle", e => {
    const t = e.target;
    if (!(t instanceof HTMLDetailsElement) || !t.open) return;
    bar.querySelectorAll("details.sg-slicer[open]").forEach(d => {
      if (d !== t) d.open = false;
    });
  }, true);

  mount.append(bar);
  return bar;
}

function mountHeroDualAxis(grid, id, title, getData, {state, register}) {
  const {card, canvas, setCategoryCount} = chartCard(title, HERO_CHART_HEIGHT, {
    extraClass: "sg-chart-card--hero",
    scrollable: true,
    categoryWidth: CATEGORY_WIDTH_PX,
  });
  grid.append(card);

  const paint = () => {
    const {labels, datasets} = getData(state);
    const visible = filterDatasetsByMetrics(datasets, state);
    setCategoryCount(labels.length);
    if (!visible.length) {
      registerChart(id, {
        canvas,
        type: "bar",
        data: {labels, datasets: []},
        options: dualAxisOptions(),
      });
      return;
    }
    registerChart(id, {
      canvas,
      type: "bar",
      data: {labels, datasets: visible},
      options: dualAxisOptions(),
      plugins: [heroBarValueLabels],
    });
  };
  register(paint);
  paint();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const {labels} = getData(state);
      setCategoryCount(labels.length);
      const chart = chartRegistry.get(id);
      try { chart?.resize(); } catch { /* ignore */ }
    });
  });
}

function mountDoughnut(grid, id, title, getData, {state, register, metricKey = null, requireAnyMetrics = null}) {
  const {card, canvas} = chartCard(title, 280);
  grid.append(card);
  const paint = () => {
    if (metricKey && !metricOn(state, metricKey)) {
      card.classList.add("hidden");
      const existing = chartRegistry.get(id);
      if (existing) {
        try { existing.destroy(); } catch { /* ignore */ }
        chartRegistry.delete(id);
      }
      return;
    }
    if (requireAnyMetrics?.length && !requireAnyMetrics.some(k => metricOn(state, k))) {
      card.classList.add("hidden");
      const existing = chartRegistry.get(id);
      if (existing) {
        try { existing.destroy(); } catch { /* ignore */ }
        chartRegistry.delete(id);
      }
      return;
    }
    card.classList.remove("hidden");
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
  register(paint);
  paint();
}

function mountStackedBar(grid, id, title, getData, {state, register, requireAnyMetrics = null}) {
  const {card, canvas} = chartCard(title, 300);
  grid.append(card);
  const paint = () => {
    if (requireAnyMetrics?.length && !requireAnyMetrics.some(k => metricOn(state, k))) {
      card.classList.add("hidden");
      const existing = chartRegistry.get(id);
      if (existing) {
        try { existing.destroy(); } catch { /* ignore */ }
        chartRegistry.delete(id);
      }
      return;
    }
    card.classList.remove("hidden");
    const {labels, datasets} = getData(state);
    registerChart(id, {
      canvas,
      type: "bar",
      data: {labels, datasets},
      options: baseOptions({stacked: true}),
    });
  };
  register(paint);
  paint();
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

function renderChartsGallery(mount, payload, state, register) {
  const months = payload.months || [];
  const leads = payload.leads || {};
  const visits = payload.visits || {};
  const booked = payload.booked || {};

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

  const chartOpts = {state, register};

  // —— Trends ——
  const trends = makeSection("Trends", "Monthly volume (Leads → Visits → Booked by status)");
  const trendsGrid = el("div", "dashboard-charts sg-chart-grid");
  mountHeroDualAxis(
    trendsGrid, "sg-bar-month",
    "Leads vs Visits vs Booked by month",
    (st) => {
      const ms = filteredMonths(months, st);
      const demand = bookedStatusByMonths(booked, STATUS_DEMAND, ms, st);
      const cancel = bookedStatusByMonths(booked, STATUS_CANCEL, ms, st);
      return {
        labels: ms.map(formatMonth),
        datasets: lvbSplitBarDatasets(
          sumSheetByMonths(leads, ms, st),
          sumSheetByMonths(visits, ms, st),
          demand,
          cancel,
          zipSum(demand, cancel)
        ),
      };
    },
    chartOpts
  );
  trends.append(trendsGrid);
  mount.append(trends);

  // —— Project comparison ——
  const projects = makeSection("By project", "Grouped bars (all projects) and share of volume");
  const projGrid = el("div", "dashboard-charts sg-chart-grid");
  mountHeroDualAxis(
    projGrid, "sg-bar-project",
    "Leads vs Visits vs Booked by project",
    (st) => {
      const ms = filteredMonths(months, st);
      const names = filterDimNames(projectKeys, st, "project");
      const demand = bookedStatusByDim(booked, STATUS_DEMAND, names, "project", ms, st);
      const cancel = bookedStatusByDim(booked, STATUS_CANCEL, names, "project", ms, st);
      return {
        labels: names,
        datasets: lvbSplitBarDatasets(
          sumSheetByDim(leads, names, "project", ms, st),
          sumSheetByDim(visits, names, "project", ms, st),
          demand,
          cancel,
          zipSum(demand, cancel)
        ),
      };
    },
    chartOpts
  );
  mountDoughnut(
    projGrid, "sg-pie-leads-project",
    "Leads share by project",
    (st) => {
      const ms = filteredMonths(months, st);
      const names = filterDimNames(projectKeys, st, "project").slice(0, TOP_N);
      return {labels: names, values: sumSheetByDim(leads, names, "project", ms, st)};
    },
    {...chartOpts, metricKey: METRIC_LEADS}
  );
  mountDoughnut(
    projGrid, "sg-pie-visits-project",
    "Visits share by project",
    (st) => {
      const ms = filteredMonths(months, st);
      const names = filterDimNames(projectKeys, st, "project").slice(0, TOP_N);
      return {labels: names, values: sumSheetByDim(visits, names, "project", ms, st)};
    },
    {...chartOpts, metricKey: METRIC_VISITS}
  );
  mountDoughnut(
    projGrid, "sg-pie-booked-project",
    "Booked share by project",
    (st) => {
      const ms = filteredMonths(months, st);
      const names = filterDimNames(projectKeys, st, "project").slice(0, TOP_N);
      return {
        labels: names,
        values: sumSheetByDim(booked, names, "project", ms, st, {ignoreStatus: false}),
      };
    },
    {...chartOpts, metricKey: METRIC_BOOKED}
  );
  projects.append(projGrid);
  mount.append(projects);

  // —— Source Name ——
  const sources = makeSection("By source name", "Normalized Meta source names · all partners/campaigns");
  const srcGrid = el("div", "dashboard-charts sg-chart-grid");
  mountHeroDualAxis(
    srcGrid, "sg-bar-source",
    "Leads vs Visits vs Booked by source name",
    (st) => {
      const ms = filteredMonths(months, st);
      const names = filterDimNames(sourceKeys, st, "source");
      const demand = bookedStatusByDim(booked, STATUS_DEMAND, names, "source", ms, st);
      const cancel = bookedStatusByDim(booked, STATUS_CANCEL, names, "source", ms, st);
      return {
        labels: names,
        datasets: lvbSplitBarDatasets(
          sumSheetByDim(leads, names, "source", ms, st),
          sumSheetByDim(visits, names, "source", ms, st),
          demand,
          cancel,
          zipSum(demand, cancel)
        ),
      };
    },
    chartOpts
  );
  mountDoughnut(
    srcGrid, "sg-pie-leads-source",
    "Leads share by source name",
    (st) => {
      const ms = filteredMonths(months, st);
      const names = filterDimNames(sourceKeys, st, "source").slice(0, TOP_N);
      return {labels: names, values: sumSheetByDim(leads, names, "source", ms, st)};
    },
    {...chartOpts, metricKey: METRIC_LEADS}
  );
  mountDoughnut(
    srcGrid, "sg-pie-visits-source",
    "Visits share by source name",
    (st) => {
      const ms = filteredMonths(months, st);
      const names = filterDimNames(sourceKeys, st, "source").slice(0, TOP_N);
      return {labels: names, values: sumSheetByDim(visits, names, "source", ms, st)};
    },
    {...chartOpts, metricKey: METRIC_VISITS}
  );
  mountDoughnut(
    srcGrid, "sg-pie-booked-source",
    "Booked share by source name",
    (st) => {
      const ms = filteredMonths(months, st);
      const names = filterDimNames(sourceKeys, st, "source").slice(0, TOP_N);
      return {labels: names, values: sumSheetByDim(booked, names, "source", ms, st)};
    },
    {...chartOpts, metricKey: METRIC_BOOKED}
  );
  sources.append(srcGrid);
  mount.append(sources);

  // —— Booked status ——
  if (booked.byStatus && Object.keys(booked.byStatus).length) {
    const statusKeys = orderStatusKeys(Object.keys(booked.byStatus));
    const statusSec = makeSection(
      "Booked by status",
      `${LABEL_SALES_DECLARATION} (= ${LABEL_BOOKED} + ${LABEL_CANCELED}), ${LABEL_BOOKED}, ${LABEL_CANCELED}`
    );
    const statusGrid = el("div", "dashboard-charts sg-chart-grid");
    const statusMetricGate = [METRIC_BOOKED, METRIC_CANCELED, METRIC_SALES_DECLARATION];

    function statusKeysForMetrics(st) {
      return statusKeys.filter(s => {
        const key = metricKeyForLabel(s) || metricKeyForLabel(statusDisplayLabel(s));
        return !key || metricOn(st, key);
      });
    }

    mountDoughnut(
      statusGrid, "sg-pie-booked-status",
      "Booked share by status",
      (st) => {
        const ms = filteredMonths(months, st);
        const names = statusKeysForMetrics(st);
        const values = names.map(name => {
          const local = cloneFilterState(st);
          local.statuses = new Set([name]);
          return sumSeries(sumSheetByMonths(booked, ms, local));
        });
        return {labels: names.map(statusDisplayLabel), values};
      },
      {...chartOpts, requireAnyMetrics: statusMetricGate}
    );

    mountStackedBar(
      statusGrid, "sg-stack-booked-status-month",
      "Booked · status stacked by month",
      (st) => {
        const ms = filteredMonths(months, st);
        const names = statusKeysForMetrics(st);
        return {
          labels: ms.map(formatMonth),
          datasets: names.map((name, i) => {
            const local = cloneFilterState(st);
            local.statuses = new Set([name]);
            return {
              label: statusDisplayLabel(name),
              data: sumSheetByMonths(booked, ms, local),
              backgroundColor: PALETTE[i % PALETTE.length],
              borderWidth: 0,
              maxBarThickness: 40,
            };
          }),
        };
      },
      {...chartOpts, requireAnyMetrics: statusMetricGate}
    );
    statusSec.append(statusGrid);
    mount.append(statusSec);
    register(() => {
      const on = statusMetricGate.some(k => metricOn(state, k));
      statusSec.classList.toggle("hidden", !on);
    });
  }

  // —— Heatmaps ——
  const heat = makeSection("Heatmaps", "Project × Month intensity (Leads, Visits, Booked)");
  const heatProjectsAll = projectKeys.slice(0, 20);

  function mountFilteredHeatmap(sheetTitle, sheet, metricKey) {
    const block = el("div", "sg-heatmap-block");
    block.append(el("h4", null, sheetTitle));
    const body = el("div", "sg-heatmap-body");

    const paint = () => {
      if (!metricOn(state, metricKey)) {
        block.classList.add("hidden");
        return;
      }
      block.classList.remove("hidden");
      const ms = filteredMonths(months, state);
      const projs = heatProjectsAll.filter(p => !state.projects.size || state.projects.has(p));
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

    block.append(body);
    register(paint);
    paint();
    heat.append(block);
  }

  mountFilteredHeatmap("Leads · Project × Month", leads, METRIC_LEADS);
  mountFilteredHeatmap("Visits · Project × Month", visits, METRIC_VISITS);
  mountFilteredHeatmap("Booked · Project × Month", booked, METRIC_BOOKED);
  mount.append(heat);
  register(() => {
    const any = [METRIC_LEADS, METRIC_VISITS, METRIC_BOOKED].some(k => metricOn(state, k));
    heat.classList.toggle("hidden", !any);
  });
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

function statusMonthVal(booked, statusLabel, m) {
  const key = findStatusKey(booked?.byStatus, statusLabel);
  return Number(booked?.byStatus?.[key]?.byMonth?.[m] || 0);
}

function statusDimTotal(booked, statusLabel, dimKind, name) {
  const key = findStatusKey(booked?.byStatus, statusLabel);
  const nested = dimKind === "project"
    ? booked?.byStatus?.[key]?.byProject
    : booked?.byStatus?.[key]?.bySource;
  return bucketTotal(nested?.[name]);
}

function leadDeclarationMonthVal(booked, m) {
  if (booked?.leadDeclaration?.byMonth?.[m] != null) {
    return Number(booked.leadDeclaration.byMonth[m]) || 0;
  }
  return statusMonthVal(booked, STATUS_DEMAND, m) + statusMonthVal(booked, STATUS_CANCEL, m);
}

function leadDeclarationDimTotal(booked, dimKind, name) {
  const nested = dimKind === "project"
    ? booked?.leadDeclaration?.byProject
    : booked?.leadDeclaration?.bySource;
  if (nested?.[name]) return bucketTotal(nested[name]);
  return statusDimTotal(booked, STATUS_DEMAND, dimKind, name)
    + statusDimTotal(booked, STATUS_CANCEL, dimKind, name);
}

function renderTables(mount, payload, state) {
  mount.replaceChildren();
  const section = makeSection("Tables", "Sortable breakdowns by month, project, source name, and status");
  const tabs = el("div", "sg-table-tabs", null);
  const panels = el("div", "sg-table-panels");
  const monthsAll = payload.months || [];
  const months = filteredMonths(monthsAll, state);
  const leads = payload.leads || {};
  const visits = payload.visits || {};
  const booked = payload.booked || {};

  const showL = metricOn(state, METRIC_LEADS);
  const showV = metricOn(state, METRIC_VISITS);
  const showSD = metricOn(state, METRIC_SALES_DECLARATION);
  const showB = metricOn(state, METRIC_BOOKED);
  const showC = metricOn(state, METRIC_CANCELED);
  const showBookedFamily = showSD || showB || showC;

  const tabDefs = [
    {
      id: "month",
      label: "By Month",
      build() {
        const headers = ["Month"];
        const numericCols = new Set();
        let col = 1;
        if (showL) { headers.push("Leads"); numericCols.add(col++); }
        if (showV) { headers.push("Visits"); numericCols.add(col++); }
        if (showBookedFamily) { headers.push("Booked"); numericCols.add(col++); }
        if (showSD) { headers.push(LABEL_SALES_DECLARATION); numericCols.add(col++); }
        if (showB) { headers.push(LABEL_BOOKED); numericCols.add(col++); }
        if (showC) { headers.push(LABEL_CANCELED); numericCols.add(col++); }
        if (showL && showV) { headers.push("V/L %"); numericCols.add(col++); }
        if (showV && showBookedFamily) { headers.push("B/V %"); numericCols.add(col++); }
        if (showL && showBookedFamily) { headers.push("B/L %"); numericCols.add(col++); }

        const rows = months.map(m => {
          const L = sumSeries(sumSheetByMonths(leads, [m], state));
          const V = sumSeries(sumSheetByMonths(visits, [m], state));
          const B = sumSeries(sumSheetByMonths(booked, [m], state));
          const DL = sumSeries(bookedStatusByMonths(booked, STATUS_DEMAND, [m], state));
          const CX = sumSeries(bookedStatusByMonths(booked, STATUS_CANCEL, [m], state));
          const LD = DL + CX;
          const row = [formatMonth(m)];
          if (showL) row.push(L);
          if (showV) row.push(V);
          if (showBookedFamily) row.push(B);
          if (showSD) row.push(LD);
          if (showB) row.push(DL);
          if (showC) row.push(CX);
          if (showL && showV) row.push(Number(((L > 0 ? V / L : 0) * 100).toFixed(2)));
          if (showV && showBookedFamily) row.push(Number(((V > 0 ? B / V : 0) * 100).toFixed(2)));
          if (showL && showBookedFamily) row.push(Number(((L > 0 ? B / L : 0) * 100).toFixed(2)));
          return row;
        });
        return sortableTable(headers, rows, {numericCols});
      },
    },
    {
      id: "project",
      label: "By Project",
      build() {
        const names = filterDimNames([...new Set([
          ...Object.keys(leads.byProject || {}),
          ...Object.keys(visits.byProject || {}),
          ...Object.keys(booked.byProject || {}),
        ])].sort(), state, "project");
        const headers = ["Project"];
        const numericCols = new Set();
        let col = 1;
        if (showL) { headers.push("Leads"); numericCols.add(col++); }
        if (showV) { headers.push("Visits"); numericCols.add(col++); }
        if (showBookedFamily) { headers.push("Booked"); numericCols.add(col++); }
        if (showSD) { headers.push(LABEL_SALES_DECLARATION); numericCols.add(col++); }
        if (showB) { headers.push(LABEL_BOOKED); numericCols.add(col++); }
        if (showC) { headers.push(LABEL_CANCELED); numericCols.add(col++); }
        const rows = names.map(n => {
          const row = [n];
          if (showL) row.push(sumSeries(sumSheetByDim(leads, [n], "project", months, state)));
          if (showV) row.push(sumSeries(sumSheetByDim(visits, [n], "project", months, state)));
          if (showBookedFamily) row.push(sumSeries(sumSheetByDim(booked, [n], "project", months, state)));
          if (showSD) {
            row.push(
              sumSeries(bookedStatusByDim(booked, STATUS_DEMAND, [n], "project", months, state))
              + sumSeries(bookedStatusByDim(booked, STATUS_CANCEL, [n], "project", months, state))
            );
          }
          if (showB) row.push(sumSeries(bookedStatusByDim(booked, STATUS_DEMAND, [n], "project", months, state)));
          if (showC) row.push(sumSeries(bookedStatusByDim(booked, STATUS_CANCEL, [n], "project", months, state)));
          return row;
        });
        return sortableTable(headers, rows, {numericCols});
      },
    },
    {
      id: "source",
      label: "By Source Name",
      build() {
        const names = filterDimNames([...new Set([
          ...Object.keys(leads.bySource || {}),
          ...Object.keys(visits.bySource || {}),
          ...Object.keys(booked.bySource || {}),
        ])].sort(), state, "source");
        const headers = ["Source Name"];
        const numericCols = new Set();
        let col = 1;
        if (showL) { headers.push("Leads"); numericCols.add(col++); }
        if (showV) { headers.push("Visits"); numericCols.add(col++); }
        if (showBookedFamily) { headers.push("Booked"); numericCols.add(col++); }
        if (showSD) { headers.push(LABEL_SALES_DECLARATION); numericCols.add(col++); }
        if (showB) { headers.push(LABEL_BOOKED); numericCols.add(col++); }
        if (showC) { headers.push(LABEL_CANCELED); numericCols.add(col++); }
        const rows = names.map(n => {
          const row = [n];
          if (showL) row.push(sumSeries(sumSheetByDim(leads, [n], "source", months, state)));
          if (showV) row.push(sumSeries(sumSheetByDim(visits, [n], "source", months, state)));
          if (showBookedFamily) row.push(sumSeries(sumSheetByDim(booked, [n], "source", months, state)));
          if (showSD) {
            row.push(
              sumSeries(bookedStatusByDim(booked, STATUS_DEMAND, [n], "source", months, state))
              + sumSeries(bookedStatusByDim(booked, STATUS_CANCEL, [n], "source", months, state))
            );
          }
          if (showB) row.push(sumSeries(bookedStatusByDim(booked, STATUS_DEMAND, [n], "source", months, state)));
          if (showC) row.push(sumSeries(bookedStatusByDim(booked, STATUS_CANCEL, [n], "source", months, state)));
          return row;
        });
        return sortableTable(headers, rows, {numericCols});
      },
    },
    {
      id: "status",
      label: "By Status",
      build() {
        const names = orderStatusKeys(Object.keys(booked.byStatus || {})).filter(s => {
          const key = metricKeyForLabel(s) || metricKeyForLabel(statusDisplayLabel(s));
          return !key || metricOn(state, key);
        });
        const rows = [];
        if (showSD) {
          const ld = sumSeries(bookedStatusByMonths(booked, STATUS_DEMAND, months, state))
            + sumSeries(bookedStatusByMonths(booked, STATUS_CANCEL, months, state));
          rows.push([LABEL_SALES_DECLARATION, ld]);
        }
        for (const n of names) {
          const local = cloneFilterState(state);
          local.statuses = new Set([n]);
          rows.push([statusDisplayLabel(n), sumSeries(sumSheetByMonths(booked, months, local))]);
        }
        return sortableTable(["Status", "Booked"], rows, {numericCols: new Set([1])});
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

  const months = payload.months || [];
  const dims = collectDimKeys(payload);
  const state = makeFilterState(dims, months);
  const painters = [];
  const register = (fn) => { painters.push(fn); };
  const onChange = () => {
    for (const paint of painters) {
      try { paint(); } catch { /* keep other painters alive */ }
    }
  };

  mountGlobalFilterBar(mount, {months, dims, state, onChange});

  const kpiHost = el("div", "sg-kpi-host");
  mount.append(kpiHost);
  register(() => renderKpis(kpiHost, payload, state));

  const galleryHost = el("div", "sg-gallery-host");
  mount.append(galleryHost);
  try {
    renderChartsGallery(galleryHost, payload, state, register);
  } catch (err) {
    galleryHost.append(el("div", "validation error", err.message || "Chart render failed."));
  }

  const tablesHost = el("div", "sg-tables-host");
  mount.append(tablesHost);
  register(() => renderTables(tablesHost, payload, state));

  onChange();
}

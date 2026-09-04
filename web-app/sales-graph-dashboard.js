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

const TOP_N = 10;

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

function conversionSeries(leadsSheet, visitsSheet, months) {
  const L = monthSeries(leadsSheet, months);
  const V = monthSeries(visitsSheet, months);
  return months.map((_, i) => (L[i] > 0 ? V[i] / L[i] : 0));
}

function momChange(series) {
  return series.map((v, i) => {
    if (i === 0) return null;
    const prev = series[i - 1];
    if (!prev) return null;
    return (v - prev) / prev;
  });
}

function makeSection(title, subtitle) {
  const section = el("section", "sg-section");
  const head = el("div", "sg-section-head");
  head.append(el("h3", null, title));
  if (subtitle) head.append(el("p", "sg-section-sub", subtitle));
  section.append(head);
  return section;
}

function chartCard(title, canvasHeight = 260) {
  const card = el("div", "dashboard-chart-card sg-chart-card");
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
  const rate = leads.grand > 0 ? visits.grand / leads.grand : null;
  const strip = el("div", "dashboard-kpis sg-kpis");
  const items = [
    ["Total Leads", num(leads.grand)],
    ["Total Visits", num(visits.grand)],
    ["Visits / Leads", rate == null ? "—" : pct(rate)],
    ["Months", String((payload.months || []).length)],
    ["Projects (Leads)", String(Object.keys(payload.leads?.byProject || {}).length)],
    ["Sources (Leads)", String(Object.keys(payload.leads?.bySource || {}).length)],
  ];
  for (const [label, value] of items) {
    const kpi = el("div", "dashboard-kpi");
    kpi.append(el("span", null, label), el("strong", null, value));
    strip.append(kpi);
  }
  const booked = el("div", "dashboard-kpi sg-kpi-disabled");
  booked.append(el("span", null, "Booked"), el("strong", null, "Pending"));
  booked.title = "Booked format pending";
  strip.append(booked);
  mount.append(strip);

  const callout = el("div", "sg-booked-callout", "Booked Excel format is pending — Booked charts stay hidden until the layout arrives.");
  mount.append(callout);
}

function addGroupedBar(grid, id, title, labels, leadsData, visitsData) {
  const {card, canvas} = chartCard(title);
  grid.append(card);
  registerChart(id, {
    canvas,
    type: "bar",
    data: {
      labels,
      datasets: [
        {label: "Leads", data: leadsData, backgroundColor: "#1f5d45", borderRadius: 4, maxBarThickness: 36},
        {label: "Visits", data: visitsData, backgroundColor: "#c4a35a", borderRadius: 4, maxBarThickness: 36},
      ],
    },
    options: baseOptions(),
  });
}

function addLineChart(grid, id, title, labels, datasets, opts = {}) {
  const {card, canvas} = chartCard(title);
  grid.append(card);
  registerChart(id, {
    canvas,
    type: "line",
    data: {labels, datasets},
    options: baseOptions(opts),
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

function addHorizontalBar(grid, id, title, labels, values, color = "#1f5d45") {
  const {card, canvas} = chartCard(title);
  grid.append(card);
  registerChart(id, {
    canvas,
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: title,
        data: values,
        backgroundColor: color,
        borderRadius: 4,
        maxBarThickness: 28,
      }],
    },
    options: {
      ...baseOptions({indexAxis: "y"}),
      plugins: {
        ...baseOptions().plugins,
        legend: {display: false},
      },
    },
  });
}

function heatmapColor(t) {
  // t 0..1 → soft mint → deep green
  const r = Math.round(232 - t * 180);
  const g = Math.round(240 - t * 90);
  const b = Math.round(228 - t * 140);
  return `rgb(${r},${g},${b})`;
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
      const t = v / denom;
      td.style.background = heatmapColor(t);
      td.style.color = t > 0.55 ? "#fff" : inkColor();
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

function stackedSourceDatasets(sheet, months, topSources) {
  const bySource = sheet?.bySource || {};
  return topSources.map((name, i) => {
    const bucket = bySource[name] || {};
    const byMonth = bucket.byMonth || {};
    return {
      label: name,
      data: months.map(m => Number(byMonth[m] || 0)),
      backgroundColor: PALETTE[i % PALETTE.length],
      borderWidth: 0,
      maxBarThickness: 40,
    };
  });
}

function renderChartsGallery(mount, payload) {
  const months = payload.months || [];
  const monthLabels = months.map(formatMonth);
  const leads = payload.leads || {};
  const visits = payload.visits || {};

  // —— Trends ——
  const trends = makeSection("Trends", "Monthly volume and conversion");
  const trendsGrid = el("div", "dashboard-charts sg-chart-grid");
  addGroupedBar(
    trendsGrid, "sg-bar-month",
    "Leads vs Visits by month",
    monthLabels,
    monthSeries(leads, months),
    monthSeries(visits, months)
  );
  addLineChart(trendsGrid, "sg-line-volume", "Monthly Leads & Visits", monthLabels, [
    {
      label: "Leads",
      data: monthSeries(leads, months),
      borderColor: "#1f5d45",
      backgroundColor: "rgba(31,93,69,0.12)",
      fill: true,
      tension: 0.25,
      pointRadius: 3,
    },
    {
      label: "Visits",
      data: monthSeries(visits, months),
      borderColor: "#c4a35a",
      backgroundColor: "rgba(196,163,90,0.12)",
      fill: true,
      tension: 0.25,
      pointRadius: 3,
    },
  ]);
  const conv = conversionSeries(leads, visits, months);
  addLineChart(trendsGrid, "sg-line-conv", "Conversion rate (Visits / Leads)", monthLabels, [
    {
      label: "Visits/Leads",
      data: conv.map(v => +(v * 100).toFixed(2)),
      borderColor: "#5b7c99",
      backgroundColor: "rgba(91,124,153,0.15)",
      fill: true,
      tension: 0.25,
      pointRadius: 3,
    },
  ], {
    yTickCallback: v => `${v}%`,
  });
  const leadsMom = momChange(monthSeries(leads, months));
  const visitsMom = momChange(monthSeries(visits, months));
  addLineChart(trendsGrid, "sg-line-mom", "Month-over-month change %", monthLabels, [
    {
      label: "Leads MoM %",
      data: leadsMom.map(v => (v == null ? null : +(v * 100).toFixed(1))),
      borderColor: "#1f5d45",
      tension: 0.2,
      spanGaps: false,
      pointRadius: 3,
    },
    {
      label: "Visits MoM %",
      data: visitsMom.map(v => (v == null ? null : +(v * 100).toFixed(1))),
      borderColor: "#c4a35a",
      tension: 0.2,
      spanGaps: false,
      pointRadius: 3,
    },
  ], {yTickCallback: v => `${v}%`});
  trends.append(trendsGrid);
  mount.append(trends);

  // —— Project comparison ——
  const projectKeys = [...new Set([
    ...sortedKeysByTotal(leads.byProject),
    ...sortedKeysByTotal(visits.byProject),
  ])].sort((a, b) => {
    const la = bucketTotal(leads.byProject?.[a]);
    const lb = bucketTotal(leads.byProject?.[b]);
    return lb - la || a.localeCompare(b);
  });
  const topProjects = projectKeys.slice(0, TOP_N);
  const projects = makeSection("By project", "Grouped bars and share of volume");
  const projGrid = el("div", "dashboard-charts sg-chart-grid");
  addGroupedBar(
    projGrid, "sg-bar-project",
    `Leads vs Visits by project (top ${topProjects.length})`,
    topProjects,
    topProjects.map(p => bucketTotal(leads.byProject?.[p])),
    topProjects.map(p => bucketTotal(visits.byProject?.[p]))
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
  projects.append(projGrid);
  mount.append(projects);

  // —— Source ——
  const sourceKeys = [...new Set([
    ...sortedKeysByTotal(leads.bySource),
    ...sortedKeysByTotal(visits.bySource),
  ])].sort((a, b) => {
    const la = bucketTotal(leads.bySource?.[a]);
    const lb = bucketTotal(leads.bySource?.[b]);
    return lb - la || a.localeCompare(b);
  });
  const topSources = sourceKeys.slice(0, TOP_N);
  const sources = makeSection("By source", "Normalized Meta sources · top N");
  const srcGrid = el("div", "dashboard-charts sg-chart-grid");
  addGroupedBar(
    srcGrid, "sg-bar-source",
    `Leads vs Visits by source (top ${topSources.length})`,
    topSources,
    topSources.map(s => bucketTotal(leads.bySource?.[s])),
    topSources.map(s => bucketTotal(visits.bySource?.[s]))
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
  addHorizontalBar(
    srcGrid, "sg-top-leads-source",
    "Top sources · Leads",
    topSources,
    topSources.map(s => bucketTotal(leads.bySource?.[s])),
    "#1f5d45"
  );
  addHorizontalBar(
    srcGrid, "sg-top-visits-source",
    "Top sources · Visits",
    topSources,
    topSources.map(s => bucketTotal(visits.bySource?.[s])),
    "#c4a35a"
  );
  sources.append(srcGrid);
  mount.append(sources);

  // —— Stacked ——
  const stacked = makeSection("Stacked composition", "Sources stacked by month; Leads/Visits stacked");
  const stackGrid = el("div", "dashboard-charts sg-chart-grid");
  const stackSources = sortedKeysByTotal(leads.bySource, 8);
  addStackedBar(
    stackGrid, "sg-stack-leads-src-month",
    "Leads · sources stacked by month",
    monthLabels,
    stackedSourceDatasets(leads, months, stackSources)
  );
  const stackVisitSources = sortedKeysByTotal(visits.bySource, 8);
  addStackedBar(
    stackGrid, "sg-stack-visits-src-month",
    "Visits · sources stacked by month",
    monthLabels,
    stackedSourceDatasets(visits, months, stackVisitSources)
  );
  addStackedBar(
    stackGrid, "sg-stack-lv-month",
    "Leads + Visits stacked by month",
    monthLabels,
    [
      {
        label: "Leads",
        data: monthSeries(leads, months),
        backgroundColor: "#1f5d45",
        borderWidth: 0,
        maxBarThickness: 40,
      },
      {
        label: "Visits",
        data: monthSeries(visits, months),
        backgroundColor: "#c4a35a",
        borderWidth: 0,
        maxBarThickness: 40,
      },
    ]
  );
  // Sources stacked by project (top projects × top sources) for Leads
  const stackProj = topProjects.slice(0, 8);
  const stackSrcForProj = stackSources.slice(0, 6);
  const projStackDatasets = stackSrcForProj.map((src, i) => ({
    label: src,
    data: stackProj.map(p => {
      // approximate: sum month values for rows matching project+source from detail if needed
      // Use bySource doesn't have project split — derive from rows
      return sumRowsFor(payload.leads?.rows, p, src);
    }),
    backgroundColor: PALETTE[i % PALETTE.length],
    borderWidth: 0,
    maxBarThickness: 36,
  }));
  addStackedBar(
    stackGrid, "sg-stack-leads-src-project",
    "Leads · sources stacked by project",
    stackProj,
    projStackDatasets
  );
  stacked.append(stackGrid);
  mount.append(stacked);

  // —— Heatmaps ——
  const heat = makeSection("Heatmaps", "Project × Month intensity (Leads and Visits)");
  const heatProjects = projectKeys.slice(0, 20);
  const leadsHm = projectMonthMatrix(leads, heatProjects, months);
  const visitsHm = projectMonthMatrix(visits, heatProjects, months);
  renderHeatmap(heat, "Leads · Project × Month", heatProjects, months, leadsHm.matrix, leadsHm.maxVal);
  renderHeatmap(heat, "Visits · Project × Month", heatProjects, months, visitsHm.matrix, visitsHm.maxVal);
  mount.append(heat);
}

function sumRowsFor(rows, project, sourceNormalized) {
  if (!Array.isArray(rows)) return 0;
  let sum = 0;
  for (const row of rows) {
    if ((row.project || "") !== project) continue;
    if ((row.sourceNormalized || "") !== sourceNormalized) continue;
    for (const v of Object.values(row.months || {})) sum += Number(v) || 0;
  }
  return sum;
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

function renderTables(mount, payload) {
  const section = makeSection("Tables", "Sortable breakdowns and detail rows");
  const tabs = el("div", "sg-table-tabs", null);
  const panels = el("div", "sg-table-panels");
  const months = payload.months || [];
  const leads = payload.leads || {};
  const visits = payload.visits || {};

  const tabDefs = [
    {
      id: "month",
      label: "By Month",
      build() {
        const rows = months.map(m => {
          const L = Number(leads.byMonth?.[m] || leads.totals?.byMonth?.[m] || 0);
          const V = Number(visits.byMonth?.[m] || visits.totals?.byMonth?.[m] || 0);
          return [formatMonth(m), L, V, L > 0 ? V / L : 0];
        });
        // store rate as number; display via custom — use pct in cell by preformatting rate col as number*100? Keep numeric and format in table
        const formatted = rows.map(r => [r[0], r[1], r[2], Number((r[3] * 100).toFixed(2))]);
        return sortableTable(
          ["Month", "Leads", "Visits", "Conv %"],
          formatted,
          {numericCols: new Set([1, 2, 3])}
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
        ])].sort();
        const rows = names.map(n => [
          n,
          bucketTotal(leads.byProject?.[n]),
          bucketTotal(visits.byProject?.[n]),
        ]);
        return sortableTable(["Project", "Leads", "Visits"], rows, {numericCols: new Set([1, 2])});
      },
    },
    {
      id: "source",
      label: "By Source",
      build() {
        const names = [...new Set([
          ...Object.keys(leads.bySource || {}),
          ...Object.keys(visits.bySource || {}),
        ])].sort();
        const rows = names.map(n => [
          n,
          bucketTotal(leads.bySource?.[n]),
          bucketTotal(visits.bySource?.[n]),
        ]);
        return sortableTable(["Source", "Leads", "Visits"], rows, {numericCols: new Set([1, 2])});
      },
    },
    {
      id: "detail",
      label: "Detail",
      build() {
        const rows = [];
        for (const kind of ["leads", "visits"]) {
          const sheet = payload[kind];
          for (const row of sheet?.rows || []) {
            let total = 0;
            for (const v of Object.values(row.months || {})) total += Number(v) || 0;
            rows.push([
              kind === "leads" ? "Leads" : "Visits",
              row.project || "",
              row.source || "",
              row.sourceNormalized || "",
              row.sourceNameRaw || "",
              total,
            ]);
          }
        }
        return sortableTable(
          ["Sheet", "Project", "Source", "Source (norm)", "Source Name", "Total"],
          rows,
          {numericCols: new Set([5])}
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
      ? "Create a preview from Leads + Visits first."
      : "No Sales Graph has been published yet."));
    return;
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

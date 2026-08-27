/**
 * Aggregate audit result rows into in-app dashboard KPIs, scorecard, charts, and error details.
 * Reuses mapResultsToRawDataRows for severity / overdue / error labels.
 */

import {mapResultsToRawDataRows} from "./dashboard-export.js?v=5.1.0";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function formatDashDate(date){
  if(!(date instanceof Date) || Number.isNaN(date.valueOf())) return "";
  const dd = String(date.getDate()).padStart(2, "0");
  return `${dd}-${MONTHS[date.getMonth()]}-${date.getFullYear()}`;
}

function startOfDay(d){
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseFilterDate(value){
  if(value instanceof Date && !Number.isNaN(value.valueOf())) return startOfDay(value);
  const s = String(value ?? "").trim();
  if(!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(iso){
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(d.valueOf()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.valueOf()) ? null : startOfDay(d);
}

function accuracyRating(accuracy){
  if(accuracy >= 0.95) return "★★★★★";
  if(accuracy >= 0.9) return "★★★★☆";
  if(accuracy >= 0.8) return "★★★☆☆";
  if(accuracy >= 0.7) return "★★☆☆☆";
  return "★☆☆☆☆";
}

function uniqueSorted(values){
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, {sensitivity: "base"}));
}

function countMapInc(map, key, by = 1){
  if(!key) return;
  map.set(key, (map.get(key) || 0) + by);
}

function normalizeFilterList(value){
  if(Array.isArray(value)){
    return value.map(v => String(v || "").trim()).filter(v => v && !/^all$/i.test(v));
  }
  const s = String(value || "").trim();
  if(!s || /^all$/i.test(s)) return [];
  return [s];
}

function applyFilters(rows, filters = {}){
  const telecallers = normalizeFilterList(filters.telecallers ?? filters.telecaller);
  const projects = normalizeFilterList(filters.projects ?? filters.project);
  const severities = normalizeFilterList(filters.severities ?? filters.severity);
  const errorTypes = normalizeFilterList(filters.errorTypes ?? filters.errorType);
  const dateFrom = parseFilterDate(filters.dateFrom);
  const dateTo = parseFilterDate(filters.dateTo);

  return rows.filter(row => {
    if(telecallers.length && !telecallers.includes(row.telecaller)) return false;
    if(projects.length && !projects.includes(row.project)) return false;
    if(severities.length && !severities.includes(row.severity)) return false;
    if(errorTypes.length){
      const labels = row.errorLabels || [];
      const hit = errorTypes.some(et => labels.includes(et) || row.errorType === et);
      if(!hit) return false;
    }
    if(dateFrom || dateTo){
      if(!(row.registration instanceof Date) || Number.isNaN(row.registration.valueOf())) return false;
      const day = startOfDay(row.registration);
      if(dateFrom && day < dateFrom) return false;
      if(dateTo && day > dateTo) return false;
    }
    return true;
  });
}

function seriesFromMap(map, {sortBy = "label"} = {}){
  let entries = [...map.entries()];
  if(sortBy === "value") entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  else entries.sort((a, b) => a[0].localeCompare(b[0], undefined, {sensitivity: "base"}));
  return {labels: entries.map(([k]) => k), values: entries.map(([, v]) => v)};
}

const CQ_BUCKETS = ["0-2", "3-4", "5-6", "7-8", "9-10"];

function commentQualityBucket(score){
  const n = Number(score);
  if(!Number.isFinite(n)) return null;
  if(n <= 2) return "0-2";
  if(n <= 4) return "3-4";
  if(n <= 6) return "5-6";
  if(n <= 8) return "7-8";
  return "9-10";
}

/**
 * @param {object[]} results LeadLens audit result rows
 * @param {{telecaller?:string|string[],telecallers?:string[],project?:string|string[],projects?:string[],dateFrom?:string|Date,dateTo?:string|Date,severity?:string|string[],severities?:string[],errorType?:string|string[],errorTypes?:string[]}} [filters]
 * @param {{highSeverityErrors?: Set<string>|string[]}} [options]
 */
export function buildDashboardModel(results, filters = {}, options = {}){
  const allRows = mapResultsToRawDataRows(results || [], {highSeverityErrors: options.highSeverityErrors});
  const rows = applyFilters(allRows, filters);

  const allErrorLabels = [];
  for(const row of allRows){
    for(const label of row.errorLabels || []) allErrorLabels.push(label);
  }

  const filterOptions = {
    telecallers: uniqueSorted(allRows.map(r => r.telecaller)),
    projects: uniqueSorted(allRows.map(r => r.project)),
    severities: ["Critical", "Medium"],
    errorTypes: uniqueSorted(allErrorLabels)
  };

  const totalLeads = rows.length;
  const totalErrors = rows.reduce((sum, row) => sum + (row.errorFlag ? 1 : 0), 0);
  const accuracy = totalLeads ? Math.max(0, 1 - totalErrors / totalLeads) : 0;
  const criticalCount = rows.filter(r => r.severity === "Critical").length;
  const mediumCount = rows.filter(r => r.severity === "Medium").length;

  const dates = rows.map(r => r.registration).filter(d => d instanceof Date && !Number.isNaN(d.valueOf()));
  let reportingPeriod = "No data";
  if(dates.length){
    const min = new Date(Math.min(...dates.map(d => d.valueOf())));
    const max = new Date(Math.max(...dates.map(d => d.valueOf())));
    reportingPeriod = `${formatDashDate(min)} to ${formatDashDate(max)}`;
  }

  const byTele = new Map();
  for(const row of rows){
    const name = row.telecaller || "Unknown";
    let bucket = byTele.get(name);
    if(!bucket){
      bucket = {name, leads: 0, errors: 0, critical: 0, medium: 0};
      byTele.set(name, bucket);
    }
    bucket.leads += 1;
    if(row.errorFlag) bucket.errors += 1;
    if(row.severity === "Critical") bucket.critical += 1;
    if(row.severity === "Medium") bucket.medium += 1;
  }

  const scorecard = [...byTele.values()].map(b => {
    const correct = Math.max(0, b.leads - b.errors);
    const acc = b.leads ? Math.max(0, 1 - b.errors / b.leads) : 0;
    return {
      name: b.name,
      leads: b.leads,
      correct,
      errors: b.errors,
      accuracy: acc,
      accuracyPct: acc * 100,
      rating: accuracyRating(acc),
      critical: b.critical,
      medium: b.medium
    };
  }).sort((a, b) => b.accuracy - a.accuracy || a.name.localeCompare(b.name));

  const withLeads = scorecard.filter(s => s.leads > 0);
  const bestTelecaller = withLeads.length ? withLeads[0].name : "N/A";
  const lowestTelecaller = withLeads.length
    ? withLeads.reduce((worst, row) => row.accuracy < worst.accuracy ? row : worst).name
    : "N/A";

  const errorTypeCounts = new Map();
  const projectErrorCounts = new Map();
  const severityCounts = new Map([["Critical", 0], ["Medium", 0]]);
  const commentQualityCounts = new Map(CQ_BUCKETS.map(label => [label, 0]));
  for(const row of rows){
    if(row.severity === "Critical" || row.severity === "Medium"){
      countMapInc(severityCounts, row.severity);
    }
    const cqBucket = commentQualityBucket(row.commentQuality);
    if(cqBucket) countMapInc(commentQualityCounts, cqBucket);
    if(row.errorFlag){
      countMapInc(projectErrorCounts, row.project || "(No project)");
      const labels = row.errorLabels?.length ? row.errorLabels : (row.errorType && row.errorType !== "None" ? [row.errorType] : []);
      for(const label of labels) countMapInc(errorTypeCounts, label);
    }
  }

  const charts = {
    telecallerAccuracy: {
      labels: scorecard.map(s => s.name),
      values: scorecard.map(s => Math.round(s.accuracyPct * 10) / 10)
    },
    errorsByTelecaller: {
      labels: scorecard.map(s => s.name),
      values: scorecard.map(s => s.errors)
    },
    errorTypeDistribution: seriesFromMap(errorTypeCounts, {sortBy: "value"}),
    projectErrors: seriesFromMap(projectErrorCounts, {sortBy: "value"}),
    severityDistribution: {
      labels: ["Critical", "Medium"],
      values: [severityCounts.get("Critical") || 0, severityCounts.get("Medium") || 0]
    },
    commentQualityDistribution: {
      labels: CQ_BUCKETS.slice(),
      values: CQ_BUCKETS.map(label => commentQualityCounts.get(label) || 0)
    }
  };

  const errorDetails = rows
    .filter(row => row.errorFlag)
    .map(row => ({
      project: row.project,
      mobile: row.mobile,
      telecaller: row.telecaller,
      errorType: row.errorType,
      details: row.errorDetails,
      action: row.recommendedAction,
      severity: row.severity,
      comments: row.comments,
      status: row.status,
      connected: row.connected,
      location: row.location,
      requirement: row.requirement,
      budget: row.budget,
      parameter: row.parameter,
      commentQuality: row.commentQuality,
      buyingIntent: row.buyingIntent,
      registration: row.registration,
      next: row.next,
      overdue: row.overdue,
      source: row.source,
      sourceName: row.sourceName,
      auditStatus: row.auditStatus
    }));

  return {
    filterOptions,
    filteredCount: rows.length,
    totalRowCount: allRows.length,
    kpis: {
      totalLeads,
      totalErrors,
      accuracy,
      accuracyPct: accuracy * 100,
      criticalCount,
      mediumCount,
      bestTelecaller,
      lowestTelecaller,
      reportingPeriod
    },
    scorecard,
    charts,
    errorDetails
  };
}

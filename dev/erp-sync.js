/**
 * /dev Super User ERP Sync panel — fetch ERP → store raw → hand off to main Audit UI.
 */
import {api} from './api-client.js?v=7.2.0.dev';
import {getUser} from './auth.js?v=7.2.0.dev';

const FIELD_IDS = [
  'mobile', 'project', 'registration', 'telecaller', 'source', 'update',
  'status', 'comments', 'next', 'location', 'requirement', 'parameter', 'budget'
];

const DEFAULT_ALIASES = {
  mobile: 'Mobile, Mobile Number, mobile, phone',
  project: 'Project Name, Project, project',
  registration: 'Lead Registration Date, Registration Date, LRD',
  telecaller: 'Telecaller Name, Agent Name, telecaller',
  source: 'Source, Source Name',
  update: 'Lead Update Date, Call Date, Update Date, LUD',
  status: 'Lead Status, Status',
  comments: 'Comments, Remarks',
  next: 'Next Followup Date, Next Follow-up Date, NFD',
  location: 'Customer Location, Location',
  requirement: 'Customer Requirement, Requirement',
  parameter: 'Analysis Parameter, Analysis Parameters',
  budget: 'Estimated Budget, Budget'
};

const BUSY_DISABLE_IDS = [
  'erp-sync-save',
  'erp-sync-test',
  'erp-sync-fetch-audit',
  'erp-sync-ping',
  'erp-sync-run-server',
  'erp-sync-publish'
];

/** @type {((entry: object) => void|Promise<void>)|null} */
let loadIntoAuditFn = null;
/** @type {((msg: string) => void)|null} */
let toastFn = null;
/** @type {((name: string) => void)|null} */
let showViewFn = null;

let busy = false;
/** @type {AbortController|null} */
let activeAbort = null;
/** @type {Map<string, string>} */
const buttonLabels = new Map();

function $(id) {
  return document.getElementById(id);
}

function isAbortError(err) {
  return Boolean(
    err
    && (err.name === 'AbortError'
      || err.code === 20
      || /aborted|AbortError/i.test(String(err.message || '')))
  );
}

function setMsg(text, isError = false) {
  const el = $('erp-sync-message');
  if (!el) return;
  el.textContent = text || '';
  el.style.color = isError ? 'var(--danger, #b42318)' : '';
}

function aliasesToString(aliases) {
  if (Array.isArray(aliases)) return aliases.join(', ');
  if (typeof aliases === 'string') return aliases;
  return DEFAULT_ALIASES[aliases] || '';
}

function readFieldMapFromUi() {
  const map = {};
  for (const id of FIELD_IDS) {
    const input = document.querySelector(`[data-erp-map="${id}"]`);
    const raw = (input?.value || '').trim();
    map[id] = raw
      ? raw.split(',').map(s => s.trim()).filter(Boolean)
      : (DEFAULT_ALIASES[id] || id).split(',').map(s => s.trim()).filter(Boolean);
  }
  return map;
}

function renderFieldMap(fieldMap) {
  const mount = $('erp-sync-field-map');
  if (!mount) return;
  mount.replaceChildren();
  for (const id of FIELD_IDS) {
    const row = document.createElement('label');
    row.style.display = 'grid';
    row.style.gridTemplateColumns = 'minmax(100px,140px) 1fr';
    row.style.gap = '10px';
    row.style.alignItems = 'center';
    row.style.padding = '8px 0';
    row.style.borderBottom = '1px solid var(--line)';
    const title = document.createElement('span');
    title.textContent = id;
    const input = document.createElement('input');
    input.type = 'text';
    input.dataset.erpMap = id;
    input.value = aliasesToString(fieldMap?.[id] ?? DEFAULT_ALIASES[id]);
    row.append(title, input);
    mount.append(row);
  }
}

function parseExtraHeaders() {
  const raw = ($('erp-sync-headers')?.value || '').trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Extra headers must be a JSON object');
  }
  return parsed;
}

/** Display server UTC timestamps in Asia/Kolkata (IST). */
function formatIst(iso) {
  if (!iso) return '—';
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return String(iso);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  const month = get('month').replace(/\./g, '');
  return `${get('day')} ${month} ${get('year')}, ${get('hour')}:${get('minute')}:${get('second')} IST`;
}

function formatAgeSeconds(ageSec) {
  if (ageSec == null || !Number.isFinite(ageSec)) return '';
  if (ageSec < 60) return `${ageSec}s ago`;
  if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m ago`;
  if (ageSec < 86400) return `${Math.floor(ageSec / 3600)}h ago`;
  return `${Math.floor(ageSec / 86400)}d ago`;
}

function formatKeepaliveLine(ka, diag = null) {
  if (!ka || typeof ka !== 'object') {
    if (diag?.enabled) {
      return 'Keep-alive: enabled, but never run. Cron must be set in hPanel to */1 — Save alone does not ping on a schedule.';
    }
    return 'Keep-alive: never run.';
  }
  const result = ka.result || (ka.session_expired ? 'session_expired' : (ka.ok ? 'ok' : 'error'));
  const when = formatIst(ka.at);
  const source = ka.source === 'cron' ? 'cron' : (ka.source === 'manual' ? 'manual' : '');
  const sourceBit = source ? ` via ${source}` : '';
  const ageBit = diag?.age_seconds != null ? ` (${formatAgeSeconds(diag.age_seconds)})` : '';
  if (result === 'disabled') {
    return `Keep-alive: cron hit but disabled at ${when}${ageBit} — enable checkbox and Save.`;
  }
  if (result === 'session_expired' || ka.session_expired) {
    return `Keep-alive: session_expired at ${when}${sourceBit}${ageBit} — refresh Cookie and Save.`;
  }
  if (result === 'ok' && ka.ok) {
    const http = ka.http_status != null ? ` HTTP ${ka.http_status}` : '';
    return `Keep-alive: ok at ${when}${sourceBit}${ageBit}${http}`;
  }
  return `Keep-alive: ${result} at ${when}${sourceBit}${ageBit}${ka.error ? ` — ${ka.error}` : ''}`;
}

function writeKeepaliveStatus(ka, diag = null) {
  const el = $('erp-sync-keepalive-status');
  if (!el) return;
  const lines = [formatKeepaliveLine(ka, diag)];
  if (diag?.hint) lines.push(diag.hint);
  el.textContent = lines.join('\n');
  el.style.color = (ka?.session_expired || ka?.result === 'session_expired' || diag?.cron_silent)
    ? 'var(--danger, #b42318)'
    : '';
}

function formatDailyLine(daily) {
  if (!daily || typeof daily !== 'object') return 'Last scheduled run: never.';
  const when = formatIst(daily.at);
  if (daily.session_expired) {
    return `Last scheduled run: session expired at ${when} — refresh Cookie; no publish.`;
  }
  if (daily.ok === false) {
    return `Last scheduled run: failed at ${when} — ${daily.error || daily.phase || 'error'}`;
  }
  if (daily.needs_continue || daily.partial) {
    const done = daily.done ?? daily.audited ?? 0;
    const total = daily.total ?? daily.lead_count ?? '?';
    return `Last scheduled run: auditing ${done}/${total} at ${when} (continue cron will resume)`;
  }
  if (daily.phase === 'published' || daily.auto_publish) {
    return `Last scheduled run: published ${daily.published_count ?? 0} dashboard(s) at ${when}`;
  }
  if (daily.complete || daily.phase === 'ready') {
    return `Last scheduled run: audit complete at ${when}${daily.message ? ` — ${daily.message}` : ''}`;
  }
  return `Last scheduled run: ${daily.phase || 'ok'} at ${when}${daily.message ? ` — ${daily.message}` : ''}`;
}

function writeDailyStatus(daily) {
  const el = $('erp-sync-daily-status');
  if (!el) return;
  el.textContent = formatDailyLine(daily);
  el.style.color = (daily?.ok === false || daily?.session_expired)
    ? 'var(--danger, #b42318)'
    : '';
}

function applyConfig(config, diag = null) {
  if (!$('erp-sync-url')) return;
  $('erp-sync-url').value = config.report_url || '';
  $('erp-sync-method').value = config.http_method === 'POST' ? 'POST' : 'GET';
  $('erp-sync-cookie').value = '';
  $('erp-sync-cookie-hint').textContent = config.cookie_configured
    ? 'Cookie is saved (encrypted). Paste a new value only to replace it.'
    : 'No cookie saved yet.';
  const headers = config.extra_headers && typeof config.extra_headers === 'object'
    ? config.extra_headers
    : {};
  $('erp-sync-headers').value = Object.keys(headers).length
    ? JSON.stringify(headers, null, 2)
    : '';
  $('erp-sync-rows-path').value = config.rows_path || '';
  const dailyOn = Boolean(config.daily_enabled ?? config.enabled);
  if ($('erp-sync-daily')) {
    $('erp-sync-daily').checked = dailyOn;
  }
  // Legacy id kept if present in older HTML caches.
  if ($('erp-sync-enabled')) {
    $('erp-sync-enabled').checked = dailyOn;
  }
  if ($('erp-sync-keepalive')) {
    $('erp-sync-keepalive').checked = Boolean(config.keepalive_enabled);
  }
  if ($('erp-sync-keepalive-url')) {
    $('erp-sync-keepalive-url').value = config.keepalive_url || '';
  }
  if ($('erp-sync-cron-auto-publish')) {
    $('erp-sync-cron-auto-publish').checked = config.cron_auto_publish !== false;
  }
  $('erp-sync-auto-publish').checked = Boolean(config.auto_publish);
  $('erp-sync-batch-size').value = String(config.batch_size ?? 10);
  $('erp-sync-max-leads').value = String(config.max_leads_per_run ?? 40);
  $('erp-sync-cron-secret').value = '';
  $('erp-sync-cron-hint').textContent = config.cron_secret_configured
    ? 'Cron secret is set. Paste a new value only to rotate it.'
    : 'Set a cron secret before enabling Hostinger cron.';
  const keepaliveDiag = diag || null;
  writeKeepaliveStatus(config.last_keepalive, keepaliveDiag);
  writeDailyStatus(config.last_daily_status);
  renderFieldMap(config.field_map || DEFAULT_ALIASES);
}

function formatStatus(payload) {
  const last = payload?.last_status || payload?.config?.last_status;
  const ka = payload?.last_keepalive || payload?.config?.last_keepalive;
  const daily = payload?.last_daily_status || payload?.config?.last_daily_status;
  const job = payload?.job;
  const lines = [];
  if (payload?.keepalive?.hint) {
    lines.push('Keep-alive hint: ' + payload.keepalive.hint);
  }
  if (daily) {
    const when = daily.at ? formatIst(daily.at) : '—';
    lines.push(`Scheduled (${when}): ` + JSON.stringify({...daily, at_ist: when}, null, 2));
  }
  if (ka) {
    const when = ka.at ? formatIst(ka.at) : '—';
    lines.push(`Keep-alive (${when}): ` + JSON.stringify({...ka, at_ist: when}, null, 2));
  }
  if (last) {
    const when = last.at ? formatIst(last.at) : '—';
    lines.push(`Last (${when}): ` + JSON.stringify({...last, at_ist: when}, null, 2));
  }
  if (job) {
    lines.push('Job: ' + JSON.stringify(job, null, 2));
  }
  if (!lines.length) return 'No fetches yet.';
  return lines.join('\n\n');
}

function updateProgressUI({label = 'Idle', percent = '0%', width = '0%', detail = '', indeterminate = false, error = false} = {}) {
  const labelEl = $('erp-sync-progress-label');
  const pctEl = $('erp-sync-progress-percent');
  const bar = $('erp-sync-progress-bar');
  const detailEl = $('erp-sync-progress-detail');
  if (labelEl) labelEl.textContent = label;
  if (pctEl) pctEl.textContent = percent;
  if (detailEl) {
    detailEl.textContent = detail;
    detailEl.style.color = error ? 'var(--danger, #b42318)' : '';
  }
  if (bar) {
    bar.classList.toggle('is-indeterminate', indeterminate);
    bar.style.width = indeterminate ? '35%' : width;
  }
}

function rememberButtonLabels() {
  for (const id of BUSY_DISABLE_IDS) {
    const btn = $(id);
    if (btn && !buttonLabels.has(id)) buttonLabels.set(id, btn.textContent || '');
  }
}

/**
 * @param {boolean} active
 * @param {{activeId?: string|null, workingLabel?: string}} [opts]
 */
function setBusy(active, {activeId = null, workingLabel = 'Working…'} = {}) {
  rememberButtonLabels();
  busy = active;
  for (const id of BUSY_DISABLE_IDS) {
    const btn = $(id);
    if (!btn) continue;
    btn.disabled = active;
    if (!active) {
      btn.textContent = buttonLabels.get(id) || btn.textContent;
      continue;
    }
    if (id === activeId) {
      btn.textContent = workingLabel;
    } else {
      btn.textContent = buttonLabels.get(id) || btn.textContent;
    }
  }
  if (!active) {
    $('erp-sync-progress-bar')?.classList.remove('is-indeterminate');
  }
}

function beginAbortableRequest() {
  if (activeAbort) {
    try { activeAbort.abort(); } catch { /* ignore */ }
  }
  activeAbort = new AbortController();
  return activeAbort.signal;
}

function clearAbortController() {
  activeAbort = null;
}

function statusElWrite(payload) {
  const statusEl = $('erp-sync-status');
  if (statusEl) statusEl.textContent = formatStatus(payload);
  const ka = payload?.last_keepalive || payload?.config?.last_keepalive;
  writeKeepaliveStatus(ka, payload?.keepalive || null);
  writeDailyStatus(payload?.last_daily_status || payload?.config?.last_daily_status);
}

/** Super User only — available on production `/` and `/dev`. */
export function canShowErpSync() {
  return Boolean(getUser()?.is_super);
}

/** Reveal/hide Sync nav as soon as auth/role is known (before slow boot awaits). */
export function applyErpSyncNavVisibility() {
  const nav = $('nav-erp-sync');
  if (!nav) return;
  nav.classList.toggle('hidden', !canShowErpSync());
}

export async function loadErpSyncPanel() {
  if (!canShowErpSync()) return;
  try {
    const data = await api('erp-sync/status');
    applyConfig(data.config || {}, data.keepalive || null);
    statusElWrite(data);
    const last = data.last_status;
    if (last?.phase === 'ready-for-audit' && last.lead_count != null) {
      updateProgressUI({
        label: `Ready — ${Number(last.lead_count).toLocaleString()} leads`,
        percent: '100%',
        width: '100%',
        detail: 'Stored on server. Use Fetch & send to Audit again, or open Bucket 1 and Start Audit if already loaded.'
      });
    } else if (last?.ok === false) {
      updateProgressUI({
        label: 'Last fetch failed',
        percent: '—',
        width: '0%',
        detail: last.error || 'Error',
        error: true
      });
    } else {
      updateProgressUI({
        label: 'Idle',
        percent: '0%',
        width: '0%',
        detail: 'Configure URL + Cookie, Save, then Fetch & send to Audit.'
      });
    }
  } catch (err) {
    setMsg(err.message || 'Could not load ERP sync config', true);
  }
}

function buildConfigBody() {
  const extra_headers = parseExtraHeaders();
  const dailyEnabled = Boolean(
    $('erp-sync-daily')?.checked
    ?? $('erp-sync-enabled')?.checked
  );
  const body = {
    report_url: $('erp-sync-url')?.value?.trim() || '',
    http_method: $('erp-sync-method')?.value || 'GET',
    extra_headers,
    rows_path: $('erp-sync-rows-path')?.value?.trim() || '',
    daily_enabled: dailyEnabled,
    enabled: dailyEnabled,
    cron_auto_publish: $('erp-sync-cron-auto-publish')
      ? Boolean($('erp-sync-cron-auto-publish').checked)
      : true,
    auto_publish: Boolean($('erp-sync-auto-publish')?.checked),
    batch_size: Number($('erp-sync-batch-size')?.value || 10),
    max_leads_per_run: Number($('erp-sync-max-leads')?.value || 40),
    field_map: readFieldMapFromUi()
  };
  // Only send keepalive flags when the controls exist — avoids wiping enabled
  // state from quiet saves against a stale HTML cache missing the checkbox.
  const kaEl = $('erp-sync-keepalive');
  if (kaEl) {
    body.keepalive_enabled = Boolean(kaEl.checked);
  }
  const kaUrl = $('erp-sync-keepalive-url');
  if (kaUrl) {
    body.keepalive_url = kaUrl.value?.trim() || '';
  }
  const cookie = $('erp-sync-cookie')?.value?.trim() || '';
  if (cookie) body.cookie = cookie;
  const cron = $('erp-sync-cron-secret')?.value?.trim() || '';
  if (cron) body.cron_secret = cron;
  return body;
}

async function saveConfig() {
  setBusy(true, {activeId: 'erp-sync-save', workingLabel: 'Saving…'});
  setMsg('Saving…');
  let body;
  try {
    body = buildConfigBody();
  } catch (err) {
    setBusy(false);
    setMsg(err.message, true);
    return;
  }
  try {
    const data = await api('erp-sync/config', {method: 'POST', body});
    applyConfig(data.config || {});
    const note = body.keepalive_enabled
      ? 'Saved. Cron must be set in hPanel to */1 — Save alone does not ping on a schedule.'
      : (data.message || 'Saved');
    setMsg(note);
  } catch (err) {
    setMsg(err.message || 'Save failed', true);
  } finally {
    setBusy(false);
  }
}

async function saveConfigQuiet(signal) {
  let body;
  try {
    body = buildConfigBody();
  } catch {
    return;
  }
  const data = await api('erp-sync/config', {method: 'POST', body, signal});
  applyConfig(data.config || {});
}

async function testFetch() {
  if (busy) return;
  const signal = beginAbortableRequest();
  setBusy(true, {activeId: 'erp-sync-test', workingLabel: 'Testing…'});
  setMsg('Fetching…');
  updateProgressUI({label: 'Test fetch…', percent: '…', indeterminate: true, detail: 'Request in flight…'});
  $('erp-sync-preview').textContent = '';
  try {
    await saveConfigQuiet(signal);
    const data = await api('erp-sync/test-fetch', {method: 'POST', body: {}, signal});
    const preview = data.preview || {};
    const mapping = data.mapping || {};
    const lines = [
      `HTTP ${data.http_status} · ${data.bytes} bytes · ${preview.format || '?'}`,
      `Rows: ${preview.row_count ?? 0}` + (preview.rows_path ? ` (path: ${preview.rows_path})` : ''),
      `Keys: ${(preview.keys || []).join(', ') || '(none)'}`,
      mapping.mapped_columns
        ? `Mapped: ${JSON.stringify(mapping.mapped_columns)}`
        : '',
      mapping.lead_count != null ? `Leads after map: ${mapping.lead_count}` : '',
      mapping.missing_required?.length
        ? `Missing required: ${mapping.missing_required.join(', ')}`
        : '',
      preview.sample_row
        ? `Sample: ${JSON.stringify(preview.sample_row, null, 2)}`
        : ''
    ].filter(Boolean);
    $('erp-sync-preview').textContent = lines.join('\n');
    setMsg(data.message || 'Test fetch OK');
    updateProgressUI({
      label: `Preview — ${(mapping.lead_count ?? preview.row_count ?? 0).toLocaleString()} rows/leads`,
      percent: '100%',
      width: '100%',
      detail: 'Test only — use Fetch & send to Audit to load into Bucket 1.'
    });
    await refreshStatus({signal});
  } catch (err) {
    if (isAbortError(err)) {
      setMsg('Stopped.');
    } else {
      setMsg(err.message || 'Test fetch failed', true);
      updateProgressUI({label: 'Error', percent: '—', width: '0%', detail: err.message || 'Test fetch failed', error: true});
      if (err.data?.session_expired) {
        $('erp-sync-cookie-hint').textContent = 'Session expired — paste a fresh Cookie header and Save settings.';
      }
    }
  } finally {
    clearAbortController();
    setBusy(false);
  }
}

/**
 * Primary path: fetch ERP → store raw + mapped leads → hand off to main Audit UI.
 */
async function fetchAndSendToAudit() {
  if (busy) return;
  if (typeof loadIntoAuditFn !== 'function') {
    setMsg('Audit handoff is not available — reload the page.', true);
    return;
  }
  const signal = beginAbortableRequest();
  setBusy(true, {activeId: 'erp-sync-fetch-audit', workingLabel: 'Fetching…'});
  setMsg('Fetching ERP report…');
  updateProgressUI({
    label: 'Fetching ERP…',
    percent: '…',
    indeterminate: true,
    detail: 'Saving raw payload, then mapping leads for Audit.'
  });

  try {
    await saveConfigQuiet(signal);
    const summary = await api('erp-sync/fetch-for-audit', {method: 'POST', body: {}, signal});
    if (!summary?.ok) {
      throw Object.assign(new Error(summary?.error || 'Fetch failed'), {data: summary});
    }

    updateProgressUI({
      label: `Mapped ${Number(summary.lead_count || 0).toLocaleString()} leads`,
      percent: '…',
      indeterminate: true,
      detail: 'Downloading mapped leads into Audit…'
    });
    setMsg(`Mapped ${summary.lead_count} leads — loading into Audit…`);

    const pack = await api('erp-sync/latest-leads', {signal});
    const leads = Array.isArray(pack?.leads) ? pack.leads : [];
    if (!leads.length) {
      throw new Error('Server stored the fetch but returned no mapped leads');
    }

    const fileName = pack.source_file || summary.source_file || `ERP:${summary.payload_file || 'latest'}`;
    const entry = {
      sheetName: 'ERP',
      leads,
      rowCount: pack.row_count ?? summary.row_count ?? leads.length,
      leadCount: pack.lead_count ?? summary.lead_count ?? leads.length,
      callCount: pack.row_count ?? summary.row_count ?? leads.length,
      latestDayCalls: leads.length,
      invalidRows: 0,
      dedupedRows: 0,
      expectedColumns: [],
      missingColumns: [],
      unknownHeaders: [],
      looksAudited: false,
      fileName,
      fileSize: summary.bytes || 0,
      sourceFormat: 'raw',
      fromErpSync: true
    };

    await loadIntoAuditFn(entry);
    updateProgressUI({
      label: `Ready — ${leads.length.toLocaleString()} leads in Audit`,
      percent: '100%',
      width: '100%',
      detail: 'Open Bucket 1 Followup Review and click Start Audit → (same progress bar / Stop as Excel RAW).'
    });
    setMsg(`Loaded ${leads.length.toLocaleString()} leads into Audit`);
    toastFn?.(`ERP → Audit: ${leads.length.toLocaleString()} leads ready`);
    await refreshStatus({signal});
  } catch (err) {
    if (isAbortError(err)) {
      setMsg('Stopped.');
      updateProgressUI({label: 'Stopped', percent: '—', width: '0%', detail: 'Fetch cancelled.'});
    } else {
      setMsg(err.message || 'Fetch & send failed', true);
      updateProgressUI({
        label: 'Error',
        percent: '—',
        width: '0%',
        detail: err.message || 'Fetch & send failed',
        error: true
      });
      if (err.data?.session_expired) {
        $('erp-sync-cookie-hint').textContent = 'Session expired — paste a fresh Cookie header and Save settings.';
      }
    }
  } finally {
    clearAbortController();
    setBusy(false);
  }
}

async function pingKeepalive() {
  if (busy) return;
  const signal = beginAbortableRequest();
  setBusy(true, {activeId: 'erp-sync-ping', workingLabel: 'Pinging…'});
  setMsg('Keep-alive ping…');
  try {
    await saveConfigQuiet(signal);
    const data = await api('erp-sync/keepalive', {method: 'POST', body: {}, signal});
    writeKeepaliveStatus(data, {
      age_seconds: 0,
      enabled: true,
      hint: data.source === 'manual'
        ? 'Manual ping OK. For overnight sessions, hPanel cron must hit production /api/erp-sync/keepalive every minute (source will show “cron”).'
        : ''
    });
    if (data.session_expired || data.result === 'session_expired') {
      setMsg(data.error || 'ERP session expired — refresh Cookie', true);
      $('erp-sync-cookie-hint').textContent = 'Session expired — paste a fresh Cookie header and Save settings.';
    } else if (data.ok) {
      setMsg(`Keep-alive OK at ${formatIst(data.at)}`);
    } else {
      setMsg(data.error || 'Keep-alive failed', true);
    }
    await refreshStatus({signal});
  } catch (err) {
    if (isAbortError(err)) {
      setMsg('Stopped.');
    } else {
      setMsg(err.message || 'Keep-alive failed', true);
      if (err.data?.session_expired) {
        writeKeepaliveStatus({...err.data, result: 'session_expired', at: err.data.at || new Date().toISOString(), source: 'manual'});
        $('erp-sync-cookie-hint').textContent = 'Session expired — paste a fresh Cookie header and Save settings.';
      }
    }
  } finally {
    clearAbortController();
    setBusy(false);
  }
}

/** Optional advanced: server-side OpenAI audit (not the primary path). */
async function runServerAuditOnce() {
  if (busy) return;
  const signal = beginAbortableRequest();
  setBusy(true, {activeId: 'erp-sync-run-server', workingLabel: 'Server audit…'});
  setMsg('Running optional server audit (one batch)…');
  updateProgressUI({
    label: 'Server audit…',
    percent: '…',
    indeterminate: true,
    detail: 'Advanced path — prefer Fetch & send to Audit for the main UI.'
  });
  try {
    await saveConfigQuiet(signal);
    const data = await api('erp-sync/run', {
      method: 'POST',
      body: {force_fetch: true, dry_run: false},
      signal
    });
    if (data.ok === false) {
      setMsg(data.error || 'Server audit failed', true);
      updateProgressUI({label: 'Error', percent: '—', width: '0%', detail: data.error || 'Failed', error: true});
    } else if (data.partial || data.needs_continue) {
      const done = data.audited ?? data.done ?? 0;
      const total = data.total ?? data.lead_count ?? '?';
      setMsg(`Partial server audit ${done}/${total} — call again to continue (or use main Audit instead).`);
      updateProgressUI({
        label: `Server audit ${done}/${total}`,
        percent: total && Number(total) ? `${Math.round(done / Number(total) * 100)}%` : '…',
        width: total && Number(total) ? `${Math.min(100, Math.round(done / Number(total) * 100))}%` : '35%',
        detail: 'Incomplete. Prefer Fetch & send to Audit for reliable progress.'
      });
    } else {
      setMsg(data.message || `Server audit done (${data.result_count ?? data.audited ?? 0} results)`);
      updateProgressUI({
        label: 'Server audit complete',
        percent: '100%',
        width: '100%',
        detail: data.auto_publish
          ? 'Auto-published.'
          : 'Use Publish last results if needed.'
      });
    }
    await refreshStatus({signal});
  } catch (err) {
    if (isAbortError(err)) {
      setMsg('Stopped.');
    } else {
      setMsg(err.message || 'Server audit failed', true);
      updateProgressUI({label: 'Error', percent: '—', width: '0%', detail: err.message || 'Failed', error: true});
    }
  } finally {
    clearAbortController();
    setBusy(false);
  }
}

async function publishLast() {
  if (busy) return;
  const signal = beginAbortableRequest();
  setBusy(true, {activeId: 'erp-sync-publish', workingLabel: 'Publishing…'});
  setMsg('Publishing…');
  updateProgressUI({label: 'Publishing…', percent: '…', indeterminate: true, detail: 'Publishing last server-audit results…'});
  try {
    const data = await api('erp-sync/publish', {method: 'POST', body: {}, signal});
    setMsg(data.message || `Published ${(data.published || []).length} board(s)`);
    await refreshStatus({signal});
    updateProgressUI({
      label: 'Published',
      percent: '100%',
      width: '100%',
      detail: data.message || 'Dashboards published from last server audit.'
    });
  } catch (err) {
    if (isAbortError(err)) {
      setMsg('Stopped.');
    } else {
      setMsg(err.message || 'Publish failed', true);
      updateProgressUI({label: 'Error', percent: '—', width: '0%', detail: err.message || 'Publish failed', error: true});
    }
  } finally {
    clearAbortController();
    setBusy(false);
  }
}

async function refreshStatus({signal} = {}) {
  const data = await api('erp-sync/status', {signal});
  statusElWrite(data);
  return data;
}

/**
 * @param {{toast?: (msg: string) => void, showView?: (name: string) => void, loadErpIntoAudit?: (entry: object) => void|Promise<void>}} [opts]
 */
export function mountErpSyncPanel({toast, showView, loadErpIntoAudit} = {}) {
  applyErpSyncNavVisibility();
  if (!canShowErpSync()) return;
  toastFn = typeof toast === 'function' ? toast : null;
  showViewFn = typeof showView === 'function' ? showView : null;
  loadIntoAuditFn = typeof loadErpIntoAudit === 'function' ? loadErpIntoAudit : null;
  rememberButtonLabels();

  $('erp-sync-save')?.addEventListener('click', () => {
    saveConfig().then(() => toastFn?.('ERP sync settings saved'));
  });
  $('erp-sync-test')?.addEventListener('click', () => testFetch());
  $('erp-sync-fetch-audit')?.addEventListener('click', () => fetchAndSendToAudit());
  $('erp-sync-ping')?.addEventListener('click', () => pingKeepalive());
  $('erp-sync-run-server')?.addEventListener('click', () => runServerAuditOnce());
  $('erp-sync-publish')?.addEventListener('click', () => publishLast());

  // Silence unused lint if showView not used here — kept for callers / future.
  void showViewFn;
}

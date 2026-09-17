/**
 * /dev Super User ERP Sync panel — config, test fetch, run, continue, auto-continue, publish.
 */
import {api} from './api-client.js?v=6.0.0.dev';
import {isDevHost} from './app-base.js?v=6.0.0.dev';
import {getUser} from './auth.js?v=6.0.0.dev';

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

const ACTION_BUTTON_IDS = [
  'erp-sync-save',
  'erp-sync-test',
  'erp-sync-run',
  'erp-sync-continue',
  'erp-sync-auto-continue',
  'erp-sync-publish',
  'erp-sync-refresh-status'
];

const AUTO_CONTINUE_DELAY_MS = 750;

const PHASE_LABELS = {
  fetch: 'Fetch',
  parse: 'Map',
  map: 'Map',
  audit: 'Audit',
  auditing: 'Audit',
  publish: 'Publish',
  published: 'Publish',
  ready: 'Done',
  done: 'Done',
  audited: 'Done',
  error: 'Error',
  disabled: 'Disabled'
};

let autoContinueActive = false;
let autoContinueStop = false;
/** @type {Map<string, string>} */
const buttonLabels = new Map();

function $(id) {
  return document.getElementById(id);
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

function applyConfig(config) {
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
  $('erp-sync-enabled').checked = Boolean(config.enabled);
  $('erp-sync-auto-publish').checked = Boolean(config.auto_publish);
  $('erp-sync-batch-size').value = String(config.batch_size ?? 10);
  $('erp-sync-max-leads').value = String(config.max_leads_per_run ?? 40);
  $('erp-sync-cron-secret').value = '';
  $('erp-sync-cron-hint').textContent = config.cron_secret_configured
    ? 'Cron secret is set. Paste a new value only to rotate it.'
    : 'Set a cron secret before enabling Hostinger cron.';
  renderFieldMap(config.field_map || DEFAULT_ALIASES);
}

function formatStatus(payload) {
  const last = payload?.last_status || payload?.config?.last_status;
  const job = payload?.job;
  const lines = [];
  if (last) {
    lines.push('Last: ' + JSON.stringify(last, null, 2));
  }
  if (job) {
    lines.push('Job: ' + JSON.stringify(job, null, 2));
  }
  if (!lines.length) return 'No runs yet.';
  return lines.join('\n\n');
}

function phaseLabel(phase) {
  if (!phase) return 'Idle';
  const key = String(phase).toLowerCase();
  return PHASE_LABELS[key] || String(phase);
}

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalize progress fields from run/status payloads.
 * @returns {{audited:number|null,total:number|null,phase:string|null,needsContinue:boolean,complete:boolean,error:string|null,indeterminate:boolean}}
 */
function extractProgress(data) {
  const progress = data?.progress || null;
  const job = data?.job || null;
  const last = data?.last_status || data?.config?.last_status || null;

  const audited = numOrNull(
    progress?.audited ?? data?.audited ?? data?.done ?? data?.result_count
      ?? job?.audited ?? job?.result_count ?? last?.done ?? last?.audited
  );
  const total = numOrNull(
    progress?.total ?? data?.total ?? data?.lead_count
      ?? job?.total ?? job?.lead_count ?? last?.lead_count ?? last?.total
  );
  let phase = progress?.phase ?? data?.phase ?? job?.phase ?? last?.phase ?? null;
  if (!phase && job?.status) phase = job.status;
  if (!phase && data?.status && data.status !== 'disabled') phase = data.status;

  const needsContinue = Boolean(
    progress?.needs_continue
      ?? data?.needs_continue
      ?? data?.partial
      ?? job?.needs_continue
      ?? (job?.status === 'auditing')
  );
  const complete = Boolean(
    progress?.complete
      ?? data?.complete
      ?? job?.complete
      ?? (!needsContinue && (
        data?.ok === true && data?.partial !== true
          && ['ready', 'published', 'done', 'audited'].includes(String(phase || '').toLowerCase())
      ))
  );
  const error = progress?.error || data?.error || job?.error || last?.error || null;

  return {
    audited,
    total,
    phase: phase ? String(phase) : null,
    needsContinue,
    complete,
    error: error ? String(error) : null,
    indeterminate: false
  };
}

function setProgressIndeterminate(active, label = 'Working…') {
  const bar = $('erp-sync-progress-bar');
  const labelEl = $('erp-sync-progress-label');
  const pctEl = $('erp-sync-progress-percent');
  const detailEl = $('erp-sync-progress-detail');
  if (labelEl) labelEl.textContent = label;
  if (pctEl) pctEl.textContent = '…';
  if (detailEl) detailEl.textContent = 'Request in flight — waiting for server response.';
  if (bar) {
    bar.classList.toggle('is-indeterminate', active);
    if (active) bar.style.width = '35%';
  }
}

function updateProgressUI(info, {busy = false} = {}) {
  const labelEl = $('erp-sync-progress-label');
  const pctEl = $('erp-sync-progress-percent');
  const bar = $('erp-sync-progress-bar');
  const detailEl = $('erp-sync-progress-detail');
  if (!labelEl || !pctEl || !bar || !detailEl) return;

  if (info?.indeterminate || (busy && info?.audited == null && info?.total == null)) {
    setProgressIndeterminate(true, busy ? 'Working…' : phaseLabel(info?.phase));
    return;
  }

  bar.classList.remove('is-indeterminate');

  const audited = info?.audited;
  const total = info?.total;
  const phase = info?.phase;
  const hasCounts = audited != null && total != null && total > 0;
  const pct = hasCounts ? Math.round(Math.min(audited, total) / total * 100) : (info?.complete ? 100 : 0);

  if (info?.error || String(phase || '').toLowerCase() === 'error') {
    labelEl.textContent = hasCounts
      ? `Error — audited ${audited.toLocaleString()} / ${total.toLocaleString()}`
      : 'Error';
    pctEl.textContent = hasCounts ? `${pct}%` : '—';
    bar.style.width = `${pct}%`;
    detailEl.textContent = info.error || 'Audit job failed. Fix the issue, then Start / Run or Continue.';
    return;
  }

  if (hasCounts) {
    const phaseBit = phaseLabel(phase);
    if (info.needsContinue) {
      labelEl.textContent = `Auditing… ${audited.toLocaleString()} / ${total.toLocaleString()}`;
      detailEl.textContent = `Phase: ${phaseBit} — call Continue or Auto-continue until done.`;
    } else if (info.complete || pct >= 100) {
      labelEl.textContent = `Complete — ${audited.toLocaleString()} / ${total.toLocaleString()}`;
      detailEl.textContent = `Phase: ${phaseBit}` + (
        String(phase || '').toLowerCase() === 'published'
          ? ' · dashboards published'
          : ' · use Publish last results if auto-publish is off'
      );
    } else {
      labelEl.textContent = `${phaseBit} — ${audited.toLocaleString()} / ${total.toLocaleString()}`;
      detailEl.textContent = `Phase: ${phaseBit}`;
    }
    pctEl.textContent = `${pct}%`;
    bar.style.width = `${pct}%`;
    return;
  }

  if (phase) {
    labelEl.textContent = phaseLabel(phase);
    pctEl.textContent = info.complete ? '100%' : '0%';
    bar.style.width = info.complete ? '100%' : '0%';
    detailEl.textContent = info.complete
      ? 'Job finished. Refresh status or publish if needed.'
      : `Phase: ${phaseLabel(phase)}`;
    return;
  }

  labelEl.textContent = 'No active job';
  pctEl.textContent = '0%';
  bar.style.width = '0%';
  detailEl.textContent = 'Idle — start a sync or refresh status.';
}

function rememberButtonLabels() {
  for (const id of ACTION_BUTTON_IDS) {
    const btn = $(id);
    if (btn && !buttonLabels.has(id)) buttonLabels.set(id, btn.textContent || '');
  }
  const stop = $('erp-sync-stop');
  if (stop && !buttonLabels.has('erp-sync-stop')) {
    buttonLabels.set('erp-sync-stop', stop.textContent || 'Stop');
  }
}

function setStopVisible(visible) {
  const stop = $('erp-sync-stop');
  if (!stop) return;
  stop.classList.toggle('hidden', !visible);
  stop.disabled = !visible;
}

function setBusy(active, {activeId = null, workingLabel = 'Working…', allowStop = false} = {}) {
  rememberButtonLabels();
  for (const id of ACTION_BUTTON_IDS) {
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
  const stop = $('erp-sync-stop');
  if (stop) {
    if (!active) {
      stop.textContent = buttonLabels.get('erp-sync-stop') || 'Stop';
    }
  }
  setStopVisible(active && allowStop);
  if (!active) {
    const bar = $('erp-sync-progress-bar');
    bar?.classList.remove('is-indeterminate');
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function canShowErpSync() {
  return isDevHost() && Boolean(getUser()?.is_super);
}

export async function loadErpSyncPanel() {
  if (!canShowErpSync()) return;
  try {
    const data = await api('erp-sync/status');
    applyConfig(data.config || {});
    const statusEl = $('erp-sync-status');
    if (statusEl) statusEl.textContent = formatStatus(data);
    updateProgressUI(extractProgress(data));
  } catch (err) {
    setMsg(err.message || 'Could not load ERP sync config', true);
  }
}

async function saveConfig() {
  setBusy(true, {activeId: 'erp-sync-save', workingLabel: 'Saving…'});
  setMsg('Saving…');
  let extra_headers;
  try {
    extra_headers = parseExtraHeaders();
  } catch (err) {
    setBusy(false);
    setMsg(err.message, true);
    return;
  }
  const body = {
    report_url: $('erp-sync-url')?.value?.trim() || '',
    http_method: $('erp-sync-method')?.value || 'GET',
    extra_headers,
    rows_path: $('erp-sync-rows-path')?.value?.trim() || '',
    enabled: Boolean($('erp-sync-enabled')?.checked),
    auto_publish: Boolean($('erp-sync-auto-publish')?.checked),
    batch_size: Number($('erp-sync-batch-size')?.value || 10),
    max_leads_per_run: Number($('erp-sync-max-leads')?.value || 40),
    field_map: readFieldMapFromUi()
  };
  const cookie = $('erp-sync-cookie')?.value?.trim() || '';
  if (cookie) body.cookie = cookie;
  const cron = $('erp-sync-cron-secret')?.value?.trim() || '';
  if (cron) body.cron_secret = cron;
  try {
    const data = await api('erp-sync/config', {method: 'POST', body});
    applyConfig(data.config || {});
    setMsg(data.message || 'Saved');
  } catch (err) {
    setMsg(err.message || 'Save failed', true);
  } finally {
    setBusy(false);
  }
}

async function saveConfigQuiet() {
  let extra_headers;
  try {
    extra_headers = parseExtraHeaders();
  } catch {
    return;
  }
  const body = {
    report_url: $('erp-sync-url')?.value?.trim() || '',
    http_method: $('erp-sync-method')?.value || 'GET',
    extra_headers,
    rows_path: $('erp-sync-rows-path')?.value?.trim() || '',
    enabled: Boolean($('erp-sync-enabled')?.checked),
    auto_publish: Boolean($('erp-sync-auto-publish')?.checked),
    batch_size: Number($('erp-sync-batch-size')?.value || 10),
    max_leads_per_run: Number($('erp-sync-max-leads')?.value || 40),
    field_map: readFieldMapFromUi()
  };
  const cookie = $('erp-sync-cookie')?.value?.trim() || '';
  if (cookie) body.cookie = cookie;
  const cron = $('erp-sync-cron-secret')?.value?.trim() || '';
  if (cron) body.cron_secret = cron;
  const data = await api('erp-sync/config', {method: 'POST', body});
  applyConfig(data.config || {});
}

async function testFetch() {
  setBusy(true, {activeId: 'erp-sync-test', workingLabel: 'Testing…'});
  setMsg('Fetching…');
  setProgressIndeterminate(true, 'Test fetch…');
  $('erp-sync-preview').textContent = '';
  try {
    await saveConfigQuiet();
    const data = await api('erp-sync/test-fetch', {method: 'POST', body: {}});
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
      audited: 0,
      total: mapping.lead_count ?? preview.row_count ?? null,
      phase: 'map',
      needsContinue: false,
      complete: false,
      error: null
    });
    await refreshStatus({keepBusy: true});
  } catch (err) {
    setMsg(err.message || 'Test fetch failed', true);
    updateProgressUI({phase: 'error', error: err.message || 'Test fetch failed', needsContinue: false, complete: false, audited: null, total: null});
    if (err.data?.session_expired) {
      $('erp-sync-cookie-hint').textContent = 'Session expired — paste a fresh Cookie header and Save settings.';
    }
  } finally {
    setBusy(false);
  }
}

/**
 * @returns {Promise<object|null>} run payload or null on hard failure already messaged
 */
async function runSyncOnce({forceFetch = true, dryRun = false} = {}) {
  if (forceFetch) await saveConfigQuiet();
  const data = await api('erp-sync/run', {
    method: 'POST',
    body: {force_fetch: forceFetch, dry_run: dryRun}
  });
  updateProgressUI(extractProgress(data));
  return data;
}

function applyRunMessage(data) {
  if (!data) return;
  if (data.ok === false) {
    setMsg(data.error || 'Run failed', true);
    if (data.session_expired) {
      $('erp-sync-cookie-hint').textContent = 'Session expired — paste a fresh Cookie header and Save settings.';
    }
    return;
  }
  if (data.partial || data.needs_continue) {
    const done = data.audited ?? data.done;
    const total = data.total ?? data.lead_count;
    setMsg(data.message || `Partial: ${done}/${total} — continue audit`);
    return;
  }
  setMsg(
    data.auto_publish
      ? `Done — published ${data.published_count || 0} board(s)`
      : `Done — ${data.result_count ?? data.audited ?? data.done ?? 0} results (auto-publish off; use Publish last results)`
  );
}

async function runSync({forceFetch = true, dryRun = false} = {}) {
  const activeId = forceFetch ? 'erp-sync-run' : 'erp-sync-continue';
  const workingLabel = forceFetch ? 'Starting…' : 'Continuing…';
  setBusy(true, {activeId, workingLabel});
  setMsg(forceFetch ? 'Running sync (fetch + audit)…' : 'Continuing audit…');
  setProgressIndeterminate(true, forceFetch ? 'Starting sync…' : 'Continuing audit…');
  try {
    const data = await runSyncOnce({forceFetch, dryRun});
    applyRunMessage(data);
    await refreshStatus({keepBusy: true});
  } catch (err) {
    setMsg(err.message || 'Run failed', true);
    updateProgressUI({phase: 'error', error: err.message || 'Run failed', needsContinue: false, complete: false, audited: null, total: null});
    if (err.data?.session_expired) {
      $('erp-sync-cookie-hint').textContent = 'Session expired — paste a fresh Cookie header and Save settings.';
    }
  } finally {
    setBusy(false);
  }
}

async function autoContinueUntilDone() {
  if (autoContinueActive) return;
  autoContinueActive = true;
  autoContinueStop = false;
  setBusy(true, {
    activeId: 'erp-sync-auto-continue',
    workingLabel: 'Auto-continuing…',
    allowStop: true
  });
  setMsg('Auto-continue started…');
  setProgressIndeterminate(true, 'Auto-continue…');

  try {
    // Only resume an incomplete audit job — never re-fetch as part of auto-continue.
    let statusData;
    try {
      statusData = await api('erp-sync/status');
    } catch (err) {
      setMsg(err.message || 'Could not read job status', true);
      return;
    }
    const starting = extractProgress(statusData);
    updateProgressUI(starting);
    statusElWrite(statusData);
    if (starting.complete) {
      setMsg('Audit already complete — nothing to auto-continue. Use Start / Run sync for a fresh fetch.');
      return;
    }
    if (!starting.needsContinue && statusData?.job?.status !== 'auditing') {
      setMsg('No incomplete audit job — use Start / Run sync first, then Auto-continue.');
      return;
    }

    let rounds = 0;
    while (!autoContinueStop) {
      rounds += 1;
      setBusy(true, {
        activeId: 'erp-sync-auto-continue',
        workingLabel: `Auto-continuing… (#${rounds})`,
        allowStop: true
      });
      setMsg(`Auto-continue round ${rounds}…`);
      if (rounds === 1) setProgressIndeterminate(true, `Auto-continue #${rounds}…`);

      let data;
      try {
        data = await runSyncOnce({forceFetch: false, dryRun: false});
      } catch (err) {
        setMsg(err.message || 'Auto-continue failed', true);
        updateProgressUI({
          phase: 'error',
          error: err.message || 'Auto-continue failed',
          needsContinue: false,
          complete: false,
          audited: null,
          total: null
        });
        if (err.data?.session_expired) {
          $('erp-sync-cookie-hint').textContent = 'Session expired — paste a fresh Cookie header and Save settings.';
        }
        break;
      }

      const progress = extractProgress(data);
      updateProgressUI(progress);

      if (data.ok === false) {
        applyRunMessage(data);
        break;
      }

      if (progress.complete || (!progress.needsContinue && !data.partial)) {
        applyRunMessage(data);
        setMsg(data.message || `Auto-continue finished after ${rounds} round(s).`);
        break;
      }

      applyRunMessage(data);
      if (autoContinueStop) {
        setMsg(`Stopped after ${rounds} round(s). Progress kept — use Continue to resume.`);
        break;
      }
      await sleep(AUTO_CONTINUE_DELAY_MS);
      if (autoContinueStop) {
        setMsg(`Stopped after ${rounds} round(s). Progress kept — use Continue to resume.`);
        break;
      }
    }

    await refreshStatus({keepBusy: true});
  } finally {
    autoContinueActive = false;
    autoContinueStop = false;
    setBusy(false);
  }
}

function statusElWrite(payload) {
  const statusEl = $('erp-sync-status');
  if (statusEl) statusEl.textContent = formatStatus(payload);
}

function stopAutoContinue() {
  if (!autoContinueActive) return;
  autoContinueStop = true;
  setMsg('Stopping after current round…');
  const stop = $('erp-sync-stop');
  if (stop) {
    stop.disabled = true;
    stop.textContent = 'Stopping…';
  }
}

async function publishLast() {
  setBusy(true, {activeId: 'erp-sync-publish', workingLabel: 'Publishing…'});
  setMsg('Publishing…');
  setProgressIndeterminate(true, 'Publishing…');
  try {
    const data = await api('erp-sync/publish', {method: 'POST', body: {}});
    setMsg(data.message || `Published ${(data.published || []).length} board(s)`);
    await refreshStatus({keepBusy: true});
  } catch (err) {
    setMsg(err.message || 'Publish failed', true);
    updateProgressUI({phase: 'error', error: err.message || 'Publish failed', needsContinue: false, complete: false, audited: null, total: null});
  } finally {
    setBusy(false);
  }
}

async function refreshStatus({keepBusy = false} = {}) {
  if (!keepBusy) {
    setBusy(true, {activeId: 'erp-sync-refresh-status', workingLabel: 'Refreshing…'});
  }
  try {
    const data = await api('erp-sync/status');
    const statusEl = $('erp-sync-status');
    if (statusEl) statusEl.textContent = formatStatus(data);
    updateProgressUI(extractProgress(data));
    if (!keepBusy) setMsg('');
  } catch (err) {
    setMsg(err.message || 'Status refresh failed', true);
  } finally {
    if (!keepBusy) setBusy(false);
  }
}

export function mountErpSyncPanel({toast, showView} = {}) {
  const nav = $('nav-erp-sync');
  if (!canShowErpSync()) {
    nav?.classList.add('hidden');
    return;
  }
  nav?.classList.remove('hidden');
  rememberButtonLabels();

  $('erp-sync-save')?.addEventListener('click', () => {
    saveConfig().then(() => toast?.('ERP sync settings saved'));
  });
  $('erp-sync-test')?.addEventListener('click', () => testFetch());
  $('erp-sync-run')?.addEventListener('click', () => runSync({forceFetch: true, dryRun: false}));
  $('erp-sync-continue')?.addEventListener('click', () => runSync({forceFetch: false, dryRun: false}));
  $('erp-sync-auto-continue')?.addEventListener('click', () => autoContinueUntilDone());
  $('erp-sync-stop')?.addEventListener('click', () => stopAutoContinue());
  $('erp-sync-publish')?.addEventListener('click', () => publishLast());
  $('erp-sync-refresh-status')?.addEventListener('click', () => refreshStatus());

  // Lazy-load when navigating is handled by showView("erp-sync").
}

/**
 * /dev Super User ERP Sync panel — config, test fetch, run, publish.
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
  } catch (err) {
    setMsg(err.message || 'Could not load ERP sync config', true);
  }
}

async function saveConfig() {
  setMsg('Saving…');
  let extra_headers;
  try {
    extra_headers = parseExtraHeaders();
  } catch (err) {
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
  }
}

async function testFetch() {
  setMsg('Fetching…');
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
    await refreshStatus();
  } catch (err) {
    setMsg(err.message || 'Test fetch failed', true);
    if (err.data?.session_expired) {
      $('erp-sync-cookie-hint').textContent = 'Session expired — paste a fresh Cookie header and Save.';
    }
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

async function runSync({forceFetch = true, dryRun = false} = {}) {
  setMsg(forceFetch ? 'Running sync (fetch + audit)…' : 'Continuing audit…');
  try {
    if (forceFetch) await saveConfigQuiet();
    const data = await api('erp-sync/run', {
      method: 'POST',
      body: {force_fetch: forceFetch, dry_run: dryRun}
    });
    if (data.ok === false) {
      setMsg(data.error || 'Run failed', true);
    } else if (data.partial) {
      setMsg(data.message || `Partial: ${data.done}/${data.lead_count} — click Continue`);
    } else {
      setMsg(
        data.auto_publish
          ? `Done — published ${data.published_count || 0} board(s)`
          : `Done — ${data.result_count || 0} results (auto-publish off; use Publish last results)`
      );
    }
    await refreshStatus();
  } catch (err) {
    setMsg(err.message || 'Run failed', true);
  }
}

async function publishLast() {
  setMsg('Publishing…');
  try {
    const data = await api('erp-sync/publish', {method: 'POST', body: {}});
    setMsg(data.message || `Published ${(data.published || []).length} board(s)`);
    await refreshStatus();
  } catch (err) {
    setMsg(err.message || 'Publish failed', true);
  }
}

async function refreshStatus() {
  try {
    const data = await api('erp-sync/status');
    const statusEl = $('erp-sync-status');
    if (statusEl) statusEl.textContent = formatStatus(data);
  } catch (err) {
    setMsg(err.message || 'Status refresh failed', true);
  }
}

export function mountErpSyncPanel({toast, showView} = {}) {
  const nav = $('nav-erp-sync');
  if (!canShowErpSync()) {
    nav?.classList.add('hidden');
    return;
  }
  nav?.classList.remove('hidden');

  $('erp-sync-save')?.addEventListener('click', () => {
    saveConfig().then(() => toast?.('ERP sync settings saved'));
  });
  $('erp-sync-test')?.addEventListener('click', () => testFetch());
  $('erp-sync-run')?.addEventListener('click', () => runSync({forceFetch: true, dryRun: false}));
  $('erp-sync-continue')?.addEventListener('click', () => runSync({forceFetch: false, dryRun: false}));
  $('erp-sync-publish')?.addEventListener('click', () => publishLast());
  $('erp-sync-refresh-status')?.addEventListener('click', () => refreshStatus());

  // Lazy-load when navigating is handled by showView("erp-sync").
}

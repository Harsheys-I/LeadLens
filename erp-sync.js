/**
 * ERP Sync Super User module — GitHub Actions dispatch + live audit/status.
 */
import {APP_VERSION} from './audit.js?v=10.0.0.stable';
import {api} from './api-client.js?v=10.0.0.stable';
import {requireAuth, logout, getUser, changePassword, updateProfile} from './auth.js?v=10.0.0.stable';
import {mountNotifications} from './notifications-ui.js?v=10.0.0.stable';
import {appUrl, homePath} from './app-base.js?v=10.0.0.stable';
import {initTheme} from './theme.js?v=10.0.0.stable';

const $ = (id) => document.getElementById(id);

/** GitHub Actions Bucket 1 audit: leads per OpenAI call, and calls in flight. */
const GHA_AUDIT_BATCH = 20;
const GHA_AUDIT_PARALLEL = 4;

let pollTimer = 0;
let busy = false;

function toast(message) {
  const el = $('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 3200);
}

function setMsg(text, isError = false) {
  const el = $('erp-sync-message');
  if (!el) return;
  el.textContent = text || '';
  el.style.color = isError ? 'var(--danger, #b42318)' : '';
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

function formatElapsed(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatCost(inr) {
  const n = Number(inr) || 0;
  if (!n) return '₹0.00';
  if (n < 0.01) return `₹${n.toFixed(4)}`;
  if (n < 100) return `₹${n.toFixed(2)}`;
  return `₹${n.toLocaleString('en-IN', {maximumFractionDigits: 2})}`;
}

/** Short server-audit rate note. */
export function throttleNote(t) {
  if (!t) return '';
  const bits = [`parallel ${t.concurrency}/${t.target_concurrency}`, `batch ${t.batch_size}`];
  if (t.rate_limited) bits.push(`rate-limited ${t.rate_limited}×`);
  const pauseSec = t.paused_until ? Math.round((Date.parse(t.paused_until) - Date.now()) / 1000) : 0;
  if (pauseSec > 0) bits.push(`paused ${pauseSec}s`);
  if (t.retry_queue) bits.push(`${t.retry_queue} batch(es) to retry`);
  if (t.errored_leads) bits.push(`${t.errored_leads} lead(s) errored`);
  return bits.join(' · ');
}

export function canShowErpSync() {
  return Boolean(getUser()?.is_super);
}

export function applyErpSyncNavVisibility() {
  /* legacy TeleCallerAudit hook — no-op in standalone module */
}

function ghaConclusionLine(gha) {
  if (!gha?.configured) {
    return 'GitHub PAT not configured — set github.token in api/config.local.php (Actions: write + Contents: read).';
  }
  if (gha.error) return `GHA status error: ${gha.error}`;
  const latest = gha.latest;
  if (!latest) return 'No workflow runs yet.';
  const when = formatIst(latest.updated_at || latest.created_at);
  const conc = latest.conclusion || latest.status || '—';
  const link = latest.url ? ` · ${latest.url}` : '';
  return `Latest run #${latest.run_number || latest.id}: ${conc} · ${when}${link}`;
}

function renderApiUploads(rows) {
  const el = $('erp-sync-api-uploads');
  if (!el) return;
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    el.textContent = 'No API uploads yet.';
    return;
  }
  el.replaceChildren();
  for (const row of list) {
    const line = document.createElement('p');
    line.style.margin = '0 0 0.7rem';
    const kind = String(row.kind || 'bucket1');
    const label = kind === 'performance' ? 'Performance' : (kind === 'sales' || kind === 'sales_graph' ? 'Sales Graph' : 'Bucket 1');
    const audited = Number(row.audited || 0);
    const total = Number(row.lead_count || 0);
    const status = String(row.status || 'unknown');
    const progress = kind !== 'performance' && kind !== 'sales' && status === 'auditing' && total
      ? ` ${audited}/${total}`
      : '';
    const batch = Number(row.batch_size) || (kind === 'bucket1' || !row.kind ? GHA_AUDIT_BATCH : 0);
    const parallel = Number(row.concurrency) || (kind === 'bucket1' || !row.kind ? GHA_AUDIT_PARALLEL : 0);
    const usage = row.usage || {};
    const bits = [
      formatIst(row.started_at),
      label,
      row.source_file || 'file',
      kind === 'performance' ? `${total || 0} TeleCallers` : `${total || 0} leads`,
      `${Number(row.row_count || 0)} rows`,
      row.uploaded_by ? `by ${row.uploaded_by}` : '',
      status + progress,
      batch && parallel ? `batch ${batch} · parallel ${parallel}` : '',
      usage.input || usage.output
        ? `tokens in ${Number(usage.input || 0).toLocaleString()} · cached ${Number(usage.cached || 0).toLocaleString()} · out ${Number(usage.output || 0).toLocaleString()}`
        : '',
      row.estimated_cost != null && row.estimated_cost !== '' ? `cost ${formatCost(row.estimated_cost)}` : '',
      row.elapsed_seconds != null && row.elapsed_seconds !== '' ? `elapsed ${formatElapsed(row.elapsed_seconds)}` : '',
      row.throttle?.slowed ? `slowed: ${throttleNote(row.throttle)}` : ''
    ].filter(Boolean);
    line.textContent = bits.join(' · ');
    if (row.error) line.textContent += ` — ${row.error}`;
    if (row.published_at) line.textContent += ` · published ${formatIst(row.published_at)}`;
    el.append(line);
  }
}

function pickUpload(rows, kinds) {
  const list = Array.isArray(rows) ? rows : [];
  const want = new Set(kinds);
  return list.find((r) => want.has(String(r.kind || 'bucket1'))) || null;
}

function paintBucket1(status) {
  const el = $('erp-bucket1-body');
  if (!el) return;
  const prog = status.progress || {};
  const job = status.job || {};
  const gha = status.gha || {};
  const next = status.next_runs?.bucket1 || gha.next_runs?.bucket1;
  const upload = pickUpload(status.api_uploads, ['bucket1']);
  const lines = [];
  lines.push(`Next scheduled: ${next?.label || next?.at_ist || '—'}`);
  lines.push(`Audit defaults: batch ${GHA_AUDIT_BATCH} · parallel ${GHA_AUDIT_PARALLEL}`);
  if (gha.latest) {
    lines.push(`GHA: ${gha.latest.conclusion || gha.latest.status} · ${formatIst(gha.latest.updated_at || gha.latest.created_at)}`);
  }
  const uploadHasRun = upload && (
    upload.usage || upload.estimated_cost != null || upload.elapsed_seconds != null || upload.audited != null
  );
  if (uploadHasRun && !(prog.running && Number(prog.audited || 0) > 0 && !upload.usage)) {
    const done = Number(upload.audited ?? 0);
    const total = Number(upload.lead_count || 0);
    const batch = Number(upload.batch_size) || GHA_AUDIT_BATCH;
    const parallel = Number(upload.concurrency) || GHA_AUDIT_PARALLEL;
    lines.push(`Upload log: ${upload.status || '—'} · ${done.toLocaleString()}/${total ? total.toLocaleString() : '…'} · ${upload.source_file || ''}`);
    lines.push(`Batch ${batch} · parallel ${parallel}`);
    if (upload.started_at) lines.push(`Started: ${formatIst(upload.started_at)}`);
    const u = upload.usage || {};
    lines.push(`Tokens: in ${Number(u.input || 0).toLocaleString()} · cached ${Number(u.cached || 0).toLocaleString()} · out ${Number(u.output || 0).toLocaleString()}`);
    lines.push(`Elapsed: ${formatElapsed(upload.elapsed_seconds)} · Est. cost: ${formatCost(upload.estimated_cost)}`);
    if (upload.published_at) lines.push(`Published: ${formatIst(upload.published_at)}`);
    if (upload.error) lines.push(`Error: ${upload.error}`);
  } else if (prog.running || prog.status === 'auditing') {
    const done = Number(prog.audited ?? job.audited ?? 0);
    const total = Number(prog.total ?? job.total ?? 0);
    lines.push(`Audit: ${done.toLocaleString()}/${total ? total.toLocaleString() : '…'} (${prog.status})`);
    lines.push(`Elapsed: ${formatElapsed(prog.elapsed_seconds)}`);
    const u = prog.usage || {};
    lines.push(`Tokens: in ${Number(u.input || 0).toLocaleString()} · cached ${Number(u.cached || 0).toLocaleString()} · out ${Number(u.output || 0).toLocaleString()}`);
    lines.push(`Est. cost: ${formatCost(prog.estimated_cost)}`);
    const rate = throttleNote(prog.throttle);
    if (rate) lines.push(rate);
  } else if (job.status) {
    lines.push(`Last job: ${job.status}${job.source_file ? ` · ${job.source_file}` : ''}`);
    if (job.started_at) lines.push(`Started: ${formatIst(job.started_at)}`);
    if (prog.usage) {
      const u = prog.usage;
      lines.push(`Tokens: in ${Number(u.input || 0).toLocaleString()} · cached ${Number(u.cached || 0).toLocaleString()} · out ${Number(u.output || 0).toLocaleString()}`);
      lines.push(`Elapsed: ${formatElapsed(prog.elapsed_seconds)} · Est. cost: ${formatCost(prog.estimated_cost)}`);
    }
    if (job.error) lines.push(`Error: ${job.error}`);
  } else if (upload) {
    lines.push(`Last upload: ${upload.status} · ${formatIst(upload.started_at)}`);
    lines.push(`${upload.lead_count || 0} leads · ${upload.source_file || ''}`);
  } else {
    lines.push('No Lead Audit run yet.');
  }
  el.textContent = lines.join('\n');
  el.style.color = (prog.status === 'error' || job.error) ? 'var(--danger, #b42318)' : '';
}

function paintPerf(status) {
  const el = $('erp-perf-body');
  if (!el) return;
  const gha = status.gha || {};
  const next = status.next_runs?.perf || gha.next_runs?.perf;
  const upload = pickUpload(status.api_uploads, ['performance']);
  const lines = [];
  lines.push(`Next scheduled: ${next?.label || next?.at_ist || '—'}`);
  if (upload) {
    lines.push(`Last: ${upload.status} · ${formatIst(upload.published_at || upload.started_at)}`);
    lines.push(`${upload.lead_count || 0} TeleCallers · ${upload.source_file || ''}`);
    if (upload.error) lines.push(`Error: ${upload.error}`);
  } else {
    lines.push('No Performance upload yet.');
  }
  el.textContent = lines.join('\n');
  el.style.color = upload?.error ? 'var(--danger, #b42318)' : '';
}

function paintSales(status) {
  const el = $('erp-sales-body');
  if (!el) return;
  const gha = status.gha || {};
  const next = status.next_runs?.sales || gha.next_runs?.sales;
  const upload = pickUpload(status.api_uploads, ['sales', 'sales_graph']);
  const lines = [];
  lines.push(`Next scheduled: ${next?.label || next?.at_ist || '—'}`);
  lines.push('Note: Sales Graph cURLs are placeholders until configured in automation.');
  if (upload) {
    lines.push(`Last: ${upload.status} · ${formatIst(upload.published_at || upload.started_at)}`);
    lines.push(`${upload.source_file || ''} · ${upload.lead_count != null ? upload.lead_count + ' items' : ''}`);
    if (upload.error) lines.push(`Error: ${upload.error}`);
  } else {
    lines.push('No Sales Graph upload yet.');
  }
  el.textContent = lines.join('\n');
  el.style.color = upload?.error ? 'var(--danger, #b42318)' : '';
}

function paintStopButton(status) {
  const stop = $('erp-sync-cancel');
  if (!stop) return;
  const running = Boolean(status.progress?.running || status.progress?.status === 'auditing');
  stop.classList.toggle('hidden', !running);
}

let lastDiagnose = null;

function paintDiagnose(payload) {
  const diag = payload?.diagnose || payload;
  lastDiagnose = diag || null;
  const pre = $('erp-diag-json');
  const hintsEl = $('erp-diag-hints');
  if (pre) {
    pre.textContent = diag ? JSON.stringify(diag, null, 2) : 'No diagnose payload.';
  }
  if (hintsEl) {
    const hints = Array.isArray(diag?.hints) ? diag.hints : [];
    hintsEl.textContent = hints.length
      ? `Hints:\n• ${hints.join('\n• ')}`
      : (diag ? 'No automatic hints — copy the JSON below if something still looks wrong.' : '');
    hintsEl.style.color = hints.length ? 'var(--amber, #b54708)' : '';
  }
}

async function refreshDiagnose() {
  const data = await api('erp-sync/diagnose');
  paintDiagnose(data);
  return data;
}

async function copyDiagnoseReport() {
  if (!lastDiagnose) {
    await refreshDiagnose();
  }
  const text = JSON.stringify(lastDiagnose || {}, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    toast('Diagnostics copied — paste in chat');
    setMsg('Diagnostics copied to clipboard');
  } catch {
    const pre = $('erp-diag-json');
    if (pre) {
      const range = document.createRange();
      range.selectNodeContents(pre);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    setMsg('Clipboard blocked — select the JSON and copy manually', true);
  }
}

async function kickContinue() {
  const btn = $('erp-diag-kick');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Kicking…';
  }
  try {
    const data = await api('erp-sync/kick', {method: 'POST', body: {}});
    paintDiagnose(data);
    setMsg(data.message || data.kick?.message || 'Kick continue sent');
    toast(data.kick?.busy ? 'Worker busy — see diagnose' : 'Kick continue sent');
    await refreshStatus();
  } catch (err) {
    setMsg(err.message || 'Kick failed', true);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Kick continue';
    }
  }
}

async function clearLock(force = false) {
  const id = force ? 'erp-diag-force-lock' : 'erp-diag-clear-lock';
  const btn = $(id);
  if (force && !window.confirm('Force-clear the run lock even if it looks fresh? Only if you are sure no PHP worker is still auditing.')) {
    return;
  }
  if (btn) btn.disabled = true;
  try {
    const data = await api('erp-sync/clear-lock', {method: 'POST', body: {force: Boolean(force)}});
    paintDiagnose(data);
    setMsg(data.message || (data.cleared ? 'Lock cleared' : 'No lock cleared'));
    toast(data.message || 'Lock updated');
    await refreshStatus();
  } catch (err) {
    setMsg(err.message || 'Clear lock failed', true);
    if (err.data) paintDiagnose(err.data);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function isActive(status) {
  if (status.progress?.running || status.progress?.status === 'auditing') return true;
  if (status.gha?.active) return true;
  return false;
}

async function refreshStatus() {
  const status = await api('erp-sync/status');
  const meta = $('erp-sync-gha-meta');
  if (meta) {
    const bits = [ghaConclusionLine(status.gha)];
    const d = status.last_dispatch || status.gha?.last_dispatch;
    if (d?.dispatched_at) {
      bits.push(`Last dispatch: ${(d.jobs || []).join(', ') || '—'} · ${formatIst(d.dispatched_at)}${d.dry_run ? ' · dry run' : ''}`);
    }
    meta.textContent = bits.join('\n');
  }
  renderApiUploads(status.api_uploads || []);
  paintBucket1(status);
  paintPerf(status);
  paintSales(status);
  paintStopButton(status);
  schedulePoll(isActive(status));

  if (status.auto_kick?.ok) {
    const why = status.auto_kick.reason || 'stuck';
    toast(why === 'progress_stall'
      ? 'Auto-heal: cleared hung worker and Kick continue'
      : 'Auto Kick continue — audit worker started');
    setMsg(`Auto Kick continue (${why})`);
    refreshDiagnose().catch(() => {});
  }

  // Client-side backup if the server did not auto-kick yet (older PHP) or still idle.
  const prog = status.progress || {};
  const stuckZero = prog.status === 'auditing'
    && Number(prog.audited || 0) === 0
    && Number(prog.elapsed_seconds || 0) >= 15;
  if (stuckZero || prog.status === 'auditing') {
    refreshDiagnose().then((data) => {
      const diag = data?.diagnose || data;
      const w = diag?.worker || {};
      const idle = !w.running && (w.has_chain_token || stuckZero);
      if (idle && Number(prog.elapsed_seconds || 0) >= 15) {
        maybeClientAutoKick();
      }
    }).catch(() => { /* keep last */ });
  }
  return status;
}

let lastClientAutoKick = 0;
async function maybeClientAutoKick() {
  const now = Date.now();
  if (now - lastClientAutoKick < 45000) return;
  lastClientAutoKick = now;
  try {
    setMsg('Auto Kick continue…');
    const data = await api('erp-sync/kick', {method: 'POST', body: {}});
    paintDiagnose(data);
    toast(data.message || 'Auto Kick continue');
    setMsg(data.message || 'Auto Kick continue');
  } catch (err) {
    setMsg(err.message || 'Auto Kick failed', true);
  }
}

function schedulePoll(active) {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = 0;
  }
  const ms = active ? 2000 : 10000;
  pollTimer = window.setInterval(() => {
    refreshStatus().catch(() => { /* keep last paint */ });
  }, ms);
}

function selectedJobs() {
  const jobs = [];
  if ($('erp-job-bucket1')?.checked) jobs.push('bucket1');
  if ($('erp-job-perf')?.checked) jobs.push('perf');
  if ($('erp-job-sales')?.checked) jobs.push('sales');
  return jobs;
}

async function runNow() {
  if (busy) return;
  const jobs = selectedJobs();
  if (!jobs.length) {
    setMsg('Select at least one pipeline.', true);
    return;
  }
  busy = true;
  const btn = $('erp-sync-run-now');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Dispatching…';
  }
  setMsg('Dispatching GitHub Actions…');
  try {
    const data = await api('erp-sync/trigger', {
      method: 'POST',
      body: {jobs, dry_run: Boolean($('erp-job-dry')?.checked)}
    });
    setMsg(data.message || `Dispatched: ${jobs.join(', ')}`);
    toast(data.message || 'Workflow dispatched');
    await refreshStatus();
  } catch (err) {
    setMsg(err.message || 'Dispatch failed', true);
  } finally {
    busy = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Run now';
    }
  }
}

async function stopAudit() {
  const btn = $('erp-sync-cancel');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Stopping…';
  }
  try {
    const data = await api('audit/cancel', {method: 'POST', body: {}});
    setMsg(data.message || 'Audit stopped');
    toast(data.message || 'Audit stopped');
    await refreshStatus();
  } catch (err) {
    setMsg(err.message || 'Could not stop the audit', true);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Stop audit';
    }
  }
}

/** Legacy exports for TeleCallerAudit (if still imported). */
export async function loadErpSyncPanel() {
  return refreshStatus();
}

export function mountErpSyncPanel() {
  /* standalone module boots itself */
}

function applySidebarCollapsed(collapsed, {persist = true} = {}) {
  document.querySelector('.shell')?.classList.toggle('sidebar-collapsed', collapsed);
  const btn = $('mobile-menu');
  if (btn) btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  if (persist) {
    try { localStorage.setItem('ll_sidebar_collapsed', collapsed ? '1' : '0'); } catch { /* ignore */ }
  }
}

function readSidebarCollapsedPref() {
  try { return localStorage.getItem('ll_sidebar_collapsed') === '1'; }
  catch { return false; }
}

async function bootErpSync() {
  initTheme();
  const ver = $('sidebar-version');
  if (ver) ver.textContent = 'v10.0.7.stable';

  const user = await requireAuth({loginPath: homePath()});
  if (!user) return;
  if (!user.is_super) {
    location.href = homePath();
    return;
  }

  applySidebarCollapsed(readSidebarCollapsedPref(), {persist: false});
  if ($('shell-user-label')) {
    $('shell-user-label').textContent = user.display_name || user.username;
  }

  $('erp-sync-run-now')?.addEventListener('click', () => runNow());
  $('erp-sync-refresh')?.addEventListener('click', () => {
    refreshStatus().then(() => toast('Refreshed')).catch((err) => setMsg(err.message || 'Refresh failed', true));
  });
  $('erp-sync-cancel')?.addEventListener('click', () => stopAudit());
  $('erp-diag-refresh')?.addEventListener('click', () => {
    refreshDiagnose().then(() => toast('Diagnose refreshed')).catch((err) => setMsg(err.message || 'Diagnose failed', true));
  });
  $('erp-diag-copy')?.addEventListener('click', () => copyDiagnoseReport());
  $('erp-diag-kick')?.addEventListener('click', () => kickContinue());
  $('erp-diag-clear-lock')?.addEventListener('click', () => clearLock(false));
  $('erp-diag-force-lock')?.addEventListener('click', () => clearLock(true));
  $('shell-logout')?.addEventListener('click', async () => {
    await logout();
    location.href = homePath();
  });
  $('mobile-menu')?.addEventListener('click', () => {
    applySidebarCollapsed(!document.querySelector('.shell')?.classList.contains('sidebar-collapsed'));
  });

  $('shell-account')?.addEventListener('click', () => {
    const modal = $('account-modal');
    if (!modal) return;
    const u = getUser();
    $('account-username').value = u?.username || '';
    $('account-display').value = u?.display_name || '';
    $('account-telecaller').value = u?.telecaller_name || '';
    $('account-pw-current').value = '';
    $('account-pw-new').value = '';
    $('account-pw-confirm').value = '';
    $('account-message').textContent = '';
    modal.classList.remove('hidden');
  });
  $('account-cancel')?.addEventListener('click', () => $('account-modal')?.classList.add('hidden'));
  $('account-save')?.addEventListener('click', async () => {
    const msg = $('account-message');
    if (!msg) return;
    msg.textContent = 'Saving…';
    try {
      const updated = await updateProfile({
        username: $('account-username').value.trim(),
        display_name: $('account-display').value.trim()
      });
      const pwCur = $('account-pw-current').value;
      const pwNew = $('account-pw-new').value;
      if (pwCur || pwNew) {
        if (pwNew !== $('account-pw-confirm').value) {
          msg.textContent = 'New passwords do not match.';
          return;
        }
        await changePassword(pwCur, pwNew);
      }
      if ($('shell-user-label')) {
        $('shell-user-label').textContent = updated.display_name || updated.username;
      }
      msg.textContent = 'Account updated.';
      toast('Account saved');
      setTimeout(() => $('account-modal')?.classList.add('hidden'), 400);
    } catch (err) {
      msg.textContent = err.message || 'Could not update account';
    }
  });

  $('reload-app')?.addEventListener('click', () => location.reload());

  mountNotifications({
    variant: 'chrome',
    onOpenAccessRequests: () => { location.href = appUrl('/admin/'); }
  });

  try {
    await refreshStatus();
    await refreshDiagnose();
  } catch (err) {
    setMsg(err.message || 'Could not load ERP Sync status', true);
  }
}

if (document.getElementById('view-ops')) {
  bootErpSync();
}

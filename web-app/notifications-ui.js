/**
 * Shared notifications bell + drawer for LeadLens shells (home, Admin, TeleCaller Audit).
 */
import {NotifApi} from './api-client.js?v=5.3';

const BELL_SVG = `<svg class="notif-bell-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5"/>
  <path d="M9.5 17a2.5 2.5 0 0 0 5 0"/>
</svg>`;

function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function typeIcon(type){
  if (type === 'dashboard_update' || type === 'perf_dashboard_update') {
    return `<span class="notif-type-icon notif-type-dash" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
    </span>`;
  }
  if (type === 'access_request') {
    return `<span class="notif-type-icon notif-type-access" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>
    </span>`;
  }
  return `<span class="notif-type-icon notif-type-generic" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
  </span>`;
}

function formatWhen(iso){
  if (!iso) return '';
  try {
    const d = new Date(String(iso).endsWith('Z') || String(iso).includes('+') ? iso : iso + 'Z');
    if (Number.isNaN(d.valueOf())) return '';
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return 'Just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return d.toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'});
  } catch {
    return '';
  }
}

function normalizedPath(){
  return location.pathname.replace(/\/index\.html$/i, '/');
}

function isHomeShell(){
  const path = normalizedPath();
  return path === '/' || path === '';
}

function isAdminShell(){
  return /\/admin\/?$/i.test(normalizedPath());
}

function isTeleCallerAuditShell(){
  return /\/TeleCallerAudit\/?$/i.test(normalizedPath());
}

function openDashboardFromNotification(opts){
  if (typeof opts.onDashboardUpdate === 'function') {
    opts.onDashboardUpdate();
    return;
  }
  if (isTeleCallerAuditShell()) return;
  location.href = '/TeleCallerAudit/#published';
}

function openPerfDashboardFromNotification(opts){
  if (typeof opts.onPerfDashboardUpdate === 'function') {
    opts.onPerfDashboardUpdate();
    return;
  }
  if (isTeleCallerAuditShell()) return;
  location.href = '/TeleCallerAudit/#perf-dashboard';
}

/**
 * @param {{onOpenAccessRequests?: () => void, onDashboardUpdate?: () => void, onPerfDashboardUpdate?: () => void, variant?: 'sidebar'|'chrome'}} opts
 */
export function mountNotifications(opts = {}){
  const bell = document.getElementById('notif-bell');
  const drawer = document.getElementById('notif-drawer');
  const list = document.getElementById('notif-list');
  const badge = document.getElementById('notif-count');
  const unreadLabel = document.getElementById('notif-unread-label');
  const markAll = document.getElementById('notif-mark-all');
  const clearAll = document.getElementById('notif-clear-all');
  const closeBtn = document.getElementById('notif-close');
  if (!bell || !drawer || !list) {
    return {refresh: async () => {}, destroy: () => {}};
  }

  if (!bell.querySelector('.notif-bell-icon')) {
    bell.insertAdjacentHTML('afterbegin', BELL_SVG);
  }
  if (opts.variant === 'chrome') bell.classList.add('notif-bell-chrome');

  let timer = null;
  const ac = new AbortController();

  async function refresh(){
    try {
      const data = await NotifApi.list();
      const count = data.unread || 0;
      if (badge) {
        badge.textContent = count > 99 ? '99+' : String(count);
        badge.classList.toggle('hidden', count < 1);
      }
      if (unreadLabel) {
        unreadLabel.textContent = count < 1
          ? 'You\'re all caught up'
          : `${count} unread`;
      }
      list.replaceChildren();
      const items = data.notifications || [];
      if (!items.length) {
        list.innerHTML = '<div class="notif-empty"><strong>No notifications yet</strong><span>Updates about dashboards and access requests will show up here.</span></div>';
        return;
      }
      for (const n of items) {
        const row = document.createElement('div');
        row.className = 'notif-item' + (n.is_read ? '' : ' unread');
        const when = formatWhen(n.created_at);
        row.innerHTML = `${typeIcon(n.type)}
          <span class="notif-item-body">
            <span class="notif-item-top">
              <strong>${escapeHtml(n.title)}</strong>
              ${n.is_read ? '' : '<span class="notif-unread-dot" title="Unread"></span>'}
            </span>
            <span class="notif-item-copy">${escapeHtml(n.body || '')}</span>
            ${when ? `<span class="notif-item-time">${escapeHtml(when)}</span>` : ''}
          </span>
          <button type="button" class="notif-dismiss" aria-label="Clear notification" title="Clear">×</button>`;
        row.addEventListener('click', async (e) => {
          if (e.target.closest('.notif-dismiss')) return;
          if (!n.is_read) {
            try { await NotifApi.markRead(n.id); } catch { /* ignore */ }
          }
          drawer.classList.add('hidden');
          if (n.type === 'access_request' && typeof opts.onOpenAccessRequests === 'function') {
            opts.onOpenAccessRequests();
          } else if (n.type === 'access_request' && (isHomeShell() || isAdminShell())) {
            location.href = '/admin/';
          } else if (n.type === 'dashboard_update') {
            openDashboardFromNotification(opts);
          } else if (n.type === 'perf_dashboard_update') {
            openPerfDashboardFromNotification(opts);
          }
          refresh();
        });
        row.querySelector('.notif-dismiss')?.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          try { await NotifApi.clearOne(n.id); } catch { /* ignore */ }
          refresh();
        });
        list.append(row);
      }
    } catch {
      /* ignore offline / unauth */
    }
  }

  function openDrawer(){
    drawer.classList.remove('hidden');
    refresh();
  }
  function closeDrawer(){
    drawer.classList.add('hidden');
  }
  function toggleDrawer(){
    if (drawer.classList.contains('hidden')) openDrawer();
    else closeDrawer();
  }

  bell.addEventListener('click', toggleDrawer, {signal: ac.signal});
  closeBtn?.addEventListener('click', closeDrawer, {signal: ac.signal});
  markAll?.addEventListener('click', async () => {
    try { await NotifApi.markAllRead(); } catch { /* ignore */ }
    refresh();
  }, {signal: ac.signal});
  clearAll?.addEventListener('click', async () => {
    if (!confirm('Clear all notifications?')) return;
    try { await NotifApi.clearAll(); } catch { /* ignore */ }
    refresh();
  }, {signal: ac.signal});
  drawer.addEventListener('click', (e) => {
    if (e.target === drawer) closeDrawer();
  }, {signal: ac.signal});

  refresh();
  timer = setInterval(refresh, 60_000);

  return {
    refresh,
    destroy(){
      if (timer) clearInterval(timer);
      ac.abort();
    }
  };
}

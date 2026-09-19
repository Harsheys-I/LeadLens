/**
 * Auth gate + GPP shell chrome for the SEO module.
 * Loads before app.js; keeps SEO dashboard behind LeadLens session.
 */
import {
  requireAuth,
  requirePermission,
  logout,
  getUser,
  changePassword,
  updateProfile,
} from '../auth.js?v=8.0.0.stable';
import {homePath} from '../app-base.js?v=8.0.0.stable';
import {
  initTheme,
  getThemePreference,
  setThemePreference,
  resolveTheme,
} from '../theme.js?v=8.0.0.stable';
import {mountNotifications} from '../notifications-ui.js?v=8.0.0.stable';

const APP_VERSION = '8.0.0.stable';

function $(id) {
  return document.getElementById(id);
}

function toast(message) {
  let el = $('seo-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'seo-toast';
    el.className = 'seo-toast';
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 3200);
}

function wireAccountModal() {
  const modal = $('account-modal');
  if (!modal) return;

  const open = () => {
    const user = getUser();
    if (!user) return;
    $('account-username').value = user.username || '';
    $('account-display').value = user.display_name || '';
    $('account-pw-current').value = '';
    $('account-pw-new').value = '';
    $('account-pw-confirm').value = '';
    $('account-message').textContent = '';
    modal.classList.remove('hidden');
  };

  const close = () => modal.classList.add('hidden');

  $('shell-account')?.addEventListener('click', open);
  $('account-cancel')?.addEventListener('click', close);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });

  $('account-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('account-message');
    msg.textContent = 'Saving…';
    try {
      await updateProfile({
        username: $('account-username').value.trim(),
        display_name: $('account-display').value.trim(),
      });
      const cur = $('account-pw-current').value;
      const next = $('account-pw-new').value;
      const conf = $('account-pw-confirm').value;
      if (cur || next || conf) {
        if (!cur || !next) throw new Error('Enter current and new password.');
        if (next !== conf) throw new Error('New passwords do not match.');
        await changePassword(cur, next);
      }
      msg.textContent = 'Saved.';
      const user = getUser();
      if ($('shell-user-label') && user) {
        $('shell-user-label').textContent =
          `${user.display_name || user.username} · ${user.role_name || ''}`.trim();
      }
      setTimeout(close, 600);
    } catch (err) {
      msg.textContent = err.message || 'Could not save';
    }
  });
}

function syncSeoThemeToggle() {
  const pref = getThemePreference();
  const resolved = resolveTheme(pref === 'system' ? 'system' : pref);
  const icon = $('themeIcon');
  const text = $('themeText');
  if (resolved === 'dark') {
    if (icon) icon.textContent = '☀';
    if (text) text.textContent = 'Light';
  } else {
    if (icon) icon.textContent = '☾';
    if (text) text.textContent = 'Dark';
  }
}

/** Bridge SEO's inline toggleTheme() to LeadLens theme preference. */
window.toggleTheme = function toggleThemeBridged() {
  const resolved = resolveTheme(getThemePreference());
  setThemePreference(resolved === 'dark' ? 'light' : 'dark');
  syncSeoThemeToggle();
};

/** Disable anti-devtools shield from the upstream SEO app. */
window.initSecurityShield = function noopSecurityShield() {};

async function boot() {
  initTheme();
  syncSeoThemeToggle();

  const user = await requireAuth({loginPath: homePath()});
  if (!user) return;
  if (!requirePermission('module.seo', {fallback: homePath()})) return;

  document.body.classList.remove('seo-auth-pending');
  document.body.classList.add('seo-ready');

  const label = $('shell-user-label');
  if (label) {
    label.textContent =
      `${user.display_name || user.username} · ${user.role_name || ''}`.trim();
  }

  const ver = $('sidebar-version');
  if (ver) ver.textContent = `v${APP_VERSION}`;

  $('shell-logout')?.addEventListener('click', async () => {
    await logout();
    location.href = homePath();
  });

  wireAccountModal();

  mountNotifications({
    variant: 'chrome',
    onOpenAccessRequests: () => {
      location.href = '../admin/';
    },
    onDashboardUpdate: () => {
      location.href = '../TeleCallerAudit/#published';
    },
    onPerfDashboardUpdate: () => {
      location.href = '../TeleCallerAudit/#perf-dashboard';
    },
  });

  // Let the upstream SEO app finish its own DOMContentLoaded work.
  window.dispatchEvent(new CustomEvent('seo-auth-ready', {detail: {user}}));
}

boot().catch((err) => {
  console.error(err);
  toast(err.message || 'Failed to open SEO module');
});

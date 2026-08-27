import {login, logout, loadSession, changePassword, updateProfile, moduleTilesForUser, hasSessionHint, getUser} from './auth.js?v=5.1.1';
import {AuthApi} from './api-client.js?v=5.1.1';
import {mountNotifications} from './notifications-ui.js?v=5.1.1';

const $ = id => document.getElementById(id);
let notifCtl = null;
const panelLogin = $('panel-login');
const panelRequest = $('panel-request');
const panelHome = $('panel-home');
const panelLoading = $('panel-loading');
const pwModal = $('password-modal');
const accountModal = $('account-modal');

function toast(message){
  const el = $('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 3200);
}

function showPanel(name){
  if (panelLoading) panelLoading.classList.toggle('hidden', name !== 'loading');
  panelLogin.classList.toggle('hidden', name !== 'login');
  panelRequest.classList.toggle('hidden', name !== 'request');
  panelHome.classList.toggle('hidden', name !== 'home');
  document.body.classList.toggle('home-mode', name === 'home');
  document.body.classList.toggle('auth-loading', name === 'loading');
}

function renderTiles(user){
  const mount = $('home-tiles');
  mount.replaceChildren();
  const tiles = moduleTilesForUser(user);
  if (!tiles.length) {
    mount.innerHTML = '<div class="empty-card">No modules are available for your role. Contact an admin.</div>';
    return;
  }
  for (const tile of tiles) {
    const btn = document.createElement(tile.soon ? 'div' : 'a');
    btn.className = 'home-tile' + (tile.soon ? ' is-soon' : '');
    if (!tile.soon) btn.href = tile.href;
    btn.innerHTML = `${tile.icon ? `<span class="home-tile-visual">${tile.icon}</span>` : ''}<strong class="home-tile-title">${tile.title}</strong><span class="home-tile-desc">${tile.desc}</span>${tile.soon ? '<em>Coming soon</em>' : ''}`;
    if (tile.soon) {
      btn.addEventListener('click', () => toast(`${tile.title} is coming soon.`));
    }
    mount.append(btn);
  }
}

function openPasswordModal(user){
  const eyebrow = $('pw-eyebrow');
  const title = $('pw-title');
  const copy = $('pw-copy');
  if (user?.is_super) {
    if (eyebrow) eyebrow.textContent = 'SUPER USER';
    if (title) title.textContent = 'Change Super User password';
  } else {
    if (eyebrow) eyebrow.textContent = 'SECURITY';
    if (title) title.textContent = 'Change your password';
  }
  if (copy) {
    copy.textContent = 'You’re using a temporary password. Choose a new password before continuing.';
  }
  pwModal.classList.remove('hidden');
  $('pw-current').value = '';
  $('pw-new').value = '';
  $('pw-confirm').value = '';
  $('pw-message').textContent = '';
}

function closePasswordModal(){
  pwModal.classList.add('hidden');
}

function openAccountModal(){
  const user = getUser();
  if (!user || !accountModal) return;
  $('account-username').value = user.username || '';
  $('account-display').value = user.display_name || '';
  $('account-telecaller').value = user.telecaller_name || '— set by Admin only —';
  $('account-pw-current').value = '';
  $('account-pw-new').value = '';
  $('account-pw-confirm').value = '';
  $('account-message').textContent = '';
  accountModal.classList.remove('hidden');
}

function closeAccountModal(){
  accountModal?.classList.add('hidden');
}

async function enterHome(user){
  $('home-user-label').textContent = `${user.display_name || user.username} · ${user.role_name}`;
  renderTiles(user);
  showPanel('home');
  notifCtl?.destroy?.();
  notifCtl = mountNotifications({
    variant: 'chrome',
    onOpenAccessRequests: () => { location.href = '/admin/'; },
    onDashboardUpdate: () => { location.href = '/TeleCallerAudit/#published'; },
  });
  if (user.must_change_password) openPasswordModal(user);

  const params = new URLSearchParams(location.search);
  const next = params.get('next');
  if (next && !user.must_change_password) {
    try {
      const url = new URL(next, location.origin);
      if (url.origin === location.origin) {
        location.href = url.pathname + url.search + url.hash;
      }
    } catch { /* ignore */ }
  }
}

$('show-request').onclick = () => showPanel('request');
$('back-login').onclick = () => showPanel('login');

$('login-form').onsubmit = async (e) => {
  e.preventDefault();
  const msg = $('login-message');
  msg.textContent = 'Signing in…';
  try {
    const user = await login($('login-username').value, $('login-password').value);
    msg.textContent = '';
    await enterHome(user);
  } catch (err) {
    msg.textContent = err.message || 'Sign in failed';
  }
};

$('request-form').onsubmit = async (e) => {
  e.preventDefault();
  const msg = $('request-message');
  msg.textContent = 'Submitting…';
  try {
    await AuthApi.requestAccess({
      full_name: $('req-name').value.trim(),
      email: '',
      requested_username: $('req-username').value.trim(),
      preferred_module: $('req-module').value,
      reason: $('req-reason').value.trim(),
    });
    msg.textContent = 'Request submitted. An admin will review it.';
    toast('Access request sent');
  } catch (err) {
    msg.textContent = err.message || 'Could not submit request';
  }
};

$('home-logout').onclick = async () => {
  notifCtl?.destroy?.();
  notifCtl = null;
  await logout();
  showPanel('login');
  toast('Signed out');
};

$('home-account')?.addEventListener('click', openAccountModal);
$('account-cancel')?.addEventListener('click', closeAccountModal);

$('account-save')?.addEventListener('click', async () => {
  const msg = $('account-message');
  msg.textContent = 'Saving…';
  try {
    const user = await updateProfile({
      username: $('account-username').value.trim(),
      display_name: $('account-display').value.trim(),
    });
    const pwCur = $('account-pw-current').value;
    const pwNew = $('account-pw-new').value;
    if (pwCur || pwNew) {
      if (pwNew !== $('account-pw-confirm').value) {
        msg.textContent = 'New passwords do not match.';
        return;
      }
      if (pwNew.length < 5) {
        msg.textContent = 'New password must be at least 5 characters.';
        return;
      }
      await changePassword(pwCur, pwNew);
    }
    msg.textContent = 'Account updated.';
    $('home-user-label').textContent = `${user.display_name || user.username} · ${user.role_name}`;
    toast('Account saved');
    setTimeout(closeAccountModal, 500);
  } catch (err) {
    msg.textContent = err.message || 'Could not update account';
  }
});

$('pw-save').onclick = async () => {
  const msg = $('pw-message');
  const next = $('pw-new').value;
  if (next !== $('pw-confirm').value) {
    msg.textContent = 'New passwords do not match.';
    return;
  }
  msg.textContent = 'Saving…';
  try {
    const user = await changePassword($('pw-current').value, next);
    msg.textContent = 'Password updated.';
    closePasswordModal();
    toast('Password changed');
    $('home-user-label').textContent = `${user.display_name || user.username} · ${user.role_name}`;
  } catch (err) {
    msg.textContent = err.message || 'Could not change password';
  }
};

(async function boot(){
  // Avoid login flash when a session cookie likely exists (Admin → Home).
  showPanel(hasSessionHint() ? 'loading' : 'loading');
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister())).catch(() => {});
  }
  try {
    const user = await loadSession();
    if (user) await enterHome(user);
    else showPanel('login');
  } catch (err) {
    showPanel('login');
    $('login-message').textContent = err.message?.includes('Database') || err.status === 503
      ? 'API not configured yet. Complete Hostinger MySQL setup and /api/install.php.'
      : '';
  }
})();

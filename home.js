import {login, logout, loadSession, changePassword, moduleTilesForUser} from './auth.js?v=5.0.0';
import {AuthApi} from './api-client.js?v=5.0.0';

const $ = id => document.getElementById(id);
const panelLogin = $('panel-login');
const panelRequest = $('panel-request');
const panelHome = $('panel-home');
const pwModal = $('password-modal');

function toast(message){
  const el = $('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 3200);
}

function showPanel(name){
  panelLogin.classList.toggle('hidden', name !== 'login');
  panelRequest.classList.toggle('hidden', name !== 'request');
  panelHome.classList.toggle('hidden', name !== 'home');
  document.body.classList.toggle('home-mode', name === 'home');
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
    btn.innerHTML = `<strong>${tile.title}</strong><span>${tile.desc}</span>${tile.soon ? '<em>Coming soon</em>' : ''}`;
    if (tile.soon) {
      btn.addEventListener('click', () => toast(`${tile.title} is coming soon.`));
    }
    mount.append(btn);
  }
}

function openPasswordModal(){
  pwModal.classList.remove('hidden');
  $('pw-current').value = '';
  $('pw-new').value = '';
  $('pw-confirm').value = '';
  $('pw-message').textContent = '';
}

function closePasswordModal(){
  pwModal.classList.add('hidden');
}

async function enterHome(user){
  $('home-user-label').textContent = `${user.display_name || user.username} · ${user.role_name}`;
  renderTiles(user);
  showPanel('home');
  if (user.must_change_password) openPasswordModal();

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
      email: $('req-email').value.trim(),
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
  await logout();
  showPanel('login');
  toast('Signed out');
};

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
  showPanel('login');
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister())).catch(() => {});
  }
  try {
    const user = await loadSession();
    if (user) await enterHome(user);
  } catch (err) {
    // API may be offline before install — stay on login
    $('login-message').textContent = err.message?.includes('Database') || err.status === 503
      ? 'API not configured yet. Complete Hostinger MySQL setup and /api/install.php.'
      : '';
  }
})();

import {requireAuth, logout, getUser, hasPermission, requirePermission, changePassword, updateProfile} from '../auth.js?v=5.0.2';
import {AdminApi, NotifApi, DashboardApi} from '../api-client.js?v=5.0.2';

const $ = id => document.getElementById(id);
const titles = {users: 'User creation', roles: 'Roles'};
let rolesCache = [];
let catalog = [];
let editingRole = null;
let telecallerNames = [];

function toast(msg){
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 3200);
}

function showView(name){
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${name}`));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  $('page-title').textContent = titles[name] || name;
  document.querySelector('.shell').classList.remove('menu-open');
  if (name === 'users') refreshUsers();
  if (name === 'roles') refreshRoles();
}

function actorRank(){
  const user = getUser();
  return Number(user?.role_rank ?? 0);
}

function fillRoleSelect(select, selectedId){
  select.replaceChildren();
  const maxRank = actorRank();
  const selected = selectedId != null && selectedId !== '' ? Number(selectedId) : null;
  for (const role of rolesCache) {
    const rank = Number(role.rank ?? 0);
    if (rank > maxRank && role.id !== selected) continue;
    const opt = document.createElement('option');
    opt.value = role.id;
    opt.textContent = `${role.name} (rank ${role.rank})`;
    if (selected != null && selected === role.id) opt.selected = true;
    select.append(opt);
  }
}

function roleNeedsTelecaller(roleId){
  const role = rolesCache.find(r => r.id === Number(roleId));
  return role?.role_key === 'telecaller';
}

function fillTelecallerSelect(select, selectedName){
  select.replaceChildren();
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '— None —';
  select.append(none);
  const names = [...telecallerNames];
  const current = String(selectedName || '').trim();
  if (current && !names.includes(current)) names.unshift(current);
  for (const name of names) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    if (current && name === current) opt.selected = true;
    select.append(opt);
  }
  if (!current) none.selected = true;
}

function syncTelecallerField(roleSelectId, wrapId, selectId, selectedName){
  const wrap = $(wrapId);
  const select = $(selectId);
  const needed = roleNeedsTelecaller($(roleSelectId).value);
  wrap.classList.toggle('hidden', !needed);
  select.disabled = !needed;
  if (needed) fillTelecallerSelect(select, selectedName ?? select.value);
  else {
    select.value = '';
  }
}

async function loadTelecallerNames(){
  try {
    const data = await DashboardApi.telecallerNames();
    telecallerNames = data.names || [];
  } catch {
    telecallerNames = [];
  }
}

async function loadRolesCache(){
  const data = await AdminApi.listRoles();
  rolesCache = data.roles || [];
  catalog = data.permission_catalog || [];
}

async function refreshUsers(){
  const mount = $('users-table');
  try {
    const [usersData, reqData] = await Promise.all([
      AdminApi.listUsers(),
      AdminApi.listAccessRequests('pending').catch(() => ({requests: []})),
    ]);
    renderAccessQueue(reqData.requests || []);
    renderUsersTable(usersData.users || []);
  } catch (err) {
    toast(err.message || 'Could not load users');
    mount.innerHTML = `<div class="empty-card">Could not load users. ${escapeHtml(err.message || '')}</div>`;
  }
}

function renderAccessQueue(requests){
  const mount = $('access-queue');
  mount.replaceChildren();
  if (!requests.length) return;
  const head = document.createElement('div');
  head.className = 'access-queue-head';
  head.innerHTML = `<strong>Pending access requests</strong><span>${requests.length}</span>`;
  mount.append(head);
  for (const req of requests) {
    const row = document.createElement('div');
    row.className = 'access-request-card';
    row.innerHTML = `<div><strong>${escapeHtml(req.full_name)}</strong>
      <p>${escapeHtml(req.email)}${req.preferred_module ? ' · ' + escapeHtml(req.preferred_module) : ''}</p>
      <p class="muted">${escapeHtml(req.reason || '')}</p></div>`;
    const actions = document.createElement('div');
    actions.className = 'inline-actions';
    const accept = document.createElement('button');
    accept.type = 'button';
    accept.className = 'primary-button';
    accept.textContent = 'Accept';
    accept.onclick = () => openApprove(req);
    const deny = document.createElement('button');
    deny.type = 'button';
    deny.className = 'danger-button';
    deny.textContent = 'Deny';
    deny.onclick = async () => {
      if (!confirm('Deny this request?')) return;
      try {
        await AdminApi.denyRequest(req.id, {review_note: 'Denied'});
        toast('Request denied');
        await refreshUsers();
        refreshNotifs();
      } catch (err) {
        toast(err.message || 'Could not deny request');
      }
    };
    actions.append(accept, deny);
    row.append(actions);
    mount.append(row);
  }
}

function renderUsersTable(users){
  const mount = $('users-table');
  if (!users.length) {
    mount.innerHTML = '<div class="empty-card">No users yet.</div>';
    return;
  }
  const table = document.createElement('table');
  table.className = 'admin-table';
  table.innerHTML = `<thead><tr>
    <th>Username</th><th>Display</th><th>Role</th><th>TeleCaller</th><th>Active</th><th></th>
  </tr></thead>`;
  const tbody = document.createElement('tbody');
  for (const u of users) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(u.username)}</td>
      <td>${escapeHtml(u.display_name || '')}</td>
      <td>${escapeHtml(u.role_name)}</td>
      <td>${escapeHtml(u.telecaller_name || '—')}</td>
      <td>${u.is_active ? 'Yes' : 'No'}</td>`;
    const td = document.createElement('td');
    const isSuperTarget = u.role_key === 'super';
    const actor = getUser();
    if (!(isSuperTarget && !actor?.is_super)) {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'text-button';
      edit.textContent = 'Edit';
      edit.onclick = () => openUserModal(u);
      td.append(edit);
    } else {
      td.textContent = '—';
    }
    tr.append(td);
    tbody.append(tr);
  }
  table.append(tbody);
  mount.replaceChildren(table);
}

function openUserModal(user = null){
  const actor = getUser();
  if (user?.role_key === 'super' && !actor?.is_super) {
    toast('Only Super User can edit Super User accounts');
    return;
  }
  $('user-modal-title').textContent = user ? 'Edit user' : 'New user';
  $('user-id').value = user?.id || '';
  $('user-username').value = user?.username || '';
  $('user-display').value = user?.display_name || '';
  $('user-password').value = '';
  $('user-password').required = !user;
  fillRoleSelect($('user-role'), user?.role_id);
  syncTelecallerField('user-role', 'user-telecaller-wrap', 'user-telecaller', user?.telecaller_name || '');
  $('user-notes').value = user?.notes || '';
  $('user-active').checked = user ? user.is_active : true;
  $('user-must-pw').checked = user ? !!user.must_change_password : true;
  $('user-delete').classList.toggle('hidden', !user || user.role_key === 'super');
  $('user-form-message').textContent = '';
  $('user-modal').classList.remove('hidden');
}

function closeUserModal(){
  $('user-modal').classList.add('hidden');
}

function openApprove(req){
  $('approve-id').value = req.id;
  $('approve-summary').textContent = `${req.full_name} · ${req.email}`;
  $('approve-username').value = req.requested_username || '';
  $('approve-display').value = req.full_name || '';
  $('approve-password').value = '';
  fillRoleSelect($('approve-role'), rolesCache.find(r => r.role_key === 'telecaller')?.id);
  syncTelecallerField('approve-role', 'approve-telecaller-wrap', 'approve-telecaller', '');
  $('approve-note').value = '';
  $('approve-message').textContent = '';
  $('approve-modal').classList.remove('hidden');
}

async function refreshRoles(){
  const mount = $('roles-panel');
  try {
    await loadRolesCache();
    mount.replaceChildren();
    if (!rolesCache.length) {
      mount.innerHTML = '<div class="empty-card">No roles yet.</div>';
      return;
    }
    for (const role of rolesCache) {
      const card = document.createElement('div');
      card.className = 'role-card';
      const perms = (role.permissions || []).slice(0, 8).join(', ') + ((role.permissions || []).length > 8 ? '…' : '');
      card.innerHTML = `<div><strong>${escapeHtml(role.name)}</strong>
        <p>Rank ${role.rank}${role.is_system ? ' · system' : ''}</p>
        <p class="muted">${escapeHtml(perms || 'No permissions')}</p></div>`;
      const isSuperRole = role.role_key === 'super';
      if (!isSuperRole) {
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'secondary-button';
        edit.textContent = 'Edit';
        edit.onclick = () => openRoleModal(role);
        card.append(edit);
      } else {
        const locked = document.createElement('span');
        locked.className = 'muted';
        locked.textContent = 'Locked';
        card.append(locked);
      }
      mount.append(card);
    }
  } catch (err) {
    toast(err.message || 'Could not load roles');
    mount.innerHTML = `<div class="empty-card">Could not load roles. ${escapeHtml(err.message || '')}</div>`;
  }
}

function openRoleModal(role = null){
  if (role?.role_key === 'super') {
    toast('Super User role cannot be edited');
    return;
  }
  editingRole = role;
  $('role-modal-title').textContent = role ? `Edit · ${role.name}` : 'New role';
  $('role-id').value = role?.id || '';
  $('role-name').value = role?.name || '';
  $('role-rank').value = role?.rank ?? 10;
  $('role-rank').disabled = false;
  $('role-delete').classList.toggle('hidden', !role || role.is_system);
  renderPermChecks(role?.permissions || []);
  $('role-form-message').textContent = '';
  $('role-modal').classList.remove('hidden');
}

function renderPermChecks(selected){
  const mount = $('role-perms');
  mount.replaceChildren();
  const groups = {};
  for (const p of catalog) {
    (groups[p.group] ||= []).push(p);
  }
  const selectedSet = new Set(selected);
  const locked = editingRole?.role_key === 'super';
  for (const [group, items] of Object.entries(groups)) {
    const g = document.createElement('div');
    g.className = 'perm-group';
    g.append(Object.assign(document.createElement('strong'), {textContent: group}));
    for (const item of items) {
      const label = document.createElement('label');
      label.className = 'check-row';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = item.id;
      input.checked = locked || selectedSet.has(item.id);
      input.disabled = locked;
      label.append(input, document.createElement('span'));
      label.querySelector('span').textContent = item.label;
      g.append(label);
    }
    mount.append(g);
  }
}

function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function refreshNotifs(){
  try {
    const data = await NotifApi.list();
    const count = data.unread || 0;
    const badge = $('notif-count');
    badge.textContent = String(count);
    badge.classList.toggle('hidden', count < 1);
    const list = $('notif-list');
    list.replaceChildren();
    for (const n of data.notifications || []) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'notif-item' + (n.is_read ? '' : ' unread');
      row.innerHTML = `<strong>${escapeHtml(n.title)}</strong><span>${escapeHtml(n.body || '')}</span>`;
      row.onclick = async () => {
        if (!n.is_read) await NotifApi.markRead(n.id);
        showView('users');
        $('notif-drawer').classList.add('hidden');
        refreshNotifs();
      };
      list.append(row);
    }
    if (!(data.notifications || []).length) {
      list.innerHTML = '<div class="empty-state">No notifications</div>';
    }
  } catch { /* ignore */ }
}

$('mobile-menu').onclick = () => document.querySelector('.shell').classList.toggle('menu-open');
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.perm && !hasPermission(btn.dataset.perm)) {
      toast('You do not have permission for this screen.');
      return;
    }
    showView(btn.dataset.view);
  });
});
$('shell-logout').onclick = async () => { await logout(); location.href = '/'; };
$('btn-new-user').onclick = () => openUserModal(null);
$('user-cancel').onclick = closeUserModal;
$('approve-cancel').onclick = () => $('approve-modal').classList.add('hidden');
$('btn-new-role').onclick = () => openRoleModal(null);
$('role-cancel').onclick = () => $('role-modal').classList.add('hidden');
$('user-role').addEventListener('change', () => {
  syncTelecallerField('user-role', 'user-telecaller-wrap', 'user-telecaller');
});
$('approve-role').addEventListener('change', () => {
  syncTelecallerField('approve-role', 'approve-telecaller-wrap', 'approve-telecaller');
});

$('user-form').onsubmit = async (e) => {
  e.preventDefault();
  const id = $('user-id').value;
  const body = {
    username: $('user-username').value.trim(),
    display_name: $('user-display').value.trim(),
    role_id: Number($('user-role').value),
    telecaller_name: roleNeedsTelecaller($('user-role').value) ? $('user-telecaller').value.trim() : '',
    notes: $('user-notes').value.trim(),
    is_active: $('user-active').checked,
    must_change_password: $('user-must-pw').checked,
  };
  const pw = $('user-password').value;
  if (pw) body.password = pw;
  try {
    if (id) await AdminApi.updateUser(Number(id), body);
    else {
      if (!pw) { $('user-form-message').textContent = 'Password required'; return; }
      body.password = pw;
      await AdminApi.createUser(body);
    }
    closeUserModal();
    toast('User saved');
    await refreshUsers();
  } catch (err) {
    $('user-form-message').textContent = err.message;
  }
};

$('user-delete').onclick = async () => {
  const id = Number($('user-id').value);
  if (!id || !confirm('Delete this user?')) return;
  try {
    await AdminApi.deleteUser(id);
    closeUserModal();
    toast('User deleted');
    await refreshUsers();
  } catch (err) {
    $('user-form-message').textContent = err.message;
  }
};

$('approve-form').onsubmit = async (e) => {
  e.preventDefault();
  const id = Number($('approve-id').value);
  try {
    await AdminApi.approveRequest(id, {
      username: $('approve-username').value.trim(),
      display_name: $('approve-display').value.trim(),
      password: $('approve-password').value,
      role_id: Number($('approve-role').value),
      telecaller_name: roleNeedsTelecaller($('approve-role').value) ? $('approve-telecaller').value.trim() : '',
      review_note: $('approve-note').value.trim(),
    });
    $('approve-modal').classList.add('hidden');
    toast('User created');
    await refreshUsers();
    refreshNotifs();
  } catch (err) {
    $('approve-message').textContent = err.message;
  }
};

$('role-form').onsubmit = async (e) => {
  e.preventDefault();
  const id = $('role-id').value;
  const permissions = [...$('role-perms').querySelectorAll('input[type=checkbox]:checked')].map(i => i.value);
  const body = {
    name: $('role-name').value.trim(),
    rank: Number($('role-rank').value),
    permissions,
  };
  try {
    if (id) await AdminApi.updateRole(Number(id), body);
    else await AdminApi.createRole(body);
    $('role-modal').classList.add('hidden');
    toast('Role saved');
    await refreshRoles();
  } catch (err) {
    $('role-form-message').textContent = err.message;
  }
};

$('role-delete').onclick = async () => {
  const id = Number($('role-id').value);
  if (!id || !confirm('Delete this role?')) return;
  try {
    await AdminApi.deleteRole(id);
    $('role-modal').classList.add('hidden');
    toast('Role deleted');
    await refreshRoles();
  } catch (err) {
    $('role-form-message').textContent = err.message;
  }
};

$('notif-bell').onclick = () => {
  $('notif-drawer').classList.toggle('hidden');
  refreshNotifs();
};
$('notif-close').onclick = () => $('notif-drawer').classList.add('hidden');
$('notif-mark-all').onclick = async () => {
  await NotifApi.markAllRead();
  refreshNotifs();
};

function openAccountModal(){
  const user = getUser();
  if (!user) return;
  $('account-username').value = user.username || '';
  $('account-display').value = user.display_name || '';
  $('account-telecaller').value = user.telecaller_name || '— set by Admin only —';
  $('account-pw-current').value = '';
  $('account-pw-new').value = '';
  $('account-pw-confirm').value = '';
  $('account-message').textContent = '';
  $('account-modal').classList.remove('hidden');
}
$('shell-account')?.addEventListener('click', openAccountModal);
$('account-cancel')?.addEventListener('click', () => $('account-modal').classList.add('hidden'));
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
      await changePassword(pwCur, pwNew);
    }
    $('shell-user-label').textContent = user.display_name || user.username;
    msg.textContent = 'Account updated.';
    toast('Account saved');
    setTimeout(() => $('account-modal').classList.add('hidden'), 400);
  } catch (err) {
    msg.textContent = err.message || 'Could not update account';
  }
});

(async function boot(){
  const user = await requireAuth({loginPath: '/'});
  if (!user) return;
  if (!requirePermission('module.admin', {fallback: '/'})) return;
  $('shell-user-label').textContent = user.display_name || user.username;

  document.querySelectorAll('.nav-item[data-perm]').forEach(btn => {
    if (!hasPermission(btn.dataset.perm)) btn.classList.add('hidden');
  });

  try {
    await Promise.all([loadRolesCache(), loadTelecallerNames()]);
  } catch (err) {
    toast(err.message || 'Could not load admin data');
  }
  const first = [...document.querySelectorAll('.nav-item:not(.hidden)')][0];
  showView(first?.dataset.view || 'users');
  refreshNotifs();
  setInterval(refreshNotifs, 60000);
})();

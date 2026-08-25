import {requireAuth, logout, getUser, hasPermission, requirePermission} from '../auth.js?v=5.0.0';
import {AdminApi, NotifApi} from '../api-client.js?v=5.0.0';

const $ = id => document.getElementById(id);
const titles = {users: 'User creation', roles: 'Roles'};
let rolesCache = [];
let catalog = [];
let editingRole = null;

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

function fillRoleSelect(select, selectedId){
  select.replaceChildren();
  for (const role of rolesCache) {
    const opt = document.createElement('option');
    opt.value = role.id;
    opt.textContent = `${role.name} (rank ${role.rank})`;
    if (selectedId && Number(selectedId) === role.id) opt.selected = true;
    select.append(opt);
  }
}

async function loadRolesCache(){
  const data = await AdminApi.listRoles();
  rolesCache = data.roles || [];
  catalog = data.permission_catalog || [];
}

async function refreshUsers(){
  const [usersData, reqData] = await Promise.all([
    AdminApi.listUsers(),
    AdminApi.listAccessRequests('pending').catch(() => ({requests: []})),
  ]);
  renderAccessQueue(reqData.requests || []);
  renderUsersTable(usersData.users || []);
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
      await AdminApi.denyRequest(req.id, {review_note: 'Denied'});
      toast('Request denied');
      refreshUsers();
      refreshNotifs();
    };
    actions.append(accept, deny);
    row.append(actions);
    mount.append(row);
  }
}

function renderUsersTable(users){
  const mount = $('users-table');
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
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'text-button';
    edit.textContent = 'Edit';
    edit.onclick = () => openUserModal(u);
    td.append(edit);
    tr.append(td);
    tbody.append(tr);
  }
  table.append(tbody);
  mount.replaceChildren(table);
}

function openUserModal(user = null){
  $('user-modal-title').textContent = user ? 'Edit user' : 'New user';
  $('user-id').value = user?.id || '';
  $('user-username').value = user?.username || '';
  $('user-display').value = user?.display_name || '';
  $('user-password').value = '';
  $('user-password').required = !user;
  fillRoleSelect($('user-role'), user?.role_id);
  $('user-telecaller').value = user?.telecaller_name || '';
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
  $('approve-telecaller').value = '';
  $('approve-note').value = '';
  $('approve-message').textContent = '';
  $('approve-modal').classList.remove('hidden');
}

async function refreshRoles(){
  await loadRolesCache();
  const mount = $('roles-panel');
  mount.replaceChildren();
  for (const role of rolesCache) {
    const card = document.createElement('div');
    card.className = 'role-card';
    const perms = (role.permissions || []).slice(0, 8).join(', ') + ((role.permissions || []).length > 8 ? '…' : '');
    card.innerHTML = `<div><strong>${escapeHtml(role.name)}</strong>
      <p>Rank ${role.rank}${role.is_system ? ' · system' : ''}</p>
      <p class="muted">${escapeHtml(perms || 'No permissions')}</p></div>`;
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'secondary-button';
    edit.textContent = 'Edit';
    edit.onclick = () => openRoleModal(role);
    card.append(edit);
    mount.append(card);
  }
}

function openRoleModal(role = null){
  editingRole = role;
  $('role-modal-title').textContent = role ? `Edit · ${role.name}` : 'New role';
  $('role-id').value = role?.id || '';
  $('role-name').value = role?.name || '';
  $('role-rank').value = role?.rank ?? 10;
  $('role-rank').disabled = role?.role_key === 'super';
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

$('user-form').onsubmit = async (e) => {
  e.preventDefault();
  const id = $('user-id').value;
  const body = {
    username: $('user-username').value.trim(),
    display_name: $('user-display').value.trim(),
    role_id: Number($('user-role').value),
    telecaller_name: $('user-telecaller').value.trim(),
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
    refreshUsers();
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
    refreshUsers();
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
      telecaller_name: $('approve-telecaller').value.trim(),
      review_note: $('approve-note').value.trim(),
    });
    $('approve-modal').classList.add('hidden');
    toast('User created');
    refreshUsers();
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
    refreshRoles();
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
    refreshRoles();
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

(async function boot(){
  const user = await requireAuth({loginPath: '/'});
  if (!user) return;
  if (!requirePermission('module.admin', {fallback: '/'})) return;
  $('shell-user-label').textContent = user.display_name || user.username;

  document.querySelectorAll('.nav-item[data-perm]').forEach(btn => {
    if (!hasPermission(btn.dataset.perm)) btn.classList.add('hidden');
  });

  await loadRolesCache();
  const first = [...document.querySelectorAll('.nav-item:not(.hidden)')][0];
  showView(first?.dataset.view || 'users');
  refreshNotifs();
  setInterval(refreshNotifs, 60000);
})();

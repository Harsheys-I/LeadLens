import {requireAuth, logout, getUser, hasPermission, requirePermission, changePassword, updateProfile} from '../auth.js?v=8.0.0.stable';
import {AdminApi, DashboardApi, TeamFormsApi} from '../api-client.js?v=8.0.0.stable';
import {mountNotifications} from '../notifications-ui.js?v=8.0.0.stable';
import {appUrl, homePath} from '../app-base.js?v=8.0.0.stable';
import {initTheme} from '../theme.js?v=8.0.0.stable';

const $ = id => document.getElementById(id);
const titles = {users: 'User creation', roles: 'Roles'};
let rolesCache = [];
let catalog = [];
let editingRole = null;
let telecallerNames = [];
let notifCtl = null;
let orgDepartments = [];
let orgGroups = [];
let canAssignOrg = false;

function toast(msg){
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 3200);
}

function showView(name){
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${name}`));
  window.llMotion?.viewEnter(document.getElementById(`view-${name}`));
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

function fillRoleSelect(select, selectedId, {lockToSelected = false} = {}){
  select.replaceChildren();
  const maxRank = actorRank();
  const actor = getUser();
  const selected = selectedId != null && selectedId !== '' ? Number(selectedId) : null;
  const allowEqualOrAbove = Boolean(actor?.is_super);
  for (const role of rolesCache) {
    const rank = Number(role.rank ?? 0);
    // Strictly below actor rank; Super may assign any non-super role.
    if (!allowEqualOrAbove) {
      if (rank >= maxRank) continue;
      if (role.role_key === 'super') continue;
    } else if (role.role_key === 'super' && selected !== role.id) {
      continue; // never re-assign Super via dropdown except keeping existing Super target
    }
    const opt = document.createElement('option');
    opt.value = role.id;
    opt.textContent = `${role.name} (rank ${role.rank})`;
    if (selected != null && selected === role.id) opt.selected = true;
    select.append(opt);
  }
  if (lockToSelected && selected != null) {
    select.disabled = true;
    // Ensure current role stays visible even if filtered out for peers
    if (![...select.options].some(o => Number(o.value) === selected)) {
      const role = rolesCache.find(r => r.id === selected);
      if (role) {
        const opt = document.createElement('option');
        opt.value = role.id;
        opt.textContent = `${role.name} (rank ${role.rank}) · locked`;
        opt.selected = true;
        select.append(opt);
      }
    }
  } else {
    select.disabled = false;
  }
}

function canEditUserRow(u){
  const actor = getUser();
  if (!actor) return false;
  if (u.role_key === 'super' && !actor.is_super) return false;
  if (actor.is_super) return true;
  return Number(u.role_rank ?? 0) < actorRank();
}

function canEditRoleCard(role){
  const actor = getUser();
  if (!actor) return false;
  if (role.role_key === 'super') return false;
  if (actor.is_super) return true;
  return Number(role.rank ?? 0) < actorRank();
}

function roleNeedsTelecaller(roleId){
  const role = rolesCache.find(r => r.id === Number(roleId));
  return role?.role_key === 'telecaller';
}

function telecallerListId(inputId){
  return `${inputId}-list`;
}

function closeTelecallerList(inputId){
  const input = $(inputId);
  const list = $(telecallerListId(inputId));
  list?.classList.add('hidden');
  input?.setAttribute('aria-expanded', 'false');
}

function filterTelecallerNames(query){
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [...telecallerNames];
  return telecallerNames.filter(name => name.toLowerCase().includes(q));
}

function openTelecallerList(inputId, query){
  const input = $(inputId);
  const list = $(telecallerListId(inputId));
  if (!input || !list || input.disabled) return;
  const names = filterTelecallerNames(query ?? input.value);
  list.replaceChildren();
  if (!names.length) {
    closeTelecallerList(inputId);
    return;
  }
  for (const name of names) {
    const li = document.createElement('li');
    li.className = 'telecaller-combobox-option';
    li.setAttribute('role', 'option');
    li.textContent = name;
    li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      input.value = name;
      closeTelecallerList(inputId);
    });
    list.append(li);
  }
  list.classList.remove('hidden');
  input.setAttribute('aria-expanded', 'true');
}

function wireTelecallerCombobox(inputId){
  const input = $(inputId);
  if (!input || input.dataset.comboboxWired) return;
  input.dataset.comboboxWired = '1';
  input.addEventListener('focus', () => openTelecallerList(inputId, input.value));
  input.addEventListener('input', () => openTelecallerList(inputId, input.value));
  input.addEventListener('keydown', (e) => {
    const list = $(telecallerListId(inputId));
    const options = list ? [...list.querySelectorAll('.telecaller-combobox-option')] : [];
    const active = list?.querySelector('.telecaller-combobox-option.is-active');
    const idx = active ? options.indexOf(active) : -1;
    if (e.key === 'Escape') {
      closeTelecallerList(inputId);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      let opts = options;
      if (!opts.length) {
        openTelecallerList(inputId, input.value);
        opts = [...($(telecallerListId(inputId))?.querySelectorAll('.telecaller-combobox-option') || [])];
        if (!opts.length) return;
      }
      const next = e.key === 'ArrowDown'
        ? Math.min(idx + 1, opts.length - 1)
        : Math.max(idx < 0 ? opts.length - 1 : idx - 1, 0);
      opts.forEach((el, i) => el.classList.toggle('is-active', i === next));
      opts[next]?.scrollIntoView({block: 'nearest'});
      return;
    }
    if (e.key === 'Enter' && active) {
      e.preventDefault();
      input.value = active.textContent || '';
      closeTelecallerList(inputId);
    }
  });
  input.addEventListener('blur', () => {
    // Allow mousedown on an option to run before closing.
    setTimeout(() => closeTelecallerList(inputId), 120);
  });
}

function syncTelecallerField(roleSelectId, wrapId, inputId, selectedName){
  const wrap = $(wrapId);
  const input = $(inputId);
  const needed = roleNeedsTelecaller($(roleSelectId).value);
  wrap.classList.toggle('hidden', !needed);
  input.disabled = !needed;
  if (needed) {
    if (selectedName !== undefined) input.value = String(selectedName || '');
    wireTelecallerCombobox(inputId);
  } else {
    input.value = '';
    closeTelecallerList(inputId);
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

async function loadOrgCatalog(){
  canAssignOrg = Boolean(getUser()?.is_super || hasPermission('team_forms.manage_org'));
  try {
    const data = await AdminApi.orgCatalog();
    orgDepartments = data.departments || [];
    orgGroups = data.groups || [];
    if (typeof data.can_assign_org === 'boolean') canAssignOrg = data.can_assign_org;
    return;
  } catch {
    // Fall back to Team Forms GET departments + groups when Admin org catalog is unavailable.
  }
  try {
    const [deptData, groupData] = await Promise.all([
      TeamFormsApi.listDepartments(),
      TeamFormsApi.listGroups(),
    ]);
    orgDepartments = deptData.departments || [];
    orgGroups = groupData.groups || [];
  } catch {
    orgDepartments = [];
    orgGroups = [];
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
    if (typeof usersData.can_assign_org === 'boolean') canAssignOrg = usersData.can_assign_org;
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
      <p>${[req.email, req.preferred_module].filter(Boolean).map(escapeHtml).join(' · ')}</p>
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
    if (canEditUserRow(u)) {
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

function userOrgIds(user){
  const groupIds = new Set();
  const deptIds = new Set();
  for (const id of user?.group_ids || []) groupIds.add(Number(id));
  for (const id of user?.department_ids || []) deptIds.add(Number(id));
  for (const m of user?.org_memberships || []) {
    if (m?.group_id != null) groupIds.add(Number(m.group_id));
    if (m?.department_id != null) deptIds.add(Number(m.department_id));
  }
  for (const g of orgGroups) {
    if (groupIds.has(Number(g.id))) deptIds.add(Number(g.department_id));
  }
  return {groupIds, deptIds};
}

function appendOrgCheck(mount, {value, label, checked, disabled, departmentId}){
  const row = document.createElement('label');
  row.className = 'check-row';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.value = String(value);
  input.checked = Boolean(checked);
  input.disabled = Boolean(disabled);
  if (departmentId != null) input.dataset.departmentId = String(departmentId);
  row.append(input, Object.assign(document.createElement('span'), {textContent: label}));
  mount.append(row);
  return input;
}

function selectedOrgDepartmentIds(){
  return [...document.querySelectorAll('#user-departments input[type=checkbox]:checked')].map(i => Number(i.value));
}

function collectOrgGroupIds(){
  const selectedDepts = new Set(selectedOrgDepartmentIds());
  return [...document.querySelectorAll('#user-groups input[type=checkbox]:checked')]
    .filter(i => selectedDepts.has(Number(i.dataset.departmentId)))
    .map(i => Number(i.value));
}

function syncOrgGroupVisibility(){
  const selected = new Set(selectedOrgDepartmentIds());
  const section = $('user-groups-section');
  let visible = 0;
  document.querySelectorAll('#user-groups [data-org-group-block]').forEach(block => {
    const show = selected.has(Number(block.dataset.departmentId));
    block.classList.toggle('hidden', !show);
    if (show) visible += 1;
  });
  const empty = $('user-groups-empty');
  if (empty) {
    const noGroupsForSelected = selected.size > 0 && visible === 0;
    empty.classList.toggle('hidden', !noGroupsForSelected);
    if (noGroupsForSelected) empty.textContent = 'No groups in the selected departments.';
  }
  section?.classList.toggle('hidden', selected.size === 0 && visible === 0);
}

function onOrgDepartmentToggle(input){
  const deptId = Number(input.value);
  if (!input.checked) {
    document.querySelectorAll(`#user-groups input[data-department-id="${deptId}"]`).forEach(cb => {
      cb.checked = false;
    });
  }
  syncOrgGroupVisibility();
}

function renderUserOrgChecks(user = null){
  const wrap = $('user-org-wrap');
  const hint = $('user-org-hint');
  const deptMount = $('user-departments');
  const groupMount = $('user-groups');
  const section = $('user-groups-section');
  if (!wrap || !deptMount || !groupMount) return;

  const editable = canAssignOrg;
  hint.textContent = editable
    ? 'Membership is per group. Checking a department only reveals its groups.'
    : 'Org assignment is read-only. Super User or Manage org permission is required to change it.';
  wrap.classList.toggle('is-readonly', !editable);

  const {groupIds, deptIds} = userOrgIds(user);
  deptMount.replaceChildren();
  if (!orgDepartments.length) {
    const names = (user?.org_memberships || []).map(m => {
      const dept = m.department_name || 'Department';
      const group = m.group_name || 'Group';
      return `${dept} · ${group}`;
    }).filter(Boolean);
    deptMount.innerHTML = names.length
      ? `<p class="muted">Current groups: ${escapeHtml(names.join(', '))}</p>`
      : '<p class="muted">No departments yet. Create them in Team Forms.</p>';
  } else {
    for (const dept of orgDepartments) {
      const input = appendOrgCheck(deptMount, {
        value: dept.id,
        label: dept.name,
        checked: deptIds.has(Number(dept.id)),
        disabled: !editable,
      });
      if (editable) {
        input.addEventListener('change', () => onOrgDepartmentToggle(input));
      }
    }
  }

  groupMount.replaceChildren();
  const empty = document.createElement('p');
  empty.id = 'user-groups-empty';
  empty.className = 'muted hidden';
  empty.textContent = 'Select a department to see its groups.';
  groupMount.append(empty);

  const byDept = new Map();
  for (const g of orgGroups) {
    const did = Number(g.department_id);
    if (!byDept.has(did)) byDept.set(did, []);
    byDept.get(did).push(g);
  }
  for (const dept of orgDepartments) {
    const groups = byDept.get(Number(dept.id)) || [];
    if (!groups.length) continue;
    const block = document.createElement('div');
    block.className = 'perm-group user-org-dept-groups';
    block.dataset.orgGroupBlock = '1';
    block.dataset.departmentId = String(dept.id);
    block.append(Object.assign(document.createElement('strong'), {textContent: dept.name}));
    for (const g of groups) {
      appendOrgCheck(block, {
        value: g.id,
        label: g.name,
        checked: groupIds.has(Number(g.id)),
        disabled: !editable,
        departmentId: dept.id,
      });
    }
    groupMount.append(block);
  }
  if (!orgGroups.length && orgDepartments.length) {
    empty.textContent = 'No groups yet. Create them in Team Forms.';
    empty.classList.remove('hidden');
  }
  syncOrgGroupVisibility();
  if (section && !orgDepartments.length) section.classList.add('hidden');
}

async function openUserModal(user = null){
  const actor = getUser();
  if (user && !canEditUserRow(user)) {
    toast('You cannot edit this user');
    return;
  }
  $('user-modal-title').textContent = user ? 'Edit user' : 'New user';
  $('user-id').value = user?.id || '';
  $('user-username').value = user?.username || '';
  $('user-display').value = user?.display_name || '';
  $('user-password').value = '';
  $('user-password').required = !user;
  const editingSelf = Boolean(user && actor && Number(user.id) === Number(actor.id));
  fillRoleSelect($('user-role'), user?.role_id, {lockToSelected: editingSelf});
  syncTelecallerField('user-role', 'user-telecaller-wrap', 'user-telecaller', user?.telecaller_name || '');
  $('user-notes').value = user?.notes || '';
  $('user-active').checked = user ? user.is_active : true;
  $('user-must-pw').checked = user ? !!user.must_change_password : true;
  $('user-delete').classList.toggle('hidden', !user || user.role_key === 'super' || editingSelf);
  $('user-form-message').textContent = editingSelf
    ? 'Your own role is locked — ask a higher-rank account to change it.'
    : '';
  await loadOrgCatalog();
  let detail = user;
  if (user?.id) {
    try {
      const data = await AdminApi.getUser(user.id);
      if (data?.user) detail = {...user, ...data.user};
    } catch { /* list payload is enough to prefill */ }
  }
  renderUserOrgChecks(detail);
  $('user-modal').classList.remove('hidden');
}

function closeUserModal(){
  $('user-modal').classList.add('hidden');
}

function openApprove(req){
  $('approve-id').value = req.id;
  $('approve-summary').textContent = [req.full_name, req.email].filter(Boolean).join(' · ');
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
      if (canEditRoleCard(role)) {
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'secondary-button';
        edit.textContent = 'Edit';
        edit.onclick = () => openRoleModal(role);
        card.append(edit);
      } else {
        const locked = document.createElement('span');
        locked.className = 'muted';
        locked.textContent = isSuperRole ? 'Locked' : 'Above your rank';
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
  if (role && !canEditRoleCard(role)) {
    toast(role.role_key === 'super' ? 'Super User role cannot be edited' : 'Cannot edit a role at or above your rank');
    return;
  }
  editingRole = role;
  $('role-modal-title').textContent = role ? `Edit · ${role.name}` : 'New role';
  $('role-id').value = role?.id || '';
  $('role-name').value = role?.name || '';
  const maxAssignable = getUser()?.is_super ? 99 : Math.max(1, actorRank() - 1);
  $('role-rank').value = role?.rank ?? Math.min(10, maxAssignable);
  $('role-rank').max = String(maxAssignable);
  $('role-rank').disabled = false;
  $('role-delete').classList.toggle('hidden', !role || role.is_system || !canEditRoleCard(role));
  renderPermChecks(role?.permissions || []);
  $('role-form-message').textContent = getUser()?.is_super
    ? ''
    : `Rank must be below yours (max ${maxAssignable}).`;
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

function refreshNotifs(){
  notifCtl?.refresh?.();
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
$('shell-logout').onclick = async () => { await logout(); location.href = homePath(); };
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
  const actor = getUser();
  const editingSelf = Boolean(id && actor && Number(id) === Number(actor.id));
  const body = {
    username: $('user-username').value.trim(),
    display_name: $('user-display').value.trim(),
    telecaller_name: roleNeedsTelecaller($('user-role').value) ? $('user-telecaller').value.trim() : '',
    notes: $('user-notes').value.trim(),
    is_active: $('user-active').checked,
    must_change_password: $('user-must-pw').checked,
  };
  if (!editingSelf) body.role_id = Number($('user-role').value);
  const pw = $('user-password').value;
  if (pw) body.password = pw;
  if (canAssignOrg) body.group_ids = collectOrgGroupIds();
  try {
    if (id) await AdminApi.updateUser(Number(id), body);
    else {
      if (!pw) { $('user-form-message').textContent = 'Password required'; return; }
      body.password = pw;
      body.role_id = Number($('user-role').value);
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
  initTheme();
  const user = await requireAuth({loginPath: homePath()});
  if (!user) return;
  if (!requirePermission('module.admin', {fallback: homePath()})) return;
  $('shell-user-label').textContent = user.display_name || user.username;

  document.querySelectorAll('.nav-item[data-perm]').forEach(btn => {
    if (!hasPermission(btn.dataset.perm)) btn.classList.add('hidden');
  });

  try {
    await Promise.all([loadRolesCache(), loadTelecallerNames(), loadOrgCatalog()]);
  } catch (err) {
    toast(err.message || 'Could not load admin data');
  }
  const first = [...document.querySelectorAll('.nav-item:not(.hidden)')][0];
  showView(first?.dataset.view || 'users');
  notifCtl = mountNotifications({
    onOpenAccessRequests: () => showView('users'),
    onDashboardUpdate: () => { location.href = appUrl('/TeleCallerAudit/#published'); },
    onPerfDashboardUpdate: () => { location.href = appUrl('/TeleCallerAudit/#perf-dashboard'); },
  });
})();

/**
 * Team Forms — org, form builder, assignee workspace, review board.
 */
import {APP_VERSION} from './audit.js?v=7.0.1.dev';
import {requireAuth, logout, hasPermission, getUser, changePassword, updateProfile} from './auth.js?v=7.0.1.dev';
import {TeamFormsApi} from './api-client.js?v=7.0.1.dev';
import {mountNotifications} from './notifications-ui.js?v=7.0.1.dev';
import {appUrl, homePath} from './app-base.js?v=7.0.1.dev';
import {initTheme} from './theme.js?v=7.0.1.dev';
import {setStorageUserId, storageKey} from './db.js?v=7.0.1.dev';

const $ = id => document.getElementById(id);
const VERSION = APP_VERSION || '7.0.1.dev';
const POLL_MS = 7000;

const titles = {
  workspace: 'My workspace',
  org: 'Org',
  builder: 'Form builder',
  review: 'Review board',
  task: 'Task',
};

const ROLE_LABELS = {
  form_creator: 'Form Creator',
  reviewer: 'Reviewer',
  assignee: 'Assignee',
};

const FIELD_TYPES = [
  ['text', 'Text'],
  ['textarea', 'Long text'],
  ['number', 'Number'],
  ['select', 'Select'],
  ['checkbox', 'Checkbox'],
  ['date', 'Date'],
  ['readonly', 'Readonly'],
  ['calculated', 'Calculated'],
];

const CALC_OPS = [
  ['add', 'Add (+)'],
  ['subtract', 'Subtract (−)'],
  ['multiply', 'Multiply (×)'],
  ['divide', 'Divide (÷)'],
];

let currentView = 'workspace';
let workspaceData = null;
let orgDepts = [];
let orgGroups = [];
let usersCache = [];
let expandedDeptId = null;
let expandedGroupId = null;
let builderGroupId = null;
let builderForm = null;
let currentTask = null;
let taskBackView = 'workspace';
let reviewTimer = null;
let modalSubmitHandler = null;
let taskSaveTimer = null;
let taskSaveInFlight = null;

function toast(msg){
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 3200);
}

function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function canManageOrg(){
  const u = getUser();
  return Boolean(u?.is_super || hasPermission('team_forms.manage_org'));
}

function myRolesInGroup(groupId){
  const u = getUser();
  const m = (u?.org_memberships || []).find(x => Number(x.group_id) === Number(groupId));
  return m?.roles || [];
}

function canDeleteForm(form){
  const u = getUser();
  if (!u || !form) return false;
  if (u.is_super || canManageOrg()) return true;
  return Number(form.created_by) > 0 && Number(u.id) === Number(form.created_by);
}

function isFormCreatorAnywhere(){
  const u = getUser();
  if (u?.is_super || canManageOrg()) return true;
  return (u?.org_memberships || []).some(m => (m.roles || []).includes('form_creator'));
}

function isReviewerAnywhere(){
  const u = getUser();
  if (u?.is_super || canManageOrg()) return true;
  return (u?.org_memberships || []).some(m => (m.roles || []).includes('reviewer'));
}

function statusLabel(s){
  const key = String(s || '');
  const labels = {
    pending: 'Pending',
    in_progress: 'In progress',
    submitted: 'Completed',
    completed: 'Completed',
    approved: 'Approved',
    rework: 'Rework',
    closed: 'Closed',
  };
  return labels[key] || key.replace(/_/g, ' ');
}

function evalCalc(op, left, right){
  if (left === '' || left == null || right === '' || right == null) return '';
  const a = Number(left);
  const b = Number(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return '';
  let r = null;
  if (op === 'add') r = a + b;
  else if (op === 'subtract') r = a - b;
  else if (op === 'multiply') r = a * b;
  else if (op === 'divide') r = b === 0 ? null : a / b;
  if (r == null || !Number.isFinite(r)) return '';
  return String(Number(r.toPrecision(12)));
}

function applyCalculatedClient(fields, values){
  const byId = Object.fromEntries(fields.map(f => [f.id, f]));
  const out = {...values};
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const f of fields) {
      if (f.field_type !== 'calculated') continue;
      let left = out[f.calc_left_field_id];
      let right = out[f.calc_right_field_id];
      const lf = byId[f.calc_left_field_id];
      const rf = byId[f.calc_right_field_id];
      if (lf?.field_type === 'readonly') left = lf.readonly_value;
      if (rf?.field_type === 'readonly') right = rf.readonly_value;
      const next = evalCalc(f.calc_op, left, right);
      if (String(out[f.id] ?? '') !== String(next ?? '')) {
        out[f.id] = next;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return out;
}

function stopReviewPoll(){
  if (reviewTimer) {
    clearInterval(reviewTimer);
    reviewTimer = null;
  }
}

function startReviewPoll(){
  stopReviewPoll();
  reviewTimer = setInterval(() => {
    if (currentView === 'review') refreshReview({silent: true});
  }, POLL_MS);
}

function showView(name, {hash = true} = {}){
  if (currentView === 'task' && name !== 'task') {
    flushTaskAutosave().catch(() => {});
  }
  if (name === 'org' && !canManageOrg()) {
    toast('Org management requires permission.');
    return;
  }
  if (name === 'builder' && !isFormCreatorAnywhere()) {
    toast('Form builder requires Form Creator membership.');
    return;
  }
  if (name === 'review' && !isReviewerAnywhere()) {
    toast('Review board requires Reviewer membership.');
    return;
  }

  currentView = name;
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${name}`));
  window.llMotion?.viewEnter?.(document.getElementById(`view-${name}`));
  document.querySelectorAll('.nav-item').forEach(b => {
    const isTaskNav = b.dataset.view === 'task';
    b.classList.toggle('active', b.dataset.view === name);
    if (isTaskNav) b.classList.toggle('hidden', name !== 'task');
  });
  $('page-title').textContent = titles[name] || name;
  document.querySelector('.shell')?.classList.remove('menu-open');

  if (name === 'review') startReviewPoll();
  else stopReviewPoll();

  if (hash && name !== 'task') location.hash = name;
  if (name === 'workspace') refreshWorkspace();
  if (name === 'org') refreshOrg();
  if (name === 'builder') refreshBuilder();
  if (name === 'review') refreshReview();
}

function openModal(title, bodyHtml, onSubmit){
  $('tf-modal-title').textContent = title;
  $('tf-modal-body').innerHTML = bodyHtml;
  $('tf-modal-message').textContent = '';
  modalSubmitHandler = onSubmit;
  $('tf-modal').classList.remove('hidden');
}

function closeModal(){
  $('tf-modal').classList.add('hidden');
  modalSubmitHandler = null;
}

$('tf-modal-cancel')?.addEventListener('click', closeModal);
$('tf-modal-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  if (!modalSubmitHandler) return;
  const msg = $('tf-modal-message');
  msg.textContent = 'Saving…';
  try {
    await modalSubmitHandler();
    closeModal();
  } catch (err) {
    msg.textContent = err.message || 'Save failed';
  }
});

/* —— Workspace —— */
async function refreshWorkspace(){
  try {
    workspaceData = await TeamFormsApi.workspace();
    // refresh memberships on user object for role gates
    const u = getUser();
    if (u) u.org_memberships = workspaceData.memberships || [];
    renderMemberships(workspaceData.memberships || []);
    renderAssignedTasks(workspaceData.assigned_tasks || []);
    updateNavVisibility();
  } catch (err) {
    toast(err.message || 'Could not load workspace');
    $('ws-memberships').innerHTML = `<div class="empty-card">${escapeHtml(err.message || 'Error')}</div>`;
  }
}

function renderMemberships(list){
  const mount = $('ws-memberships');
  if (!list.length) {
    mount.innerHTML = '<div class="empty-card">You are not in any department group yet. Ask a Super User to add you in Org.</div>';
    return;
  }
  const byDept = new Map();
  for (const m of list) {
    if (!byDept.has(m.department_id)) {
      byDept.set(m.department_id, {name: m.department_name, groups: []});
    }
    byDept.get(m.department_id).groups.push(m);
  }
  mount.replaceChildren();
  for (const [, dept] of byDept) {
    const block = document.createElement('div');
    block.className = 'tf-dept-block';
    block.innerHTML = `<h3>${escapeHtml(dept.name)}</h3>`;
    for (const g of dept.groups) {
      const card = document.createElement('div');
      card.className = 'tf-group-card';
      const chips = (g.roles || []).map(r =>
        `<span class="tf-role-chip">${escapeHtml(ROLE_LABELS[r] || r)}</span>`
      ).join('');
      card.innerHTML = `<strong>${escapeHtml(g.group_name)}</strong><div>${chips}</div>`;
      block.append(card);
    }
    mount.append(block);
  }
}

function renderAssignedTasks(tasks){
  const mount = $('ws-tasks');
  if (!tasks.length) {
    mount.innerHTML = '<div class="empty-card">No open tasks assigned to you.</div>';
    return;
  }
  const table = document.createElement('table');
  table.className = 'admin-table';
  table.innerHTML = `<thead><tr>
    <th>Form</th><th>Department</th><th>Group</th><th>Status</th><th>Updated</th><th></th>
  </tr></thead>`;
  const tbody = document.createElement('tbody');
  for (const t of tasks) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(t.form_title)}</td>
      <td>${escapeHtml(t.department_name)}</td>
      <td>${escapeHtml(t.group_name)}</td>
      <td><span class="tf-status">${escapeHtml(statusLabel(t.status))}</span></td>
      <td>${escapeHtml(t.updated_at || '')}</td>
      <td></td>`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'secondary-button';
    btn.textContent = 'Open';
    btn.onclick = () => openTask(t.id, 'workspace');
    tr.lastElementChild.append(btn);
    tbody.append(tr);
  }
  table.append(tbody);
  mount.replaceChildren(table);
}

/* —— Org —— */
async function refreshOrg(){
  try {
    const [d, g] = await Promise.all([
      TeamFormsApi.listDepartments(),
      TeamFormsApi.listGroups(),
    ]);
    orgDepts = d.departments || [];
    orgGroups = g.groups || [];
    if (!usersCache.length) {
      try {
        usersCache = (await TeamFormsApi.listUsers()).users || [];
      } catch { usersCache = []; }
    }
    renderOrgTree();
  } catch (err) {
    toast(err.message || 'Could not load org');
    $('org-tree').innerHTML = `<div class="empty-card">${escapeHtml(err.message || '')}</div>`;
  }
}

function renderOrgTree(){
  const mount = $('org-tree');
  mount.replaceChildren();
  if (!orgDepts.length) {
    mount.innerHTML = '<div class="empty-card">No departments yet. Create one to get started.</div>';
    return;
  }
  if (expandedDeptId != null && !orgDepts.some(d => Number(d.id) === Number(expandedDeptId))) {
    expandedDeptId = null;
    expandedGroupId = null;
  }
  if (expandedGroupId != null && !orgGroups.some(g => Number(g.id) === Number(expandedGroupId))) {
    expandedGroupId = null;
  }
  for (const dept of orgDepts) {
    const deptOpen = Number(expandedDeptId) === Number(dept.id);
    const block = document.createElement('div');
    block.className = 'tf-dept-block';
    const head = document.createElement('div');
    head.className = 'section-head';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'tf-accordion-toggle';
    toggle.setAttribute('aria-expanded', deptOpen ? 'true' : 'false');
    toggle.innerHTML = `<span class="tf-accordion-caret" aria-hidden="true">${deptOpen ? '▾' : '▸'}</span>
      <span class="tf-accordion-label"><h3>${escapeHtml(dept.name)}</h3>
      <p class="muted">${escapeHtml(dept.description || '')}</p></span>`;
    toggle.onclick = () => {
      if (deptOpen) {
        expandedDeptId = null;
        expandedGroupId = null;
      } else {
        expandedDeptId = dept.id;
        expandedGroupId = null;
      }
      renderOrgTree();
    };
    const actions = document.createElement('div');
    actions.className = 'inline-actions';
    const addGroup = document.createElement('button');
    addGroup.type = 'button';
    addGroup.className = 'secondary-button';
    addGroup.textContent = 'Add group';
    addGroup.onclick = () => openNewGroup(dept.id);
    const editDept = document.createElement('button');
    editDept.type = 'button';
    editDept.className = 'text-button';
    editDept.textContent = 'Edit';
    editDept.onclick = () => openEditDept(dept);
    const delDept = document.createElement('button');
    delDept.type = 'button';
    delDept.className = 'text-button';
    delDept.textContent = 'Delete';
    delDept.onclick = async () => {
      if (!confirm(`Delete department “${dept.name}” and all its groups?`)) return;
      try {
        await TeamFormsApi.deleteDepartment(dept.id);
        toast('Department deleted');
        refreshOrg();
      } catch (err) { toast(err.message || 'Delete failed'); }
    };
    actions.append(addGroup, editDept, delDept);
    head.append(toggle, actions);
    block.append(head);

    if (deptOpen) {
      const groups = orgGroups.filter(g => Number(g.department_id) === Number(dept.id));
      if (!groups.length) {
        const empty = document.createElement('p');
        empty.className = 'muted';
        empty.textContent = 'No groups in this department.';
        block.append(empty);
      }
      for (const g of groups) {
        block.append(renderGroupCard(g));
      }
    }
    mount.append(block);
  }
}

function renderGroupCard(g){
  const groupOpen = Number(expandedGroupId) === Number(g.id);
  const card = document.createElement('div');
  card.className = 'tf-group-card';
  const head = document.createElement('div');
  head.className = 'tf-group-head';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'tf-accordion-toggle';
  toggle.setAttribute('aria-expanded', groupOpen ? 'true' : 'false');
  toggle.innerHTML = `<span class="tf-accordion-caret" aria-hidden="true">${groupOpen ? '▾' : '▸'}</span>
    <span class="tf-accordion-label"><strong>${escapeHtml(g.name)}</strong>
    <p class="muted" style="margin:4px 0 0">${escapeHtml(g.description || '')}</p></span>`;
  toggle.onclick = () => {
    expandedGroupId = groupOpen ? null : g.id;
    renderOrgTree();
  };
  head.append(toggle);
  card.append(head);
  const actions = document.createElement('div');
  actions.className = 'inline-actions';
  const addMem = document.createElement('button');
  addMem.type = 'button';
  addMem.className = 'secondary-button';
  addMem.textContent = 'Add member';
  addMem.onclick = () => openAddMember(g);
  const editG = document.createElement('button');
  editG.type = 'button';
  editG.className = 'text-button';
  editG.textContent = 'Edit';
  editG.onclick = () => openEditGroup(g);
  const delG = document.createElement('button');
  delG.type = 'button';
  delG.className = 'text-button';
  delG.textContent = 'Delete';
  delG.onclick = async () => {
    if (!confirm(`Delete group “${g.name}”?`)) return;
    try {
      await TeamFormsApi.deleteGroup(g.id);
      toast('Group deleted');
      refreshOrg();
    } catch (err) { toast(err.message || 'Delete failed'); }
  };
  actions.append(addMem, editG, delG);
  card.append(actions);
  if (groupOpen) {
    const members = document.createElement('div');
    members.className = 'tf-members';
    members.dataset.gid = String(g.id);
    members.innerHTML = '<span class="muted">Loading members…</span>';
    card.append(members);
    loadMembersInto(members, g.id);
  }
  return card;
}

async function loadMembersInto(el, groupId){
  try {
    const data = await TeamFormsApi.listMembers(groupId);
    const members = data.members || [];
    if (!members.length) {
      el.innerHTML = '<span class="muted">No members yet.</span>';
      return;
    }
    el.replaceChildren();
    for (const m of members) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;gap:8px;align-items:center;margin:6px 0;flex-wrap:wrap';
      row.innerHTML = `<span>${escapeHtml(m.display_name)}
        <span class="tf-role-chip">${escapeHtml(ROLE_LABELS[m.role] || m.role)}</span></span>`;
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'text-button';
      rm.textContent = 'Remove';
      rm.onclick = async () => {
        try {
          await TeamFormsApi.removeMember(groupId, {member_id: m.id});
          toast('Member removed');
          loadMembersInto(el, groupId);
        } catch (err) { toast(err.message || 'Remove failed'); }
      };
      row.append(rm);
      el.append(row);
    }
  } catch (err) {
    el.innerHTML = `<span class="muted">${escapeHtml(err.message || 'Error')}</span>`;
  }
}

function openNewDept(){
  openModal('New department', `
    <label>Name<input name="name" required></label>
    <label>Description<textarea name="description" rows="2"></textarea></label>
  `, async () => {
    const form = $('tf-modal-form');
    await TeamFormsApi.createDepartment({
      name: form.name.value.trim(),
      description: form.description.value.trim(),
    });
    toast('Department created');
    await refreshOrg();
  });
}

function openEditDept(dept){
  openModal('Edit department', `
    <label>Name<input name="name" required value="${escapeHtml(dept.name)}"></label>
    <label>Description<textarea name="description" rows="2">${escapeHtml(dept.description || '')}</textarea></label>
  `, async () => {
    const form = $('tf-modal-form');
    await TeamFormsApi.updateDepartment(dept.id, {
      name: form.name.value.trim(),
      description: form.description.value.trim(),
    });
    toast('Department updated');
    await refreshOrg();
  });
}

function openNewGroup(departmentId){
  openModal('New group', `
    <label>Name<input name="name" required></label>
    <label>Description<textarea name="description" rows="2"></textarea></label>
  `, async () => {
    const form = $('tf-modal-form');
    await TeamFormsApi.createGroup({
      department_id: departmentId,
      name: form.name.value.trim(),
      description: form.description.value.trim(),
    });
    toast('Group created');
    await refreshOrg();
  });
}

function openEditGroup(g){
  openModal('Edit group', `
    <label>Name<input name="name" required value="${escapeHtml(g.name)}"></label>
    <label>Description<textarea name="description" rows="2">${escapeHtml(g.description || '')}</textarea></label>
  `, async () => {
    const form = $('tf-modal-form');
    await TeamFormsApi.updateGroup(g.id, {
      name: form.name.value.trim(),
      description: form.description.value.trim(),
    });
    toast('Group updated');
    await refreshOrg();
  });
}

function openAddMember(g){
  const opts = usersCache.map(u =>
    `<option value="${u.id}">${escapeHtml(u.display_name)} (${escapeHtml(u.username)})</option>`
  ).join('');
  const roleOpts = Object.entries(ROLE_LABELS).map(([k, v]) =>
    `<option value="${k}">${escapeHtml(v)}</option>`
  ).join('');
  openModal(`Add member · ${g.name}`, `
    <label>User<select name="user_id" required>${opts || '<option value="">No users</option>'}</select></label>
    <label>Role<select name="role">${roleOpts}</select></label>
  `, async () => {
    const form = $('tf-modal-form');
    await TeamFormsApi.addMember(g.id, {
      user_id: Number(form.user_id.value),
      role: form.role.value,
    });
    toast('Member added');
    await refreshOrg();
  });
}

/* —— Builder —— */
async function refreshBuilder(){
  try {
    if (!workspaceData) workspaceData = await TeamFormsApi.workspace();
    const groups = workspaceData.creator_groups || [];
    const sel = $('builder-group');
    const prev = builderGroupId || sel.value;
    sel.replaceChildren();
    if (!groups.length) {
      sel.innerHTML = '<option value="">No groups available</option>';
      $('builder-forms').innerHTML = '<div class="empty-card">You need Form Creator role on a group (or Org manage permission).</div>';
      $('builder-editor').classList.add('hidden');
      return;
    }
    for (const g of groups) {
      const opt = document.createElement('option');
      opt.value = g.group_id;
      opt.textContent = `${g.department_name} · ${g.group_name}`;
      sel.append(opt);
    }
    if (prev && [...sel.options].some(o => o.value === String(prev))) sel.value = String(prev);
    builderGroupId = Number(sel.value);
    await loadBuilderForms();
  } catch (err) {
    toast(err.message || 'Builder load failed');
  }
}

async function loadBuilderForms(){
  const gid = Number($('builder-group').value);
  builderGroupId = gid;
  if (!gid) return;
  try {
    const data = await TeamFormsApi.listForms(gid);
    const forms = data.forms || [];
    const mount = $('builder-forms');
    if (!forms.length) {
      mount.innerHTML = '<div class="empty-card">No forms in this group yet.</div>';
      builderForm = null;
      $('builder-editor').classList.add('hidden');
      return;
    }
    const table = document.createElement('table');
    table.className = 'admin-table';
    table.innerHTML = '<thead><tr><th>Title</th><th>Active</th><th></th></tr></thead>';
    const tbody = document.createElement('tbody');
    for (const f of forms) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(f.title)}</td>
        <td>${f.is_active ? 'Yes' : 'No'}</td><td></td>`;
      const actions = tr.lastElementChild;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'secondary-button';
      btn.textContent = 'Edit';
      btn.onclick = () => openBuilderForm(f.id);
      actions.append(btn);
      if (canDeleteForm(f)) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'text-button';
        del.textContent = 'Delete';
        del.onclick = () => deleteBuilderForm(f);
        actions.append(del);
      }
      tbody.append(tr);
    }
    table.append(tbody);
    mount.replaceChildren(table);
  } catch (err) {
    $('builder-forms').innerHTML = `<div class="empty-card">${escapeHtml(err.message || '')}</div>`;
  }
}

async function openBuilderForm(formId){
  try {
    const data = await TeamFormsApi.getForm(formId);
    builderForm = data.form;
    $('builder-editor').classList.remove('hidden');
    $('builder-form-title').textContent = builderForm.title;
    $('builder-form-meta').textContent =
      `${builderForm.department_name} · ${builderForm.group_name}` +
      (builderForm.description ? ` — ${builderForm.description}` : '');
    $('builder-delete-form')?.classList.toggle('hidden', !canDeleteForm(builderForm));
    renderBuilderFields();
  } catch (err) {
    toast(err.message || 'Could not load form');
  }
}

async function deleteBuilderForm(form){
  const target = form || builderForm;
  if (!target?.id) return;
  if (!canDeleteForm(target)) {
    toast('Only the form creator can delete this form');
    return;
  }
  if (!confirm(`Delete form “${target.title}”? This removes its fields, assignments, and answers.`)) {
    return;
  }
  try {
    await TeamFormsApi.deleteForm(target.id);
    if (builderForm && Number(builderForm.id) === Number(target.id)) {
      builderForm = null;
      $('builder-editor').classList.add('hidden');
    }
    toast('Form deleted');
    await loadBuilderForms();
  } catch (err) {
    toast(err.message || 'Delete failed');
  }
}

function renderBuilderFields(){
  const mount = $('builder-fields');
  const fields = builderForm?.fields || [];
  if (!fields.length) {
    mount.innerHTML = '<div class="empty-card">No fields yet. Add text, number, readonly, or calculated fields.</div>';
    return;
  }
  mount.replaceChildren();
  for (const f of fields) {
    const row = document.createElement('div');
    row.className = 'tf-field-row';
    let detail = escapeHtml(f.field_type);
    if (f.field_type === 'readonly') detail += ` · value “${escapeHtml(f.readonly_value || '')}”`;
    if (f.field_type === 'calculated') {
      detail += ` · ${escapeHtml(f.calc_op || '')} (#${f.calc_left_field_id} , #${f.calc_right_field_id})`;
    }
    if (f.required) detail += ' · required';
    row.innerHTML = `<div class="tf-field-head">
      <div><strong>${escapeHtml(f.label)}</strong>
      <div class="muted" style="font-size:12px;font-weight:400">${detail}</div></div>
      <div class="inline-actions"></div></div>`;
    const actions = row.querySelector('.inline-actions');
    const idx = fields.indexOf(f);
    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'text-button';
    up.textContent = 'Up';
    up.disabled = idx === 0;
    up.setAttribute('aria-label', `Move ${f.label} up`);
    up.onclick = () => moveBuilderField(f.id, -1);
    const down = document.createElement('button');
    down.type = 'button';
    down.className = 'text-button';
    down.textContent = 'Down';
    down.disabled = idx === fields.length - 1;
    down.setAttribute('aria-label', `Move ${f.label} down`);
    down.onclick = () => moveBuilderField(f.id, 1);
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'text-button';
    edit.textContent = 'Edit';
    edit.onclick = () => openFieldModal(f);
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'text-button';
    del.textContent = 'Delete';
    del.onclick = async () => {
      if (!confirm(`Delete field “${f.label}”?`)) return;
      try {
        await TeamFormsApi.deleteField(builderForm.id, f.id);
        toast('Field deleted');
        await openBuilderForm(builderForm.id);
      } catch (err) { toast(err.message || 'Delete failed'); }
    };
    actions.append(up, down, edit, del);
    mount.append(row);
  }
}

async function moveBuilderField(fieldId, dir){
  const fields = builderForm?.fields || [];
  const i = fields.findIndex(f => Number(f.id) === Number(fieldId));
  const j = i + dir;
  if (i < 0 || j < 0 || j >= fields.length) return;
  const next = fields.slice();
  const [item] = next.splice(i, 1);
  next.splice(j, 0, item);
  builderForm.fields = next;
  renderBuilderFields();
  try {
    const data = await TeamFormsApi.reorderFields(builderForm.id, next.map(f => f.id));
    if (data.fields) builderForm.fields = data.fields;
    renderBuilderFields();
  } catch (err) {
    toast(err.message || 'Reorder failed');
    if (builderForm?.id) await openBuilderForm(builderForm.id);
  }
}

function fieldTypeOptions(selected){
  return FIELD_TYPES.map(([k, v]) =>
    `<option value="${k}" ${k === selected ? 'selected' : ''}>${escapeHtml(v)}</option>`
  ).join('');
}

function calcOpOptions(selected){
  return CALC_OPS.map(([k, v]) =>
    `<option value="${k}" ${k === selected ? 'selected' : ''}>${escapeHtml(v)}</option>`
  ).join('');
}

function numericFieldOptions(selected){
  const fields = (builderForm?.fields || []).filter(f =>
    ['number', 'calculated', 'readonly'].includes(f.field_type)
  );
  return fields.map(f =>
    `<option value="${f.id}" ${Number(selected) === f.id ? 'selected' : ''}>${escapeHtml(f.label)} (#${f.id})</option>`
  ).join('') || '<option value="">— add number fields first —</option>';
}

function openFieldModal(existing = null){
  const isEdit = Boolean(existing);
  const type = existing?.field_type || 'text';
  openModal(isEdit ? 'Edit field' : 'Add field', `
    <label>Label<input name="label" required value="${escapeHtml(existing?.label || '')}"></label>
    <label>Type<select name="field_type">${fieldTypeOptions(type)}</select></label>
    <label class="check-row"><input name="required" type="checkbox" ${existing?.required ? 'checked' : ''}><span>Required</span></label>
    <label class="tf-opt-readonly">Readonly value<input name="readonly_value" value="${escapeHtml(existing?.readonly_value || '')}"></label>
    <label class="tf-opt-select">Select options (one per line)<textarea name="options_text" rows="3">${escapeHtml((existing?.options || []).join('\n'))}</textarea></label>
    <label class="tf-opt-calc">Operation<select name="calc_op">${calcOpOptions(existing?.calc_op || 'add')}</select></label>
    <label class="tf-opt-calc">Left field<select name="calc_left">${numericFieldOptions(existing?.calc_left_field_id)}</select></label>
    <label class="tf-opt-calc">Right field<select name="calc_right">${numericFieldOptions(existing?.calc_right_field_id)}</select></label>
  `, async () => {
    const form = $('tf-modal-form');
    const body = {
      label: form.label.value.trim(),
      field_type: form.field_type.value,
      required: form.required.checked,
      readonly_value: form.readonly_value.value,
      options: form.options_text.value.split('\n').map(s => s.trim()).filter(Boolean),
      calc_op: form.calc_op.value,
      calc_left_field_id: Number(form.calc_left.value) || null,
      calc_right_field_id: Number(form.calc_right.value) || null,
    };
    if (isEdit) await TeamFormsApi.updateField(builderForm.id, existing.id, body);
    else await TeamFormsApi.addField(builderForm.id, body);
    toast(isEdit ? 'Field updated' : 'Field added');
    await openBuilderForm(builderForm.id);
  });
  const form = $('tf-modal-form');
  const syncType = () => {
    const t = form.field_type.value;
    form.querySelectorAll('.tf-opt-readonly').forEach(el => el.classList.toggle('hidden', t !== 'readonly'));
    form.querySelectorAll('.tf-opt-select').forEach(el => el.classList.toggle('hidden', t !== 'select'));
    form.querySelectorAll('.tf-opt-calc').forEach(el => el.classList.toggle('hidden', t !== 'calculated'));
  };
  form.field_type.addEventListener('change', syncType);
  syncType();
}

function openNewForm(){
  const gid = Number($('builder-group').value);
  if (!gid) {
    toast('Select a group first');
    return;
  }
  openModal('New form', `
    <label>Title<input name="title" required></label>
    <label>Description<textarea name="description" rows="2"></textarea></label>
  `, async () => {
    const form = $('tf-modal-form');
    const data = await TeamFormsApi.createForm(gid, {
      title: form.title.value.trim(),
      description: form.description.value.trim(),
    });
    toast('Form created');
    await loadBuilderForms();
    if (data.form?.id) await openBuilderForm(data.form.id);
  });
}

function openAssignModal(){
  if (!builderForm) return;
  openModal(`Assign · ${builderForm.title}`, `
    <p class="muted">Assignees must be members of this group. Each selected user gets a task. People with an open task are already checked and cannot be assigned again.</p>
    <label>Reviewer scope
      <select name="reviewer_scope">
        <option value="group">This group</option>
        <option value="department">Whole department</option>
      </select>
    </label>
    <div id="assign-user-list"><span class="muted">Loading members…</span></div>
  `, async () => {
    const form = $('tf-modal-form');
    const me = Number(getUser()?.id);
    const ids = [...form.querySelectorAll('input[name="assignee"]:checked:not(:disabled)')]
      .map(el => Number(el.value))
      .filter(id => id && id !== me);
    if (!ids.length) throw new Error('Select at least one new assignee');
    const res = await TeamFormsApi.assignForm(builderForm.id, {
      assignee_ids: ids,
      reviewer_scope: form.reviewer_scope.value,
    });
    const n = Number(res.count ?? ids.length);
    toast(n ? `Assigned to ${n} user(s)` : 'No new assignees (already assigned)');
  });
  Promise.all([
    TeamFormsApi.listMembers(builderForm.group_id),
    TeamFormsApi.listFormAssignments(builderForm.id),
  ]).then(([membersData, assignData]) => {
    const el = $('assign-user-list');
    const members = membersData.members || [];
    const openIds = new Set(
      (assignData.assignee_ids || []).map(id => Number(id))
    );
    // unique users
    const seen = new Set();
    const unique = [];
    for (const m of members) {
      if (seen.has(m.user_id)) continue;
      seen.add(m.user_id);
      unique.push(m);
    }
    if (!unique.length) {
      el.innerHTML = '<span class="muted">No group members to assign.</span>';
      return;
    }
    const me = Number(getUser()?.id);
    el.innerHTML = unique.map(m => {
      const already = openIds.has(Number(m.user_id));
      const isSelf = Number(m.user_id) === me;
      let extraClass = '';
      let checked = '';
      let disabled = '';
      let note = '';
      if (isSelf) {
        extraClass = ' is-self';
        disabled = ' disabled';
        note = ' <span class="muted">(you cannot assign this to yourself)</span>';
      } else if (already) {
        extraClass = ' is-assigned';
        checked = ' checked';
        disabled = ' disabled';
        note = ' <span class="muted">(already assigned)</span>';
      }
      return `<label class="tf-check-row${extraClass}">
        <input type="checkbox" name="assignee" value="${m.user_id}"${checked}${disabled}>
        <span>${escapeHtml(m.display_name)}${note}</span></label>`;
    }).join('');
  }).catch(err => {
    $('assign-user-list').textContent = err.message || 'Could not load members';
  });
}

/* —— Review —— */
async function refreshReview({silent = false} = {}){
  try {
    const data = await TeamFormsApi.reviewTasks();
    renderReviewBoard(data.tasks || []);
    const st = $('review-poll-status');
    if (st) st.textContent = `Updated ${data.polled_at || 'just now'} · live`;
  } catch (err) {
    if (!silent) toast(err.message || 'Review load failed');
    if (!silent) $('review-board').innerHTML = `<div class="empty-card">${escapeHtml(err.message || '')}</div>`;
  }
}

function renderReviewBoard(tasks){
  const mount = $('review-board');
  if (!tasks.length) {
    mount.innerHTML = '<div class="empty-card">No tasks in your review scope.</div>';
    return;
  }
  const table = document.createElement('table');
  table.className = 'admin-table';
  table.innerHTML = `<thead><tr>
    <th>Form</th><th>Assignee</th><th>Status</th><th>Progress</th><th>Group</th><th></th>
  </tr></thead>`;
  const tbody = document.createElement('tbody');
  for (const t of tasks) {
    const pct = t.progress?.percent ?? 0;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(t.form_title)}</td>
      <td>${escapeHtml(t.assignee_name || '')}</td>
      <td><span class="tf-status">${escapeHtml(statusLabel(t.status))}</span></td>
      <td>${pct}% <div class="tf-progress-bar"><span style="width:${pct}%"></span></div></td>
      <td>${escapeHtml(t.group_name)}</td><td></td>`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'secondary-button';
    btn.textContent = 'Open';
    btn.onclick = () => openTask(t.id, 'review');
    tr.lastElementChild.append(btn);
    tbody.append(tr);
  }
  table.append(tbody);
  mount.replaceChildren(table);
}

/* —— Task detail —— */
async function openTask(taskId, backView = 'workspace'){
  if (currentTask && Number(currentTask.id) !== Number(taskId)) {
    try { await flushTaskAutosave(); } catch { /* keep navigating */ }
  }
  taskBackView = backView;
  try {
    const data = await TeamFormsApi.getTask(taskId);
    currentTask = data.task;
    resetTaskFieldSearch();
    showView('task', {hash: false});
    renderTask();
  } catch (err) {
    toast(err.message || 'Could not open task');
  }
}

function taskAnswerMap(task){
  const map = {};
  for (const a of task.answers || []) map[a.field_id] = a.value ?? '';
  for (const f of task.fields || []) {
    if (f.field_type === 'readonly') map[f.id] = f.readonly_value ?? map[f.id] ?? '';
  }
  return applyCalculatedClient(task.fields || [], map);
}

function canEditTaskAnswers(task){
  const u = getUser();
  if (!u) return false;
  if (task.status === 'approved' || task.status === 'closed') return false;
  return u.is_super || Number(u.id) === Number(task.assignee_id);
}

function canAssigneeSetStatus(task){
  const u = getUser();
  if (!u) return false;
  if (!['pending', 'in_progress', 'rework'].includes(task.status)) return false;
  return u.is_super || Number(u.id) === Number(task.assignee_id);
}

function canReviewTask(task){
  const u = getUser();
  if (!u) return false;
  if (u.is_super || canManageOrg()) return true;
  return myRolesInGroup(task.group_id).includes('reviewer')
    || (u.org_memberships || []).some(m =>
      m.roles?.includes('reviewer') && (
        (task.reviewer_scope === 'group' && Number(m.group_id) === Number(task.group_id))
        || (task.reviewer_scope === 'department' && Number(m.department_id) === Number(task.department_id))
      )
    );
}

function canCloseTask(task){
  const u = getUser();
  if (!u) return false;
  if (task.status !== 'approved') return false;
  return u.is_super || canManageOrg() || myRolesInGroup(task.group_id).includes('form_creator');
}

function renderTask(){
  const task = currentTask;
  if (!task) return;
  $('task-title').textContent = task.form_title;
  $('task-meta').textContent =
    `${task.department_name} · ${task.group_name} · Assignee: ${task.assignee_name} · ${statusLabel(task.status)}`;

  const prog = task.progress || {percent: 0, filled: 0, total: 0};
  const progEl = $('task-progress');
  progEl.classList.remove('hidden');
  progEl.innerHTML = `Progress ${prog.filled}/${prog.total} (${prog.percent}%)
    <div class="tf-progress-bar"><span style="width:${prog.percent}%"></span></div>`;

  const actions = $('task-actions');
  actions.replaceChildren();
  const editable = canEditTaskAnswers(task);
  const statusWrap = document.createElement('div');
  statusWrap.className = 'tf-status-control';
  if (canAssigneeSetStatus(task)) {
    const statusLab = document.createElement('label');
    statusLab.className = 'tf-inline-label';
    statusLab.textContent = 'Status';
    const statusSel = document.createElement('select');
    statusSel.id = 'task-status-select';
    statusSel.setAttribute('aria-label', 'Task status');
    const opts = [['pending', 'Pending'], ['in_progress', 'In progress']];
    if (task.status === 'rework') opts.push(['rework', 'Rework']);
    opts.push(['submitted', 'Completed']);
    for (const [value, label] of opts) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      if (value === task.status) opt.selected = true;
      statusSel.append(opt);
    }
    statusSel.addEventListener('change', () => onTaskStatusChange(statusSel));
    statusLab.append(statusSel);
    statusWrap.append(statusLab);
  } else {
    const badge = document.createElement('span');
    badge.className = 'tf-status';
    badge.id = 'task-status-badge';
    badge.textContent = statusLabel(task.status);
    statusWrap.append(badge);
  }
  if (editable) {
    const hint = document.createElement('span');
    hint.id = 'task-save-hint';
    hint.className = 'muted tf-save-hint';
    hint.setAttribute('aria-live', 'polite');
    statusWrap.append(hint);
  }
  actions.append(statusWrap);
  if (canReviewTask(task) && task.status !== 'closed') {
    const approve = document.createElement('button');
    approve.type = 'button';
    approve.className = 'primary-button';
    approve.textContent = 'Approve';
    approve.onclick = async () => {
      try {
        const data = await TeamFormsApi.approveTask(task.id);
        currentTask = data.task;
        renderTask();
        toast('Approved');
      } catch (err) { toast(err.message || 'Approve failed'); }
    };
    const rework = document.createElement('button');
    rework.type = 'button';
    rework.className = 'secondary-button';
    rework.textContent = 'Send back for rework';
    rework.onclick = async () => {
      const note = prompt('Optional note for assignee:') || '';
      try {
        const data = await TeamFormsApi.reworkTask(task.id, note);
        currentTask = data.task;
        renderTask();
        toast('Sent back for rework');
      } catch (err) { toast(err.message || 'Rework failed'); }
    };
    actions.append(approve, rework);
  }
  if (canCloseTask(task)) {
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'primary-button';
    close.textContent = 'Close';
    close.onclick = async () => {
      try {
        const data = await TeamFormsApi.closeTask(task.id);
        currentTask = data.task;
        renderTask();
        toast('Task closed');
      } catch (err) { toast(err.message || 'Close failed'); }
    };
    actions.append(close);
  }

  const values = taskAnswerMap(task);
  const formMount = $('task-form');
  formMount.replaceChildren();
  if (task.form_description) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = task.form_description;
    formMount.append(p);
  }
  for (const f of task.fields || []) {
    const wrap = document.createElement('label');
    wrap.className = `tf-form-field ${f.field_type}`;
    wrap.dataset.fieldId = f.id;
    const title = document.createElement('span');
    title.textContent = f.label + (f.required ? ' *' : '');
    wrap.append(title);
    const val = values[f.id] ?? '';
    const locked = !editable || f.field_type === 'readonly' || f.field_type === 'calculated';
    let input;
    if (f.field_type === 'textarea') {
      input = document.createElement('textarea');
      input.rows = 3;
      input.value = val;
    } else if (f.field_type === 'select') {
      input = document.createElement('select');
      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = '—';
      input.append(blank);
      for (const opt of f.options || []) {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = opt;
        if (String(val) === String(opt)) o.selected = true;
        input.append(o);
      }
    } else if (f.field_type === 'checkbox') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = val === '1' || val === 'true' || val === true;
    } else if (f.field_type === 'number' || f.field_type === 'calculated') {
      input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'decimal';
      input.value = val;
    } else if (f.field_type === 'date') {
      input = document.createElement('input');
      input.type = 'date';
      input.value = val;
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.value = val;
    }
    input.dataset.fieldId = f.id;
    input.disabled = locked;
    if (!locked) {
      const liveCalc = f.field_type === 'number' || f.field_type === 'text' || f.field_type === 'textarea';
      input.addEventListener('input', () => {
        if (liveCalc) refreshCalculatedDom();
        scheduleTaskAutosave();
      });
      input.addEventListener('change', () => scheduleTaskAutosave());
    }
    wrap.append(input);
    formMount.append(wrap);
  }
  applyTaskFieldSearch({scroll: false});

  const cmt = $('task-comments');
  cmt.replaceChildren();
  for (const c of task.comments || []) {
    const div = document.createElement('div');
    div.className = 'tf-comment';
    div.innerHTML = `<strong>${escapeHtml(c.display_name)} <time>${escapeHtml(c.created_at || '')}</time></strong>
      <div>${escapeHtml(c.body)}</div>`;
    cmt.append(div);
  }
  if (!(task.comments || []).length) {
    cmt.innerHTML = '<p class="muted">No comments yet.</p>';
  }
}

function setTaskFieldSearchOpen(open){
  const panel = $('task-search-panel');
  const toggle = $('task-search-toggle');
  const input = $('task-search-input');
  panel?.classList.toggle('hidden', !open);
  toggle?.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) {
    input?.focus();
    input?.select();
  } else if (input) {
    input.value = '';
    applyTaskFieldSearch({scroll: false});
    input.blur();
  }
}

function toggleTaskFieldSearch(){
  const open = !$('task-search-panel')?.classList.contains('hidden');
  setTaskFieldSearchOpen(!open);
}

function resetTaskFieldSearch(){
  setTaskFieldSearchOpen(false);
}

function applyTaskFieldSearch({scroll = false} = {}){
  const q = ($('task-search-input')?.value || '').trim().toLowerCase();
  const fields = [...document.querySelectorAll('#task-form .tf-form-field')];
  const countEl = $('task-search-count');
  if (!q) {
    for (const el of fields) el.classList.remove('is-search-match', 'is-search-hide');
    if (countEl) countEl.textContent = '';
    return;
  }
  let n = 0;
  let first = null;
  for (const el of fields) {
    const label = el.querySelector('span')?.textContent || '';
    const input = el.querySelector('input, textarea, select');
    let val = '';
    if (input) {
      if (input.type === 'checkbox') val = input.checked ? 'checked' : '';
      else val = input.value || '';
    }
    const hit = `${label} ${val}`.toLowerCase().includes(q);
    el.classList.toggle('is-search-match', hit);
    el.classList.toggle('is-search-hide', !hit);
    if (hit) {
      n++;
      if (!first) first = el;
    }
  }
  if (countEl) countEl.textContent = n ? `${n} match${n === 1 ? '' : 'es'}` : 'No matches';
  if (scroll && first) first.scrollIntoView({block: 'center', behavior: 'smooth'});
}

function collectAnswersFromDom(){
  const answers = [];
  for (const f of currentTask.fields || []) {
    if (f.field_type === 'readonly' || f.field_type === 'calculated') continue;
    const input = document.querySelector(`#task-form [data-field-id="${f.id}"]`);
    if (!input) continue;
    let value;
    if (input.type === 'checkbox') value = input.checked ? '1' : '0';
    else value = input.value;
    answers.push({field_id: f.id, value});
  }
  return answers;
}

function refreshCalculatedDom(){
  if (!currentTask) return;
  const map = {};
  for (const f of currentTask.fields || []) {
    if (f.field_type === 'readonly') {
      map[f.id] = f.readonly_value ?? '';
      continue;
    }
    const input = document.querySelector(`#task-form [data-field-id="${f.id}"]`);
    if (!input) continue;
    if (input.type === 'checkbox') map[f.id] = input.checked ? '1' : '0';
    else map[f.id] = input.value;
  }
  const next = applyCalculatedClient(currentTask.fields, map);
  for (const f of currentTask.fields || []) {
    if (f.field_type !== 'calculated') continue;
    const input = document.querySelector(`#task-form [data-field-id="${f.id}"]`);
    if (input) input.value = next[f.id] ?? '';
  }
}

function setTaskSaveHint(text, isError = false){
  const el = $('task-save-hint');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('is-error', Boolean(isError));
}

function applyTaskProgress(task){
  const prog = task.progress || {percent: 0, filled: 0, total: 0};
  const progEl = $('task-progress');
  if (!progEl) return;
  progEl.classList.remove('hidden');
  progEl.innerHTML = `Progress ${prog.filled}/${prog.total} (${prog.percent}%)
    <div class="tf-progress-bar"><span style="width:${prog.percent}%"></span></div>`;
}

function applyTaskMeta(task){
  const meta = $('task-meta');
  if (!meta) return;
  meta.textContent =
    `${task.department_name} · ${task.group_name} · Assignee: ${task.assignee_name} · ${statusLabel(task.status)}`;
}

function scheduleTaskAutosave(){
  if (!currentTask || !canEditTaskAnswers(currentTask)) return;
  clearTimeout(taskSaveTimer);
  taskSaveTimer = setTimeout(() => { flushTaskAutosave().catch(() => {}); }, 550);
}

async function flushTaskAutosave(){
  clearTimeout(taskSaveTimer);
  taskSaveTimer = null;
  if (!currentTask || !canEditTaskAnswers(currentTask)) return;
  if (taskSaveInFlight) {
    try { await taskSaveInFlight; } catch { /* prior save error; still try latest */ }
  }
  if (!currentTask || !canEditTaskAnswers(currentTask)) return;
  const answers = collectAnswersFromDom();
  setTaskSaveHint('Saving…');
  const run = (async () => {
    const data = await TeamFormsApi.saveAnswers(currentTask.id, answers);
    const prevStatus = currentTask.status;
    currentTask = data.task;
    applyTaskProgress(currentTask);
    applyTaskMeta(currentTask);
    const sel = $('task-status-select');
    if (sel && currentTask.status !== prevStatus && sel.value === prevStatus) {
      sel.value = currentTask.status;
    }
    setTaskSaveHint('Saved');
  })();
  taskSaveInFlight = run;
  try {
    await run;
  } catch (err) {
    setTaskSaveHint(err.message || 'Save failed', true);
    throw err;
  } finally {
    if (taskSaveInFlight === run) taskSaveInFlight = null;
  }
}

async function onTaskStatusChange(statusSel){
  if (!currentTask) return;
  const next = statusSel.value;
  const prev = currentTask.status;
  if (next === prev) return;
  if (next === 'submitted') {
    const ok = confirm('You are about to mark this task completed. Continue?');
    if (!ok) {
      statusSel.value = prev;
      return;
    }
  }
  statusSel.disabled = true;
  try {
    try {
      await flushTaskAutosave();
    } catch {
      /* still attempt status + latest answers */
    }
    const data = await TeamFormsApi.setStatus(currentTask.id, next, {
      answers: collectAnswersFromDom(),
    });
    currentTask = data.task;
    renderTask();
    toast(next === 'submitted' ? 'Marked completed' : 'Status updated');
  } catch (err) {
    statusSel.value = prev;
    toast(err.message || 'Status failed');
  } finally {
    statusSel.disabled = false;
  }
}

function updateNavVisibility(){
  const u = getUser();
  document.querySelectorAll('.nav-item[data-perm]').forEach(btn => {
    const perm = btn.dataset.perm;
    if (perm && !hasPermission(perm) && !u?.is_super) btn.classList.add('hidden');
    else if (perm) btn.classList.remove('hidden');
  });
  const builderBtn = document.querySelector('.nav-item[data-view="builder"]');
  const reviewBtn = document.querySelector('.nav-item[data-view="review"]');
  if (builderBtn) builderBtn.classList.toggle('hidden', !isFormCreatorAnywhere());
  if (reviewBtn) reviewBtn.classList.toggle('hidden', !isReviewerAnywhere());
}

/* —— Shell wiring —— */
function readSidebarCollapsedPref(){
  try { return localStorage.getItem(storageKey('sidebarCollapsed')) === '1'; }
  catch { return false; }
}
function writeSidebarCollapsedPref(collapsed){
  try { localStorage.setItem(storageKey('sidebarCollapsed'), collapsed ? '1' : '0'); }
  catch { /* ignore */ }
}
function applySidebarCollapsed(collapsed, {persist = true} = {}){
  const shell = document.querySelector('.shell');
  if (!shell) return;
  shell.classList.toggle('sidebar-collapsed', Boolean(collapsed));
  const btn = $('mobile-menu');
  if (btn) {
    btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    btn.setAttribute('aria-label', collapsed ? 'Show left panel' : 'Hide left panel');
  }
  if (persist) writeSidebarCollapsedPref(Boolean(collapsed));
}

document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.view === 'task') return;
    showView(btn.dataset.view);
  });
});

$('mobile-menu')?.addEventListener('click', () => {
  const shell = document.querySelector('.shell');
  if (!shell) return;
  if (window.matchMedia('(max-width:850px)').matches) {
    shell.classList.toggle('menu-open');
    return;
  }
  applySidebarCollapsed(!shell.classList.contains('sidebar-collapsed'));
});

$('shell-logout')?.addEventListener('click', async () => {
  stopReviewPoll();
  await logout();
  setStorageUserId(null);
  location.href = homePath();
});

$('shell-account')?.addEventListener('click', () => {
  const user = getUser();
  const modal = $('account-modal');
  if (!user || !modal) return;
  $('account-username').value = user.username || '';
  $('account-display').value = user.display_name || '';
  $('account-pw-current').value = '';
  $('account-pw-new').value = '';
  $('account-pw-confirm').value = '';
  $('account-message').textContent = '';
  modal.classList.remove('hidden');
});
$('account-cancel')?.addEventListener('click', () => $('account-modal')?.classList.add('hidden'));
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
    setTimeout(() => $('account-modal')?.classList.add('hidden'), 600);
  } catch (err) {
    msg.textContent = err.message || 'Save failed';
  }
});

$('ws-refresh')?.addEventListener('click', () => refreshWorkspace());
$('org-refresh')?.addEventListener('click', () => refreshOrg());
$('org-new-dept')?.addEventListener('click', () => openNewDept());
$('builder-refresh')?.addEventListener('click', () => refreshBuilder());
$('builder-new-form')?.addEventListener('click', () => openNewForm());
$('builder-add-field')?.addEventListener('click', () => openFieldModal(null));
$('builder-assign')?.addEventListener('click', () => openAssignModal());
$('builder-delete-form')?.addEventListener('click', () => deleteBuilderForm(builderForm));
$('builder-group')?.addEventListener('change', () => loadBuilderForms());
$('review-refresh')?.addEventListener('click', () => refreshReview());
$('task-back')?.addEventListener('click', () => showView(taskBackView || 'workspace'));
$('task-search-toggle')?.addEventListener('click', () => toggleTaskFieldSearch());
$('task-search-input')?.addEventListener('input', () => applyTaskFieldSearch({scroll: true}));
$('task-search-input')?.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    e.preventDefault();
    const input = $('task-search-input');
    if (input?.value) {
      input.value = '';
      applyTaskFieldSearch({scroll: false});
    } else {
      setTaskFieldSearchOpen(false);
    }
  }
});
$('task-comment-send')?.addEventListener('click', async () => {
  const body = $('task-comment-input').value.trim();
  if (!body || !currentTask) return;
  try {
    const data = await TeamFormsApi.addComment(currentTask.id, body);
    currentTask = data.task;
    $('task-comment-input').value = '';
    renderTask();
  } catch (err) { toast(err.message || 'Comment failed'); }
});

async function boot(){
  initTheme();
  const user = await requireAuth({loginPath: homePath()});
  if (!user) return;
  if (!hasPermission('module.team_forms') && !hasPermission('team_forms.use') && !user.is_super) {
    location.href = homePath();
    return;
  }
  setStorageUserId(user.id);
  applySidebarCollapsed(readSidebarCollapsedPref(), {persist: false});
  $('shell-user-label').textContent = user.display_name || user.username;
  if ($('sidebar-version')) $('sidebar-version').textContent = `v${VERSION}`;

  updateNavVisibility();
  mountNotifications({
    variant: 'chrome',
    onOpenAccessRequests: () => { location.href = appUrl('/admin/'); },
    onTeamFormsTask: (meta) => {
      if (meta?.task_id) openTask(meta.task_id, 'review');
      else showView('review');
    },
  });

  const hash = location.hash.slice(1);
  const start = ['workspace', 'org', 'builder', 'review'].includes(hash) ? hash : 'workspace';
  try {
    if (start !== 'workspace') await refreshWorkspace();
  } catch { /* showView will retry */ }
  showView(start);

  window.addEventListener('hashchange', () => {
    const h = location.hash.slice(1);
    if (['workspace', 'org', 'builder', 'review'].includes(h) && h !== currentView) showView(h, {hash: false});
  });
}

boot();

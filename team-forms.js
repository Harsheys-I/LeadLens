/**
 * Team Forms - org, form builder, task builder, assignee workspace, review board.
 */
import {APP_VERSION} from './audit.js?v=8.0.0.stable';
import {requireAuth, logout, hasPermission, getUser, changePassword, updateProfile} from './auth.js?v=8.0.0.stable';
import {TeamFormsApi} from './api-client.js?v=8.0.0.stable';
import {mountNotifications} from './notifications-ui.js?v=8.0.0.stable';
import {appUrl, homePath} from './app-base.js?v=8.0.0.stable';
import {initTheme} from './theme.js?v=8.0.0.stable';
import {setStorageUserId, storageKey} from './db.js?v=8.0.0.stable';

const $ = id => document.getElementById(id);
const VERSION = APP_VERSION || '8.0.0.stable';
const POLL_MS = 7000;

const titles = {
  workspace: 'My workspace',
  org: 'Org',
  builder: 'Form Builder',
  'task-builder': 'Task Builder',
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
  ['url', 'URL'],
  ['document', 'Document'],
  ['select', 'Select'],
  ['checkbox', 'Checkbox'],
  ['date', 'Date'],
  ['readonly', 'Readonly'],
  ['calculated', 'Calculated'],
];

const TF_DOC_MAX_BYTES = 10 * 1024 * 1024;
const TF_DOC_ACCEPT = '.pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods';
const TF_DOC_EXTS = new Set(TF_DOC_ACCEPT.split(',').map(s => s.replace('.', '').toLowerCase()));

function isSystemField(f){
  const type = f?.field_type || '';
  const key = f?.field_key || '';
  return Boolean(f?.is_system) || ['assign_to', 'status', 'reviewer'].includes(type) || String(key).startsWith('sys_');
}

function uniqueGroupPeople(members, {excludeUserId, role} = {}){
  const seen = new Set();
  const out = [];
  for (const m of members || []) {
    const uid = Number(m.user_id);
    if (!uid || seen.has(uid)) continue;
    if (excludeUserId != null && uid === Number(excludeUserId)) continue;
    if (role && m.role !== role) continue;
    seen.add(uid);
    out.push(m);
  }
  return out;
}

function fillStatusSelect(sel, current, {includeRework = false, includeCompleted = true} = {}){
  const opts = [['pending', 'Pending'], ['in_progress', 'In progress']];
  if (includeRework && current === 'rework') opts.push(['rework', 'Rework']);
  if (includeCompleted) opts.push(['completed', 'Completed']);
  sel.replaceChildren();
  for (const [value, label] of opts) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    if (value === current) opt.selected = true;
    sel.append(opt);
  }
}

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
let builderDragFieldId = null;
let taskBuilderGroupId = null;
let taskBuilderForm = null;
let taskBuilderPrefetchFormId = null;
let taskBuilderStep = 'pick';
let taskBuilderTask = null;
let currentTask = null;
let taskBackView = 'workspace';
let reviewTimer = null;
let modalSubmitHandler = null;
let taskSaveTimer = null;
let taskSaveInFlight = null;
let commentDraft = {text: '', files: [], links: [], timeSpent: ''};
let commentDraftTaskId = null;

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
    submitted: 'Submitted',
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

/** Empty is allowed; complete values must be a finite decimal (no letters / scientific notation). */
function isNumericFieldValue(s){
  if (s == null) return true;
  const t = String(s).trim();
  if (t === '') return true;
  return /^-?(?:\d+\.?\d*|\.\d+)$/.test(t) && Number.isFinite(Number(t));
}

function bindNumberOnly(input){
  const blockNonNumericKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key;
    if (!key || key.length !== 1) return;
    if (/\d/.test(key)) return;
    if ((key === '.' || key === ',') && !String(input.value || '').includes('.')) return;
    if (key === '-' && !String(input.value || '').includes('-')) return;
    e.preventDefault();
  };
  input.addEventListener('keydown', blockNonNumericKey);
  input.addEventListener('beforeinput', (e) => {
    if (!e.data) return;
    if (/[^\d.\-]/.test(e.data)) e.preventDefault();
  });
  input.addEventListener('paste', (e) => {
    const t = ((e.clipboardData || window.clipboardData)?.getData('text') || '').trim();
    if (t !== '' && !isNumericFieldValue(t)) e.preventDefault();
  });
  input.addEventListener('drop', (e) => {
    const t = (e.dataTransfer?.getData('text') || '').trim();
    if (t !== '' && !isNumericFieldValue(t)) e.preventDefault();
  });
}

function taskFieldControl(fieldId){
  const rootId = currentView === 'task-builder' ? 'task-builder-fields' : 'task-form';
  const wrap = document.querySelector(`#${rootId} .tf-form-field[data-field-id="${fieldId}"]`);
  return wrap?.querySelector('input, textarea, select') || null;
}

function isValidUrlValue(s){
  if (s == null) return true;
  const t = String(s).trim();
  if (t === '') return true;
  try {
    const u = new URL(t);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseDocumentAnswer(val){
  if (!val) return null;
  if (typeof val === 'object' && val.name) return val;
  try {
    const o = JSON.parse(String(val));
    return o && o.name ? o : null;
  } catch {
    return null;
  }
}

function renderUrlLink(href){
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = href;
  return a;
}

function parseTimeSpentMinutes(raw){
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const hm = s.match(/^(\d+)\s*:\s*(\d{1,2})$/);
  if (hm) {
    const minutes = Number(hm[2]);
    if (minutes > 59) return null;
    const total = Number(hm[1]) * 60 + minutes;
    return total > 0 ? total : null;
  }
  if (/^\d+$/.test(s)) {
    const hours = Number(s);
    const total = hours * 60;
    return total > 0 ? total : null;
  }
  if (/^\d+\.\d+$/.test(s)) {
    const total = Math.round(Number(s) * 60);
    return total > 0 ? total : null;
  }
  return null;
}

function formatTimeSpent(mins){
  const n = Number(mins);
  if (!Number.isFinite(n) || n <= 0) return '';
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function reviewerNames(task){
  if (Array.isArray(task?.reviewers) && task.reviewers.length) {
    return task.reviewers.map(r => r.display_name).filter(Boolean).join(', ');
  }
  return task?.reviewer_name || '';
}

function syncCommentDraft(taskId){
  const id = Number(taskId);
  if (commentDraftTaskId !== id) {
    commentDraft = {text: '', files: [], links: [], timeSpent: ''};
    commentDraftTaskId = id;
  }
}

function commentFileOk(file){
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!TF_DOC_EXTS.has(ext)) {
    toast('File type not allowed');
    return false;
  }
  if (file.size > TF_DOC_MAX_BYTES) {
    toast('File must be 10 MB or smaller');
    return false;
  }
  return true;
}

function renderCommentAttachments(div, comment, taskId){
  const atts = comment.attachments || [];
  if (!atts.length) return;
  const wrap = document.createElement('div');
  wrap.className = 'tf-comment-atts';
  for (const att of atts) {
    if (att.type === 'file') {
      const a = document.createElement('a');
      a.className = 'tf-comment-att';
      a.href = TeamFormsApi.commentFileUrl(taskId, comment.id, att.index);
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = att.name || 'Download file';
      wrap.append(a);
      continue;
    }
    if (att.type === 'link' && att.url && isValidUrlValue(att.url)) {
      const a = renderUrlLink(att.url);
      a.className = 'tf-comment-att';
      if (att.label) a.textContent = att.label;
      wrap.append(a);
    }
  }
  if (wrap.childNodes.length) div.append(wrap);
}

function renderCommentPending(root){
  const mount = root.querySelector('.tf-comment-pending');
  if (!mount) return;
  mount.replaceChildren();
  commentDraft.files.forEach((file, i) => {
    const chip = document.createElement('span');
    chip.className = 'tf-comment-chip';
    const label = document.createElement('span');
    label.textContent = file.name;
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.setAttribute('aria-label', `Remove ${file.name}`);
    rm.textContent = '×';
    rm.onclick = () => {
      commentDraft.files.splice(i, 1);
      renderCommentPending(root);
    };
    chip.append(label, rm);
    mount.append(chip);
  });
  commentDraft.links.forEach((link, i) => {
    const chip = document.createElement('span');
    chip.className = 'tf-comment-chip';
    const label = document.createElement('span');
    label.textContent = link.label || link.url;
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.setAttribute('aria-label', `Remove ${link.url}`);
    rm.textContent = '×';
    rm.onclick = () => {
      commentDraft.links.splice(i, 1);
      renderCommentPending(root);
    };
    chip.append(label, rm);
    mount.append(chip);
  });
}

function addCommentLinkFromInput(root){
  const input = root.querySelector('.tf-comment-link-input');
  const raw = (input?.value || '').trim();
  if (!raw) return;
  if (!isValidUrlValue(raw) || raw === '') {
    toast('Enter an http(s) URL');
    return;
  }
  if (commentDraft.links.length >= 10) {
    toast('At most 10 links per comment');
    return;
  }
  if (commentDraft.links.some(l => l.url === raw)) {
    input.value = '';
    return;
  }
  commentDraft.links.push({url: raw, label: ''});
  input.value = '';
  renderCommentPending(root);
}

async function sendTaskComment(task){
  const body = commentDraft.text.trim();
  if (!body && !commentDraft.files.length && !commentDraft.links.length) return;
  const data = await TeamFormsApi.addComment(task.id, {
    body,
    files: commentDraft.files.slice(),
    links: commentDraft.links.map(l => ({url: l.url, label: l.label || ''})),
    time_spent_minutes: parseTimeSpentMinutes(commentDraft.timeSpent),
  });
  commentDraft = {text: '', files: [], links: [], timeSpent: ''};
  commentDraftTaskId = Number(data.task?.id || task.id);
  currentTask = data.task;
  if (currentView === 'task-builder') taskBuilderTask = currentTask;
  return data.task;
}

function bindCommentComposer(root, task){
  const ta = root.querySelector('.tf-comment-input');
  const fileInput = root.querySelector('.tf-comment-file');
  ta?.addEventListener('input', () => { commentDraft.text = ta.value; });
  ta?.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      root.querySelector('.tf-comment-send')?.click();
    }
  });
  root.querySelector('.tf-comment-attach')?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', () => {
    for (const file of [...(fileInput.files || [])]) {
      if (!commentFileOk(file)) continue;
      if (commentDraft.files.length >= 8) {
        toast('At most 8 files per comment');
        break;
      }
      if (commentDraft.files.some(f => f.name === file.name && f.size === file.size)) continue;
      commentDraft.files.push(file);
    }
    fileInput.value = '';
    renderCommentPending(root);
  });
  root.querySelector('.tf-comment-add-link')?.addEventListener('click', () => addCommentLinkFromInput(root));
  root.querySelector('.tf-comment-link-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCommentLinkFromInput(root);
    }
  });
  root.querySelector('.tf-comment-send')?.addEventListener('click', async () => {
    const btn = root.querySelector('.tf-comment-send');
    if (btn) btn.disabled = true;
    try {
      const latest = await sendTaskComment(task);
      if (!latest) return;
      refreshCommentsPanel(latest);
    } catch (err) {
      toast(err.message || 'Comment failed');
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

function refreshCommentsPanel(task){
  const mount = $('task-comments-panel');
  if (mount) renderCommentsPanel(mount, task);
}

function renderCommentsPanel(mount, task, {embedded = false} = {}){
  if (!mount || !task) return;
  const live = document.querySelector('.tf-comment-input');
  if (live && Number(commentDraftTaskId) === Number(task.id)) {
    commentDraft.text = live.value;
  }
  const liveTime = document.querySelector('.tf-comment-time-spent-input');
  if (liveTime && Number(commentDraftTaskId) === Number(task.id)) {
    commentDraft.timeSpent = liveTime.value;
  }
  syncCommentDraft(task.id);
  mount.classList.toggle('tf-comments-embed', embedded);
  mount.replaceChildren();
  const h = document.createElement('h3');
  h.textContent = 'Comments';
  mount.append(h);
  const thread = document.createElement('div');
  const comments = task.comments || [];
  if (!comments.length) {
    thread.innerHTML = '<p class="muted">No comments yet.</p>';
  } else {
    for (const c of comments) {
      const div = document.createElement('div');
      div.className = 'tf-comment';
      const strong = document.createElement('strong');
      strong.append(document.createTextNode(c.display_name || 'User'));
      const meta = document.createElement('span');
      meta.className = 'tf-comment-meta';
      if (c.status_at_time) {
        const st = document.createElement('span');
        st.className = 'tf-status';
        st.textContent = statusLabel(c.status_at_time);
        meta.append(st);
      }
      const spent = formatTimeSpent(c.time_spent_minutes);
      if (spent) {
        const chip = document.createElement('span');
        chip.className = 'tf-comment-time-spent';
        chip.textContent = spent;
        meta.append(chip);
      }
      const time = document.createElement('time');
      time.textContent = c.created_at || '';
      meta.append(time);
      strong.append(meta);
      div.append(strong);
      if (c.body) {
        const body = document.createElement('div');
        body.className = 'tf-comment-body';
        body.textContent = c.body;
        div.append(body);
      }
      renderCommentAttachments(div, c, task.id);
      thread.append(div);
    }
  }
  mount.append(thread);

  const composer = document.createElement('div');
  composer.className = 'tf-comment-composer';
  const ta = document.createElement('textarea');
  ta.className = 'tf-comment-input';
  ta.rows = 2;
  ta.placeholder = 'Add a comment';
  ta.value = commentDraft.text;
  const tools = document.createElement('div');
  tools.className = 'inline-actions tf-comment-tools';
  const fileInput = document.createElement('input');
  fileInput.className = 'tf-comment-file';
  fileInput.type = 'file';
  fileInput.multiple = true;
  fileInput.accept = TF_DOC_ACCEPT;
  fileInput.hidden = true;
  const attachBtn = document.createElement('button');
  attachBtn.type = 'button';
  attachBtn.className = 'secondary-button tf-comment-attach';
  attachBtn.textContent = 'Attach file';
  const linkInput = document.createElement('input');
  linkInput.className = 'tf-comment-link-input';
  linkInput.type = 'url';
  linkInput.placeholder = 'https:// link';
  linkInput.inputMode = 'url';
  linkInput.autocomplete = 'off';
  const addLinkBtn = document.createElement('button');
  addLinkBtn.type = 'button';
  addLinkBtn.className = 'secondary-button tf-comment-add-link';
  addLinkBtn.textContent = 'Add link';
  const sendBtn = document.createElement('button');
  sendBtn.type = 'button';
  sendBtn.className = 'secondary-button tf-comment-send';
  sendBtn.textContent = 'Send';
  const timeRow = document.createElement('label');
  timeRow.className = 'tf-inline-label tf-time-spent-row';
  timeRow.textContent = 'Time spent';
  const timeInput = document.createElement('input');
  timeInput.className = 'tf-comment-time-spent-input';
  timeInput.type = 'text';
  timeInput.inputMode = 'decimal';
  timeInput.placeholder = 'hours or hh:mm';
  timeInput.autocomplete = 'off';
  timeInput.value = commentDraft.timeSpent || '';
  timeInput.addEventListener('input', () => { commentDraft.timeSpent = timeInput.value; });
  timeRow.append(timeInput);
  tools.append(fileInput, attachBtn, linkInput, addLinkBtn, sendBtn);
  const pending = document.createElement('div');
  pending.className = 'tf-comment-pending';
  composer.append(ta, timeRow, tools, pending);
  mount.append(composer);
  bindCommentComposer(composer, task);
  renderCommentPending(composer);
}

function eventHistoryLabel(ev){
  switch (ev?.event_type) {
    case 'created':
      return ev.to_status ? `Task created (${statusLabel(ev.to_status)})` : 'Task created';
    case 'assigned':
      return ev.detail ? `Task assigned to ${ev.detail}` : 'Task assigned';
    case 'status_changed':
      return `Status changed: ${statusLabel(ev.from_status)} → ${statusLabel(ev.to_status)}`;
    case 'submitted':
      return 'Submitted';
    case 'rework':
      return 'Sent back for rework';
    case 'approved':
      return 'Approved';
    case 'closed':
      return 'Closed';
    default:
      return ev?.event_type || 'Update';
  }
}

function renderTaskHistory(mount, task){
  if (!mount || !task) return;
  mount.replaceChildren();
  const h = document.createElement('h3');
  h.textContent = 'Task History';
  mount.append(h);
  const events = task.events || [];
  if (!events.length) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'No history yet.';
    mount.append(p);
    return;
  }
  const list = document.createElement('div');
  list.className = 'tf-history-list';
  for (const ev of events) {
    const item = document.createElement('div');
    item.className = 'tf-history-item';
    const what = document.createElement('div');
    what.className = 'tf-history-what';
    what.textContent = eventHistoryLabel(ev);
    const meta = document.createElement('div');
    meta.className = 'tf-history-meta';
    meta.textContent = [ev.display_name || 'System', ev.created_at || ''].filter(Boolean).join(' · ');
    item.append(what, meta);
    list.append(item);
  }
  mount.append(list);
}

function openSubmitTaskModal(task){
  openModal('Submit task', `
    <p class="muted">Add an optional final comment or document, then submit for review.</p>
    <label>Final comment
      <textarea id="tf-submit-comment" rows="3" placeholder="Optional comment"></textarea>
    </label>
    <label>Attach a document
      <input id="tf-submit-file" type="file" accept="${TF_DOC_ACCEPT}">
    </label>
  `, async () => {
    const body = ($('tf-submit-comment')?.value || '').trim();
    const file = $('tf-submit-file')?.files?.[0] || null;
    if (file && !commentFileOk(file)) throw new Error('File not allowed');
    const data = await TeamFormsApi.submitTask(task.id, {body, files: file ? [file] : []});
    currentTask = data.task;
    if (currentView === 'task-builder') taskBuilderTask = currentTask;
    renderTask();
    toast('Task submitted');
  }, 'Submit');
}

async function uploadTaskDocument(field, input, row){
  const file = input.files?.[0];
  if (!file || !currentTask) return;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!TF_DOC_EXTS.has(ext)) {
    toast('File type not allowed');
    input.value = '';
    return;
  }
  if (file.size > TF_DOC_MAX_BYTES) {
    toast('File must be 10 MB or smaller');
    input.value = '';
    return;
  }
  setTaskSaveHint('Uploading…');
  try {
    const data = await TeamFormsApi.uploadTaskFile(currentTask.id, field.id, file);
    currentTask = data.task;
    applyTaskProgress(currentTask);
    applyTaskMeta(currentTask);
    const nameEl = row.querySelector('.tf-file-name');
    if (nameEl) {
      nameEl.replaceChildren();
      const a = document.createElement('a');
      a.href = TeamFormsApi.taskFileUrl(currentTask.id, field.id);
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = file.name;
      nameEl.append(a);
    }
    setTaskSaveHint('Saved');
  } catch (err) {
    setTaskSaveHint(err.message || 'Upload failed', true);
    toast(err.message || 'Upload failed');
    input.value = '';
  }
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
  if ((currentView === 'task' && name !== 'task')
    || (currentView === 'task-builder' && name !== 'task-builder')) {
    flushTaskAutosave().catch(() => {});
  }
  if (name === 'org' && !canManageOrg()) {
    toast('Org management requires permission.');
    return;
  }
  if (name === 'builder' && !isFormCreatorAnywhere()) {
    toast('Form Builder requires Form Creator membership.');
    return;
  }
  if (name === 'task-builder' && !isFormCreatorAnywhere()) {
    toast('Task Builder requires Form Creator membership.');
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
  if (name === 'task-builder') refreshTaskBuilder();
  if (name === 'review') refreshReview();
}

function openModal(title, bodyHtml, onSubmit, submitLabel = 'Save'){
  $('tf-modal-title').textContent = title;
  $('tf-modal-body').innerHTML = bodyHtml;
  $('tf-modal-message').textContent = '';
  modalSubmitHandler = onSubmit;
  const btn = $('tf-modal-form')?.querySelector('button[type="submit"]');
  if (btn) btn.textContent = submitLabel;
  $('tf-modal').classList.remove('hidden');
}

function closeModal(){
  $('tf-modal').classList.add('hidden');
  modalSubmitHandler = null;
  const btn = $('tf-modal-form')?.querySelector('button[type="submit"]');
  if (btn) btn.textContent = 'Save';
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

/* -- Workspace -- */
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
    <th>Task</th><th>Department</th><th>Group</th><th>Status</th><th>Updated</th><th></th>
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
    appendTaskDeleteButton(tr.lastElementChild, t, {onDeleted: refreshWorkspace});
    tbody.append(tr);
  }
  table.append(tbody);
  mount.replaceChildren(table);
}

/* -- Org -- */
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

/* -- Form Builder -- */
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
    toast(err.message || 'Form Builder load failed');
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
      mount.innerHTML = '<div class="empty-card">No templates in this group yet.</div>';
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
      (builderForm.description ? ` - ${builderForm.description}` : '');
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
  if (!confirm(`Delete template “${target.title}”? This also removes tasks created from it and their answers.`)) {
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
    mount.innerHTML = '<div class="empty-card">No fields yet. Add text, number, URL, document, readonly, or calculated fields.</div>';
    return;
  }
  mount.replaceChildren();
  for (const f of fields) {
    const row = document.createElement('div');
    row.className = 'tf-field-row';
    row.dataset.fieldId = String(f.id);
    const orderNo = fields.indexOf(f) + 1;
    const system = isSystemField(f);
    let detail = `#${orderNo} · ${escapeHtml(f.field_type)}`;
    if (system) detail += ' · system';
    if (f.field_type === 'readonly') detail += ` · value “${escapeHtml(f.readonly_value || '')}”`;
    if (f.field_type === 'calculated') {
      detail += ` · ${escapeHtml(f.calc_op || '')} (${escapeHtml(builderFieldRefLabel(f.calc_left_field_id, false))} , ${escapeHtml(builderFieldRefLabel(f.calc_right_field_id, false))})`;
    }
    if (f.required && !system) detail += ' · required';
    if (!system && f.creator_only) detail += ' · Task Builder only';
    else if (!system) detail += ' · assignee can edit';
    row.innerHTML = `<div class="tf-field-head">
      <span class="tf-drag-handle" role="button" tabindex="0" draggable="true" aria-label="Reorder ${escapeHtml(f.label)}. Drag or use arrow keys." title="Drag to reorder">
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor">
          <circle cx="5" cy="3.5" r="1.35"/><circle cx="11" cy="3.5" r="1.35"/>
          <circle cx="5" cy="8" r="1.35"/><circle cx="11" cy="8" r="1.35"/>
          <circle cx="5" cy="12.5" r="1.35"/><circle cx="11" cy="12.5" r="1.35"/>
        </svg>
      </span>
      <div class="tf-field-meta"><strong>${escapeHtml(f.label)}</strong>
      <div class="muted" style="font-size:12px;font-weight:400">${detail}</div></div>
      <div class="inline-actions"></div></div>`;
    const actions = row.querySelector('.inline-actions');
    if (!system) {
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
      actions.append(edit, del);
    } else {
      const locked = document.createElement('span');
      locked.className = 'muted';
      locked.style.fontSize = '12px';
      locked.textContent = 'Locked';
      actions.append(locked);
    }
    mount.append(row);
  }
}

function sameFieldOrder(a, b){
  return a.length === b.length && a.every((f, i) => Number(f.id) === Number(b[i]?.id));
}

function clearBuilderFieldDropState(mount = $('builder-fields')){
  mount?.querySelectorAll('.tf-field-row').forEach(row => {
    row.classList.remove('is-dragging', 'drop-before', 'drop-after');
    row.querySelector('.tf-drag-handle')?.removeAttribute('aria-grabbed');
  });
  builderDragFieldId = null;
}

function reorderBuilderFieldsTo(fromId, toId, placeBefore){
  const fields = builderForm?.fields || [];
  const from = fields.findIndex(f => Number(f.id) === Number(fromId));
  if (from < 0 || Number(fromId) === Number(toId)) return;
  const next = fields.slice();
  const [item] = next.splice(from, 1);
  let insertAt = next.findIndex(f => Number(f.id) === Number(toId));
  if (insertAt < 0) return;
  if (!placeBefore) insertAt += 1;
  next.splice(insertAt, 0, item);
  if (sameFieldOrder(next, fields)) return;
  persistBuilderFieldOrder(next);
}

function bindBuilderFieldReorder(mount){
  if (!mount || mount.dataset.reorderBound) return;
  mount.dataset.reorderBound = '1';

  mount.addEventListener('dragstart', e => {
    const handle = e.target.closest?.('.tf-drag-handle');
    const row = handle?.closest('.tf-field-row');
    if (!row || !mount.contains(row)) {
      e.preventDefault();
      return;
    }
    builderDragFieldId = Number(row.dataset.fieldId);
    row.classList.add('is-dragging');
    handle.setAttribute('aria-grabbed', 'true');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(builderDragFieldId));
    try { e.dataTransfer.setDragImage(row, 20, 16); } catch { /* optional ghost */ }
  });

  mount.addEventListener('dragover', e => {
    if (builderDragFieldId == null) return;
    const row = e.target.closest('.tf-field-row');
    if (!row || !mount.contains(row)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = row.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    mount.querySelectorAll('.tf-field-row').forEach(el => el.classList.remove('drop-before', 'drop-after'));
    row.classList.add(before ? 'drop-before' : 'drop-after');
  });

  mount.addEventListener('drop', e => {
    const row = e.target.closest('.tf-field-row');
    if (!row || builderDragFieldId == null || !mount.contains(row)) return;
    e.preventDefault();
    const rect = row.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    const fromId = builderDragFieldId;
    const toId = Number(row.dataset.fieldId);
    clearBuilderFieldDropState(mount);
    reorderBuilderFieldsTo(fromId, toId, before);
  });

  mount.addEventListener('dragend', () => clearBuilderFieldDropState(mount));

  mount.addEventListener('keydown', e => {
    const handle = e.target.closest('.tf-drag-handle');
    if (!handle || !mount.contains(handle)) return;
    const row = handle.closest('.tf-field-row');
    if (!row) return;
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveBuilderField(Number(row.dataset.fieldId), -1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveBuilderField(Number(row.dataset.fieldId), 1);
    }
  });
}

async function persistBuilderFieldOrder(next, {focusId} = {}){
  builderForm.fields = next;
  renderBuilderFields();
  try {
    const data = await TeamFormsApi.reorderFields(builderForm.id, next.map(f => f.id));
    if (data.fields) builderForm.fields = data.fields;
    renderBuilderFields();
  } catch (err) {
    toast(err.message || 'Reorder failed');
    if (builderForm?.id) await openBuilderForm(builderForm.id);
    return;
  }
  if (focusId != null) {
    $('builder-fields')?.querySelector(`[data-field-id="${focusId}"] .tf-drag-handle`)?.focus();
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
  await persistBuilderFieldOrder(next, {focusId: fieldId});
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

function builderFieldOrderIndex(fieldId){
  return (builderForm?.fields || []).findIndex(f => Number(f.id) === Number(fieldId));
}

function builderFieldRefLabel(fieldId, withLabel = true){
  const i = builderFieldOrderIndex(fieldId);
  if (i < 0) return '-';
  const n = `#${i + 1}`;
  if (!withLabel) return n;
  return `${n} ${builderForm.fields[i].label}`;
}

function numericFieldOptions(selected, excludeId = null){
  const fields = (builderForm?.fields || []).filter(f =>
    ['number', 'calculated', 'readonly'].includes(f.field_type) &&
    (excludeId == null || Number(f.id) !== Number(excludeId))
  );
  return fields.map(f =>
    `<option value="${f.id}" ${Number(selected) === Number(f.id) ? 'selected' : ''}>${escapeHtml(builderFieldRefLabel(f.id))}</option>`
  ).join('') || '<option value="">- add number fields first -</option>';
}

function openFieldModal(existing = null){
  const isEdit = Boolean(existing);
  const type = existing?.field_type || 'text';
  openModal(isEdit ? 'Edit field' : 'Add field', `
    <label>Label<input name="label" required value="${escapeHtml(existing?.label || '')}"></label>
    <label>Type<select name="field_type">${fieldTypeOptions(type)}</select></label>
    <label class="check-row"><input name="required" type="checkbox" ${existing?.required ? 'checked' : ''}><span>Required</span></label>
    <label class="check-row"><input name="creator_only" type="checkbox" ${existing?.creator_only ? 'checked' : ''}><span>Only editable in Task Builder</span></label>
    <p class="muted" style="margin:-4px 0 8px;font-size:12px">Unchecked: assignee can edit this field when working the task.</p>
    <label class="tf-opt-readonly">Readonly value<input name="readonly_value" value="${escapeHtml(existing?.readonly_value || '')}"></label>
    <label class="tf-opt-select">Select options (one per line)<textarea name="options_text" rows="3">${escapeHtml((existing?.options || []).join('\n'))}</textarea></label>
    <label class="tf-opt-calc">Operation<select name="calc_op">${calcOpOptions(existing?.calc_op || 'add')}</select></label>
    <label class="tf-opt-calc">Left field<select name="calc_left">${numericFieldOptions(existing?.calc_left_field_id, existing?.id)}</select></label>
    <label class="tf-opt-calc">Right field<select name="calc_right">${numericFieldOptions(existing?.calc_right_field_id, existing?.id)}</select></label>
  `, async () => {
    const form = $('tf-modal-form');
    const body = {
      label: form.label.value.trim(),
      field_type: form.field_type.value,
      required: form.required.checked,
      creator_only: form.creator_only.checked,
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
  openModal('New template', `
    <p class="muted">A reusable form. Creating it does not assign work - use Task Builder when you are ready.</p>
    <label>Title<input name="title" required></label>
    <label>Description<textarea name="description" rows="2"></textarea></label>
  `, async () => {
    const form = $('tf-modal-form');
    const data = await TeamFormsApi.createForm(gid, {
      title: form.title.value.trim(),
      description: form.description.value.trim(),
    });
    toast('Template created');
    await loadBuilderForms();
    if (data.form?.id) await openBuilderForm(data.form.id);
  });
}

function snapshotFieldTypeLabel(f){
  if (f?.field_type === 'assign_to') return 'Assign To';
  if (f?.field_type === 'reviewer') return 'Reviewer';
  if (f?.field_type === 'status') return 'Status';
  return FIELD_TYPES.find(([k]) => k === f?.field_type)?.[1] || f?.field_type || 'Field';
}

function collectCreateTaskAssigneeId(root){
  const me = Number(getUser()?.id);
  const el = root?.querySelector('input[name="assignee"]:checked');
  const id = Number(el?.value || 0);
  if (!id || id === me) return 0;
  return id;
}

function collectCreateTaskReviewerIds(root){
  const me = Number(getUser()?.id);
  const assignee = collectCreateTaskAssigneeId(root);
  const ids = [];
  const seen = new Set();
  for (const el of root.querySelectorAll('input[name="reviewer"]:checked')) {
    const id = Number(el.value);
    if (!id || id === me || id === assignee || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function refreshCreateTaskReviewerOptions(root, people, reviewerRolePeople){
  const list = root?.querySelector('#task-builder-reviewer-list') || root?.querySelector('[data-reviewer-list]');
  if (!list) return;
  const me = Number(getUser()?.id);
  const assignee = collectCreateTaskAssigneeId(root);
  const prev = new Set(
    [...list.querySelectorAll('input[name="reviewer"]:checked')].map(el => Number(el.value))
  );
  let pool = reviewerRolePeople.filter(p => Number(p.user_id) !== me && Number(p.user_id) !== assignee);
  if (!pool.length) {
    pool = people.filter(p => Number(p.user_id) !== me && Number(p.user_id) !== assignee);
  }
  if (!pool.length) {
    list.innerHTML = '<span class="muted">No eligible reviewers. Choose a different assignee or add reviewers to the group.</span>';
    return;
  }
  list.innerHTML = pool.map(m => `<label class="tf-check-row">
      <input type="checkbox" name="reviewer" value="${m.user_id}">
      <span>${escapeHtml(m.display_name)}</span></label>`).join('');
  const boxes = [...list.querySelectorAll('input[name="reviewer"]')];
  boxes.forEach(cb => {
    if (prev.has(Number(cb.value))) cb.checked = true;
  });
  if (!boxes.some(cb => cb.checked) && boxes.length === 1) boxes[0].checked = true;
}

function fillCreateTaskAssignUi(root, form, listEl){
  if (!root || !listEl || !form?.group_id) return;
  listEl.innerHTML = '<span class="muted">Loading members…</span>';
  TeamFormsApi.listMembers(form.group_id).then(membersData => {
    const members = membersData.members || [];
    const me = Number(getUser()?.id);
    const assignable = uniqueGroupPeople(members, {excludeUserId: me});
    const reviewerRole = uniqueGroupPeople(members, {role: 'reviewer', excludeUserId: me});
    const allForReviewer = uniqueGroupPeople(members, {excludeUserId: me});
    if (!assignable.length) {
      listEl.innerHTML = '<span class="muted">No other group members to assign.</span>';
      refreshCreateTaskReviewerOptions(root, allForReviewer, reviewerRole);
      return;
    }
    listEl.innerHTML = assignable.map(m => `<label class="tf-check-row">
      <input type="radio" name="assignee" value="${m.user_id}" required>
      <span>${escapeHtml(m.display_name)}</span></label>`).join('');
    listEl.querySelectorAll('input[name="assignee"]').forEach(cb => {
      cb.addEventListener('change', () => refreshCreateTaskReviewerOptions(root, allForReviewer, reviewerRole));
    });
    refreshCreateTaskReviewerOptions(root, allForReviewer, reviewerRole);
  }).catch(err => {
    listEl.textContent = err.message || 'Could not load members';
  });
}

function createTaskFieldsHtml(listId = 'assign-user-list'){
  return `
    <p class="muted">Choose who does the work and who reviews it. Required before the assignment can be saved.</p>
    <div>
      <strong>Assign To</strong>
      <p class="muted" style="margin:4px 0 8px">One person, not you. Required.</p>
      <div id="${listId}"><span class="muted">Loading members…</span></div>
    </div>
    <div>
      <strong>Reviewers</strong>
      <p class="muted" style="margin:4px 0 8px">One or more people. Not you, and not the assignee.</p>
      <div id="task-builder-reviewer-list" data-reviewer-list><span class="muted">Select Assign To first…</span></div>
    </div>
  `;
}

function openCreateTaskModal(form = builderForm){
  if (!form?.id) return;
  openTaskBuilderWithForm(form);
}

function openTaskBuilderWithForm(form){
  if (!form?.id) return;
  taskBuilderGroupId = form.group_id || taskBuilderGroupId;
  taskBuilderPrefetchFormId = form.id;
  if (!taskBuilderTask || Number(taskBuilderTask.form_id) !== Number(form.id)) {
    setTaskBuilderStep('pick');
  }
  showView('task-builder');
}

function setTaskBuilderStep(step){
  taskBuilderStep = step;
  const layout = $('task-builder-layout');
  layout?.classList.toggle('is-wizard-focus', step === 'fill' || step === 'assign');
  $('task-builder-steps')?.querySelectorAll('[data-step]').forEach(el => {
    const name = el.dataset.step;
    el.classList.toggle('is-current', name === step);
    el.classList.toggle('is-done',
      (name === 'pick' && step !== 'pick')
      || (name === 'fill' && step === 'assign'));
  });
}

function resetTaskBuilderWizard(){
  taskBuilderTask = null;
  taskBuilderStep = 'pick';
  setTaskBuilderStep('pick');
  const fields = $('task-builder-fields');
  if (fields) fields.replaceChildren();
  const create = $('task-builder-create');
  if (create) create.replaceChildren();
}

function taskBuilderRequiredMissing(task){
  const values = taskAnswerMap(task);
  const missing = [];
  for (const f of task.fields || []) {
    if (!f.required || isSystemField(f) || f.field_type === 'readonly' || f.field_type === 'calculated') continue;
    const val = values[f.id];
    if (val == null || String(val).trim() === '') missing.push(f.label);
  }
  return missing;
}

async function refreshTaskBuilder(){
  if (taskBuilderStep === 'pick') setTaskBuilderStep('pick');
  try {
    if (!workspaceData) workspaceData = await TeamFormsApi.workspace();
    const groups = workspaceData.creator_groups || [];
    const sel = $('task-builder-group');
    const prev = taskBuilderGroupId || sel.value;
    sel.replaceChildren();
    if (!groups.length) {
      sel.innerHTML = '<option value="">No groups available</option>';
      $('task-builder-forms').innerHTML = '<div class="empty-card">You need Form Creator role on a group (or Org manage permission).</div>';
      $('task-builder-editor').classList.add('hidden');
      taskBuilderForm = null;
      resetTaskBuilderWizard();
      return;
    }
    for (const g of groups) {
      const opt = document.createElement('option');
      opt.value = g.group_id;
      opt.textContent = `${g.department_name} · ${g.group_name}`;
      sel.append(opt);
    }
    if (prev && [...sel.options].some(o => o.value === String(prev))) sel.value = String(prev);
    taskBuilderGroupId = Number(sel.value);
    await loadTaskBuilderForms();
  } catch (err) {
    toast(err.message || 'Task Builder load failed');
  }
}

async function loadTaskBuilderForms(){
  const gid = Number($('task-builder-group').value);
  taskBuilderGroupId = gid;
  if (!gid) return;
  try {
    const data = await TeamFormsApi.listForms(gid);
    const forms = (data.forms || []).filter(f => f.is_active !== false);
    const mount = $('task-builder-forms');
    if (!forms.length) {
      mount.innerHTML = '<div class="empty-card">No active templates in this group. Create one in Form Builder.</div>';
      taskBuilderForm = null;
      $('task-builder-editor').classList.add('hidden');
      return;
    }
    const table = document.createElement('table');
    table.className = 'admin-table tf-forms-table';
    table.innerHTML = '<thead><tr><th>Template</th><th></th></tr></thead>';
    const tbody = document.createElement('tbody');
    const selectedId = taskBuilderPrefetchFormId || taskBuilderForm?.id;
    for (const f of forms) {
      const tr = document.createElement('tr');
      tr.dataset.formId = String(f.id);
      const isSelected = Number(f.id) === Number(selectedId);
      if (isSelected) tr.classList.add('is-selected');
      tr.innerHTML = `<td>${escapeHtml(f.title)}</td><td></td>`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = isSelected ? 'primary-button' : 'secondary-button';
      btn.textContent = isSelected ? 'Selected' : 'Select';
      btn.onclick = () => openTaskBuilderForm(f.id);
      tr.lastElementChild.append(btn);
      tbody.append(tr);
    }
    table.append(tbody);
    mount.replaceChildren(table);
    if (selectedId && forms.some(f => Number(f.id) === Number(selectedId))) {
      await openTaskBuilderForm(selectedId);
    } else {
      taskBuilderForm = null;
      $('task-builder-editor').classList.add('hidden');
      if (taskBuilderStep === 'pick') setTaskBuilderStep('pick');
    }
  } catch (err) {
    $('task-builder-forms').innerHTML = `<div class="empty-card">${escapeHtml(err.message || '')}</div>`;
  }
}

async function openTaskBuilderForm(formId){
  try {
    const data = await TeamFormsApi.getForm(formId);
    taskBuilderForm = data.form;
    taskBuilderPrefetchFormId = taskBuilderForm.id;
    taskBuilderGroupId = taskBuilderForm.group_id;
    $('task-builder-editor').classList.remove('hidden');
    $('task-builder-form-title').textContent = taskBuilderForm.title;
    $('task-builder-form-meta').textContent =
      `${taskBuilderForm.department_name} · ${taskBuilderForm.group_name}` +
      (taskBuilderForm.description ? ` - ${taskBuilderForm.description}` : '');
    markTaskBuilderFormSelected(taskBuilderForm.id);
    const sameDraft = taskBuilderTask
      && Number(taskBuilderTask.form_id) === Number(taskBuilderForm.id)
      && !taskBuilderTask.assignee_id;
    if (sameDraft && (taskBuilderStep === 'fill' || taskBuilderStep === 'assign')) {
      if (taskBuilderStep === 'assign') renderTaskBuilderAssign(taskBuilderForm, taskBuilderTask);
      else renderTaskBuilderFill(taskBuilderTask);
      return;
    }
    setTaskBuilderStep('pick');
    renderTaskBuilderPick(taskBuilderForm);
  } catch (err) {
    toast(err.message || 'Could not load template');
  }
}

function markTaskBuilderFormSelected(formId){
  const mount = $('task-builder-forms');
  if (!mount) return;
  mount.querySelectorAll('tbody tr').forEach(tr => {
    const isSelected = Number(tr.dataset.formId) === Number(formId);
    tr.classList.toggle('is-selected', isSelected);
    const btn = tr.querySelector('button');
    if (!btn) return;
    btn.className = isSelected ? 'primary-button' : 'secondary-button';
    btn.textContent = isSelected ? 'Selected' : 'Select';
  });
}

function renderTaskBuilderPick(form){
  const fields = $('task-builder-fields');
  const mount = $('task-builder-create');
  if (fields) {
    const custom = (form?.fields || []).filter(f => !isSystemField(f));
    fields.innerHTML = custom.length
      ? `<p class="muted">Create the task first. You will fill ${custom.length} field${custom.length === 1 ? '' : 's'} next, then assign.</p>`
      : '<p class="muted">Create the task first, then assign. This template has no custom fields yet.</p>';
  }
  if (!form?.id) {
    mount.replaceChildren();
    return;
  }
  if (form.is_active === false) {
    mount.innerHTML = '<div class="empty-card">This template is inactive.</div>';
    return;
  }
  mount.innerHTML = `<div class="inline-actions">
      <button type="button" id="task-builder-submit" class="primary-button">Create Task</button>
      <span id="task-builder-message" class="form-message"></span>
    </div>`;
  $('task-builder-submit')?.addEventListener('click', () => createTaskBuilderDraft(form));
}

async function createTaskBuilderDraft(form){
  const msg = $('task-builder-message');
  if (form.is_active === false) {
    toast('This template is inactive');
    return;
  }
  const resume = taskBuilderTask
    && Number(taskBuilderTask.form_id) === Number(form.id)
    && !taskBuilderTask.assignee_id;
  if (resume) {
    currentTask = taskBuilderTask;
    renderTaskBuilderFill(taskBuilderTask);
    return;
  }
  if (msg) msg.textContent = 'Creating…';
  try {
    const res = await TeamFormsApi.createTasks(form.id, {draft: true, status: 'pending'});
    let task = res.task;
    if (!task && res.task_ids?.[0]) {
      task = (await TeamFormsApi.getTask(res.task_ids[0])).task;
    }
    if (!task) throw new Error('Task was not created');
    taskBuilderTask = task;
    currentTask = task;
    if (msg) msg.textContent = '';
    renderTaskBuilderFill(task);
  } catch (err) {
    if (msg) msg.textContent = err.message || 'Create failed';
  }
}

function renderTaskBuilderFill(task){
  setTaskBuilderStep('fill');
  currentTask = task;
  taskBuilderTask = task;
  const fields = $('task-builder-fields');
  const mount = $('task-builder-create');
  fields.replaceChildren();
  const intro = document.createElement('p');
  intro.className = 'muted';
  intro.textContent = 'Fill the fields. Changes save as you type. Status stays Pending until the assignee updates it later.';
  fields.append(intro);
  appendTaskFields(fields, task, {systemMode: 'none', columns: 2});
  mount.innerHTML = `<div class="inline-actions">
      <button type="button" id="task-builder-back-pick" class="text-button">← Templates</button>
      <button type="button" id="task-builder-to-assign" class="primary-button">Continue to assign</button>
      ${canDeleteTask(task) ? '<button type="button" id="task-builder-delete" class="text-button">Delete</button>' : ''}
      <span id="task-builder-save-hint" class="muted tf-save-hint" aria-live="polite"></span>
      <span id="task-builder-message" class="form-message"></span>
    </div>`;
  $('task-builder-delete')?.addEventListener('click', () => deleteTaskFromBuilder(task));
  $('task-builder-back-pick')?.addEventListener('click', async () => {
    try { await flushTaskAutosave(); } catch { /* keep navigating */ }
    setTaskBuilderStep('pick');
    if (taskBuilderForm) renderTaskBuilderPick(taskBuilderForm);
  });
  $('task-builder-to-assign')?.addEventListener('click', async () => {
    const msg = $('task-builder-message');
    try {
      await flushTaskAutosave();
    } catch (err) {
      if (msg) msg.textContent = err.message || 'Save failed';
      return;
    }
    const latest = currentTask || taskBuilderTask;
    const missing = taskBuilderRequiredMissing(latest);
    if (missing.length) {
      if (msg) msg.textContent = `Fill required fields first: ${missing.join(', ')}`;
      return;
    }
    renderTaskBuilderAssign(taskBuilderForm, latest);
  });
}

function renderTaskBuilderAssign(form, task){
  setTaskBuilderStep('assign');
  currentTask = task;
  taskBuilderTask = task;
  const fields = $('task-builder-fields');
  fields.innerHTML = '<p class="muted">Fields are saved. Assign the task to finish.</p>';
  const mount = $('task-builder-create');
  mount.innerHTML = `${createTaskFieldsHtml('task-builder-assign-list')}
    <div class="inline-actions">
      <button type="button" id="task-builder-back-fill" class="text-button">← Fill fields</button>
      <button type="button" id="task-builder-submit" class="primary-button">Save assignment</button>
      ${canDeleteTask(task) ? '<button type="button" id="task-builder-delete" class="text-button">Delete</button>' : ''}
      <span id="task-builder-message" class="form-message"></span>
    </div>`;
  fillCreateTaskAssignUi(mount, form, $('task-builder-assign-list'));
  $('task-builder-delete')?.addEventListener('click', () => deleteTaskFromBuilder(task));
  $('task-builder-back-fill')?.addEventListener('click', () => renderTaskBuilderFill(taskBuilderTask || task));
  $('task-builder-submit')?.addEventListener('click', async () => {
    const msg = $('task-builder-message');
    if (msg) msg.textContent = 'Assigning…';
    try {
      const assigneeId = collectCreateTaskAssigneeId(mount);
      if (!assigneeId) throw new Error('Select someone in Assign To');
      const reviewerIds = collectCreateTaskReviewerIds(mount);
      if (!reviewerIds.length) throw new Error('Select at least one reviewer');
      if (reviewerIds.includes(assigneeId)) throw new Error('Reviewer cannot be the same as Assign To');
      const res = await TeamFormsApi.assignTask(task.id, {
        assignee_ids: [assigneeId],
        reviewer_ids: reviewerIds,
      });
      const n = Number(res.count ?? 1);
      toast(n ? `Assigned ${n} task(s)` : 'Assignment saved');
      if (msg) msg.textContent = '';
      resetTaskBuilderWizard();
      if (taskBuilderForm) {
        $('task-builder-editor').classList.remove('hidden');
        renderTaskBuilderPick(taskBuilderForm);
        markTaskBuilderFormSelected(taskBuilderForm.id);
      }
    } catch (err) {
      if (msg) msg.textContent = err.message || 'Assign failed';
    }
  });
}

/* -- Review -- */
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
    <th>Task</th><th>Assignee</th><th>Status</th><th>Progress</th><th>Group</th><th></th>
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
    appendTaskDeleteButton(tr.lastElementChild, t, {onDeleted: () => refreshReview()});
    tbody.append(tr);
  }
  table.append(tbody);
  mount.replaceChildren(table);
}

/* -- Task detail -- */
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

function isTaskFormCreator(task){
  const u = getUser();
  if (!u || !task) return false;
  if (u.is_super) return true;
  if (Number(task.assigned_by) > 0 && Number(u.id) === Number(task.assigned_by)) return true;
  if (Number(task.form_created_by) > 0 && Number(u.id) === Number(task.form_created_by)) return true;
  return false;
}

function isCreatorOnlyField(f){
  if (isSystemField(f)) return true;
  return Boolean(f?.creator_only);
}

function canEditFieldAnswer(task, f){
  if (!task || !f) return false;
  if (task.status === 'approved' || task.status === 'closed') return false;
  if (f.field_type === 'readonly' || f.field_type === 'calculated') return false;
  if (isSystemField(f)) return false;
  if (isTaskFormCreator(task)) return true;
  if (isTaskAssignee(task)) return !isCreatorOnlyField(f);
  return false;
}

function canEditTaskAnswers(task){
  if (!task) return false;
  if (task.status === 'approved' || task.status === 'closed') return false;
  if (isTaskFormCreator(task)) return true;
  if (!isTaskAssignee(task)) return false;
  return (task.fields || []).some(f => canEditFieldAnswer(task, f));
}

function isTaskAssignee(task){
  const u = getUser();
  return Boolean(u && task && Number(task.assignee_id) > 0 && Number(u.id) === Number(task.assignee_id));
}

function canSetTaskStatus(task){
  const u = getUser();
  if (!u || !task) return false;
  if (!['pending', 'in_progress', 'rework', 'completed'].includes(task.status)) return false;
  if (u.is_super) return true;
  if (isTaskAssignee(task)) return true;
  return isTaskFormCreator(task);
}

function canSubmitTask(task){
  if (!task || task.status !== 'completed' || task.is_draft) return false;
  const u = getUser();
  if (!u) return false;
  if (u.is_super) return true;
  if (isTaskAssignee(task)) return true;
  return isTaskFormCreator(task);
}

function canReviewTask(task){
  const u = getUser();
  if (!u || !task) return false;
  if (isTaskAssignee(task)) return false;
  if (u.is_super || canManageOrg()) return true;
  const ids = Array.isArray(task.reviewer_ids) && task.reviewer_ids.length
    ? task.reviewer_ids
    : (task.reviewer_id ? [task.reviewer_id] : []);
  if (ids.length) return ids.some(id => Number(id) === Number(u.id));
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
  if (!u || !task) return false;
  if (isTaskAssignee(task)) return false;
  if (task.status !== 'approved') return false;
  return u.is_super || canManageOrg() || myRolesInGroup(task.group_id).includes('form_creator');
}

function isTaskDraft(task){
  return Boolean(task && (task.is_draft || !Number(task.assignee_id)));
}

function canDeleteTask(task){
  const u = getUser();
  if (!u || !task) return false;
  if (u.is_super || canManageOrg()) return true;
  return Number(task.assigned_by) > 0 && Number(u.id) === Number(task.assigned_by);
}

function confirmDeleteTask(task){
  const title = task?.form_title || task?.task_title || 'this task';
  const kind = isTaskDraft(task) ? 'draft task' : 'task';
  return confirm(`Delete ${kind} “${title}”? Comments, answers, and files will be removed.`);
}

function appendTaskDeleteButton(parent, task, {onDeleted} = {}){
  if (!parent || !canDeleteTask(task)) return;
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'text-button';
  del.textContent = 'Delete';
  del.onclick = async (e) => {
    e.stopPropagation();
    if (!confirmDeleteTask(task)) return;
    try {
      await TeamFormsApi.deleteTask(task.id);
      toast('Task deleted');
      if (onDeleted) await onDeleted();
    } catch (err) {
      toast(err.message || 'Delete failed');
    }
  };
  parent.append(del);
}

async function deleteTaskFromBuilder(task){
  const target = task || taskBuilderTask;
  if (!canDeleteTask(target)) {
    toast('Only the person who created this task can delete it');
    return;
  }
  if (!confirmDeleteTask(target)) return;
  clearTimeout(taskSaveTimer);
  taskSaveTimer = null;
  try {
    await TeamFormsApi.deleteTask(target.id);
    toast('Task deleted');
    currentTask = null;
    resetTaskBuilderWizard();
    if (taskBuilderForm) {
      $('task-builder-editor')?.classList.remove('hidden');
      renderTaskBuilderPick(taskBuilderForm);
      markTaskBuilderFormSelected(taskBuilderForm.id);
    }
  } catch (err) {
    toast(err.message || 'Delete failed');
  }
}

async function deleteCurrentTask(task){
  if (!canDeleteTask(task)) {
    toast('Only the person who created this task can delete it');
    return;
  }
  if (!confirmDeleteTask(task)) return;
  try {
    await TeamFormsApi.deleteTask(task.id);
    toast('Task deleted');
    currentTask = null;
    const back = taskBackView || 'workspace';
    showView(back);
    if (back === 'workspace') await refreshWorkspace();
    else if (back === 'review') await refreshReview();
  } catch (err) {
    toast(err.message || 'Delete failed');
  }
}

function renderTask(){
  const task = currentTask;
  if (!task) return;
  $('task-title').textContent = task.form_title;
  $('task-meta').textContent = taskMetaLine(task);

  const prog = task.progress || {percent: 0, filled: 0, total: 0};
  const progEl = $('task-progress');
  progEl.classList.remove('hidden');
  progEl.innerHTML = `Progress ${prog.filled}/${prog.total} (${prog.percent}%)
    <div class="tf-progress-bar"><span style="width:${prog.percent}%"></span></div>`;

  const actions = $('task-actions');
  actions.replaceChildren();
  const editable = canEditTaskAnswers(task);
  const hasStatusField = (task.fields || []).some(f => f.field_type === 'status' || isSystemField(f) && f.field_type === 'status');
  const statusWrap = document.createElement('div');
  statusWrap.className = 'tf-status-control';
  if (!hasStatusField) {
    if (canSetTaskStatus(task)) {
      const statusLab = document.createElement('label');
      statusLab.className = 'tf-inline-label';
      statusLab.textContent = 'Status';
      const statusSel = document.createElement('select');
      statusSel.id = 'task-status-select';
      statusSel.setAttribute('aria-label', 'Task status');
      fillStatusSelect(statusSel, task.status, {includeRework: true});
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
  }
  if (editable) {
    const hint = document.createElement('span');
    hint.id = 'task-save-hint';
    hint.className = 'muted tf-save-hint';
    hint.setAttribute('aria-live', 'polite');
    statusWrap.append(hint);
  }
  if (statusWrap.childNodes.length) actions.append(statusWrap);
  if (canSubmitTask(task)) {
    const submit = document.createElement('button');
    submit.type = 'button';
    submit.className = 'primary-button';
    submit.textContent = 'Submit task';
    submit.onclick = () => openSubmitTaskModal(task);
    actions.append(submit);
  }
  if (canReviewTask(task) && task.status !== 'closed' && task.status !== 'completed') {
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
  if (canDeleteTask(task)) {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'text-button';
    del.textContent = 'Delete';
    del.onclick = () => deleteCurrentTask(task);
    actions.append(del);
  }

  const formMount = $('task-form');
  formMount.replaceChildren();
  if (task.form_description) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = task.form_description;
    formMount.append(p);
  }
  const u = getUser();
  if (isTaskAssignee(task) && !isTaskFormCreator(task)) {
    const note = document.createElement('p');
    note.className = 'muted';
    const editableCount = (task.fields || []).filter(f => canEditFieldAnswer(task, f)).length;
    note.textContent = editableCount
      ? 'You can edit assignee fields, update status, and add comments. Fields marked Task Builder only are read-only.'
      : 'Fields are read-only for you. You can update status and add comments.';
    formMount.append(note);
  }
  appendTaskFields(formMount, task, {systemMode: 'all'});
  applyTaskFieldSearch({scroll: false});

  renderCommentsPanel($('task-comments-panel'), task);
  renderTaskHistory($('task-history-panel'), task);
}

function appendTaskFields(formMount, task, {systemMode = 'all', columns = 1} = {}){
  const values = taskAnswerMap(task);
  let target = formMount;
  if (columns === 2) {
    target = document.createElement('div');
    target.className = 'tf-fields-grid';
    formMount.append(target);
  }
  for (const f of task.fields || []) {
    if (systemMode === 'none' && isSystemField(f)) continue;
    if (systemMode === 'status' && isSystemField(f) && f.field_type !== 'status') continue;
    const val = values[f.id] ?? '';
    const locked = !canEditFieldAnswer(task, f);
    const wrap = document.createElement(
      f.field_type === 'document'
      || f.field_type === 'assign_to'
      || f.field_type === 'reviewer'
      || f.field_type === 'status'
      || (f.field_type === 'url' && locked) ? 'div' : 'label'
    );
    wrap.className = `tf-form-field ${f.field_type}`;
    wrap.dataset.fieldId = f.id;
    const title = document.createElement('span');
    title.textContent = f.label + (f.required && !isSystemField(f) ? ' *' : '');
    wrap.append(title);
    let input;
    if (f.field_type === 'assign_to') {
      const who = document.createElement('span');
      who.className = 'muted';
      who.style.fontWeight = '400';
      who.textContent = task.assignee_name || '-';
      wrap.append(who);
      target.append(wrap);
      continue;
    } else if (f.field_type === 'reviewer') {
      const who = document.createElement('span');
      who.className = 'muted';
      who.style.fontWeight = '400';
      who.textContent = reviewerNames(task) || '-';
      wrap.append(who);
      target.append(wrap);
      continue;
    } else if (f.field_type === 'status') {
      if (canSetTaskStatus(task)) {
        input = document.createElement('select');
        input.id = 'task-status-select';
        input.setAttribute('aria-label', f.label || 'Task status');
        fillStatusSelect(input, task.status, {includeRework: true});
        input.addEventListener('change', () => onTaskStatusChange(input));
        wrap.append(input);
      } else {
        const badge = document.createElement('span');
        badge.className = 'tf-status';
        badge.id = 'task-status-badge';
        badge.textContent = statusLabel(task.status);
        wrap.append(badge);
      }
      target.append(wrap);
      continue;
    } else if (f.field_type === 'textarea') {
      input = document.createElement('textarea');
      input.rows = 3;
      input.value = val;
    } else if (f.field_type === 'select') {
      input = document.createElement('select');
      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = '-';
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
      input.type = 'number';
      input.inputMode = 'decimal';
      input.step = 'any';
      input.autocomplete = 'off';
      input.value = val;
    } else if (f.field_type === 'date') {
      input = document.createElement('input');
      input.type = 'date';
      input.value = val;
    } else if (f.field_type === 'url') {
      const href = String(val || '').trim();
      if (locked) {
        if (href && isValidUrlValue(href)) wrap.append(renderUrlLink(href));
        else {
          const empty = document.createElement('span');
          empty.className = 'muted';
          empty.style.fontWeight = '400';
          empty.textContent = href || '-';
          wrap.append(empty);
        }
        target.append(wrap);
        continue;
      }
      input = document.createElement('input');
      input.type = 'url';
      input.inputMode = 'url';
      input.placeholder = 'https://';
      input.autocomplete = 'off';
      input.value = href;
    } else if (f.field_type === 'document') {
      const meta = parseDocumentAnswer(val);
      const row = document.createElement('div');
      row.className = 'tf-file-row';
      if (!locked) {
        input = document.createElement('input');
        input.type = 'file';
        input.accept = TF_DOC_ACCEPT;
        input.dataset.fieldId = f.id;
        input.addEventListener('change', () => uploadTaskDocument(f, input, row));
        row.append(input);
      }
      const info = document.createElement('span');
      info.className = 'tf-file-name muted';
      if (meta?.name && currentTask) {
        const a = document.createElement('a');
        a.href = TeamFormsApi.taskFileUrl(task.id, f.id);
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = meta.name;
        info.append(a);
      } else {
        info.textContent = locked ? 'No file' : 'No file selected';
      }
      row.append(info);
      wrap.append(row);
      target.append(wrap);
      continue;
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.value = val;
    }
    input.dataset.fieldId = f.id;
    input.disabled = locked;
    if (f.field_type === 'calculated') input.readOnly = true;
    if (!locked) {
      if (f.field_type === 'number') bindNumberOnly(input);
      const liveCalc = f.field_type === 'number' || f.field_type === 'text' || f.field_type === 'textarea';
      input.addEventListener('input', () => {
        if (liveCalc) refreshCalculatedDom();
        scheduleTaskAutosave();
      });
      input.addEventListener('change', () => scheduleTaskAutosave());
    }
    wrap.append(input);
    target.append(wrap);
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
    const label = el.textContent || '';
    const input = el.querySelector('input, textarea, select');
    let val = '';
    if (input && input.type !== 'file') {
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
    if (!canEditFieldAnswer(currentTask, f) || f.field_type === 'document') continue;
    const input = taskFieldControl(f.id);
    if (!input) continue;
    let value;
    if (input.type === 'checkbox') value = input.checked ? '1' : '0';
    else value = input.value;
    if (f.field_type === 'number') {
      const t = String(value ?? '').trim();
      if (t !== '' && !isNumericFieldValue(t)) value = '';
    }
    if (f.field_type === 'url') {
      const t = String(value ?? '').trim();
      if (t !== '' && !isValidUrlValue(t)) continue;
      value = t;
    }
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
    const input = taskFieldControl(f.id);
    if (!input) continue;
    if (input.type === 'checkbox') map[f.id] = input.checked ? '1' : '0';
    else map[f.id] = input.value;
  }
  const next = applyCalculatedClient(currentTask.fields, map);
  for (const f of currentTask.fields || []) {
    if (f.field_type !== 'calculated') continue;
    const input = taskFieldControl(f.id);
    if (input) input.value = next[f.id] ?? '';
  }
}

function setTaskSaveHint(text, isError = false){
  const el = $('task-save-hint') || $('task-builder-save-hint');
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

function taskMetaLine(task){
  let line = `${task.department_name} · ${task.group_name} · Assignee: ${task.assignee_name} · ${statusLabel(task.status)}`;
  if (task.template_title && task.template_title !== task.form_title) {
    line += ` · Template: ${task.template_title}`;
  }
  if (task.due_on) line += ` · Due ${task.due_on}`;
  return line;
}

function applyTaskMeta(task){
  const meta = $('task-meta');
  if (meta) meta.textContent = taskMetaLine(task);
  if (currentView === 'task-builder' && taskBuilderForm && $('task-builder-form-meta')) {
    $('task-builder-form-meta').textContent =
      `${taskBuilderForm.department_name} · ${taskBuilderForm.group_name}` +
      (taskBuilderForm.description ? ` - ${taskBuilderForm.description}` : '');
  }
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
    if (currentView === 'task-builder') taskBuilderTask = currentTask;
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
  if (next === 'completed') {
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
    const extra = canEditTaskAnswers(currentTask) ? {answers: collectAnswersFromDom()} : {};
    const data = await TeamFormsApi.setStatus(currentTask.id, next, extra);
    currentTask = data.task;
    if (currentView === 'task-builder') {
      taskBuilderTask = currentTask;
      if (taskBuilderStep === 'fill') renderTaskBuilderFill(currentTask);
    } else {
      renderTask();
    }
    toast(next === 'completed' ? 'Marked completed' : 'Status updated');
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
  const taskBuilderBtn = document.querySelector('.nav-item[data-view="task-builder"]');
  const reviewBtn = document.querySelector('.nav-item[data-view="review"]');
  if (builderBtn) builderBtn.classList.toggle('hidden', !isFormCreatorAnywhere());
  if (taskBuilderBtn) taskBuilderBtn.classList.toggle('hidden', !isFormCreatorAnywhere());
  if (reviewBtn) reviewBtn.classList.toggle('hidden', !isReviewerAnywhere());
}

/* -- Shell wiring -- */
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
bindBuilderFieldReorder($('builder-fields'));
$('builder-delete-form')?.addEventListener('click', () => deleteBuilderForm(builderForm));
$('builder-group')?.addEventListener('change', () => loadBuilderForms());
$('task-builder-refresh')?.addEventListener('click', () => refreshTaskBuilder());
$('task-builder-group')?.addEventListener('change', () => {
  taskBuilderForm = null;
  taskBuilderPrefetchFormId = null;
  resetTaskBuilderWizard();
  $('task-builder-editor')?.classList.add('hidden');
  loadTaskBuilderForms();
});
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
  const start = ['workspace', 'org', 'builder', 'task-builder', 'review'].includes(hash) ? hash : 'workspace';
  try {
    if (start !== 'workspace') await refreshWorkspace();
  } catch { /* showView will retry */ }
  showView(start);

  window.addEventListener('hashchange', () => {
    const h = location.hash.slice(1);
    if (['workspace', 'org', 'builder', 'task-builder', 'review'].includes(h) && h !== currentView) showView(h, {hash: false});
  });
}

boot();

<?php

declare(strict_types=1);

require_once __DIR__ . '/../lib/team-forms.php';

function ll_route_team_forms(string $action, ?int $id, array $parts): void
{
  ll_team_forms_ensure_tables();
  $user = ll_require_user();
  ll_tf_require_module($user);

  $sub = $parts[3] ?? '';
  $subId = isset($parts[4]) && ctype_digit((string) $parts[4]) ? (int) $parts[4] : null;
  $subVerb = $parts[5] ?? '';

  switch ($action) {
    case 'departments':
      ll_tf_route_departments($user, $id, $sub);
      break;
    case 'groups':
      ll_tf_route_groups($user, $id, $sub, $subId);
      break;
    case 'forms':
      ll_tf_route_forms($user, $id, $sub, $subId, $subVerb);
      break;
    case 'tasks':
      ll_tf_route_tasks($user, $id, $sub);
      break;
    case 'review':
      ll_tf_route_review($user, $id, $sub);
      break;
    case 'users':
      ll_tf_route_users($user);
      break;
    case 'workspace':
      ll_tf_route_workspace($user);
      break;
    default:
      ll_error('Not found', 404);
  }
}

function ll_tf_route_users(array $user): void
{
  if (!ll_tf_can_manage_org($user) && !ll_user_has_permission($user, 'team_forms.use') && empty($user['is_super'])) {
    ll_error('Forbidden', 403);
  }
  ll_require_method('GET');
  $rows = ll_pdo()->query(
    "SELECT id, username, display_name, is_active
     FROM users
     WHERE is_active = 1
     ORDER BY display_name ASC, username ASC"
  )->fetchAll();
  ll_ok(['users' => array_map(static function ($r) {
    return [
      'id' => (int) $r['id'],
      'username' => (string) $r['username'],
      'display_name' => (string) ($r['display_name'] ?: $r['username']),
    ];
  }, $rows)]);
}

function ll_tf_route_workspace(array $user): void
{
  ll_require_method('GET');
  $uid = (int) $user['id'];
  $memberships = ll_tf_org_memberships($uid);

  $stmt = ll_pdo()->prepare(
    "SELECT t.id, t.form_id, t.status, t.reviewer_scope, t.updated_at, t.submitted_at,
            t.title AS task_title, t.due_on,
            f.title AS form_title, g.id AS group_id, g.name AS group_name,
            d.id AS department_id, d.name AS department_name
     FROM form_tasks t
     INNER JOIN form_templates f ON f.id = t.form_id
     INNER JOIN org_groups g ON g.id = f.group_id
     INNER JOIN departments d ON d.id = g.department_id
     WHERE t.assignee_id = ? AND t.status <> 'closed'
     ORDER BY FIELD(t.status, 'rework', 'in_progress', 'pending', 'completed', 'submitted', 'approved'), t.updated_at DESC"
  );
  $stmt->execute([$uid]);
  $assigned = [];
  foreach ($stmt->fetchAll() as $row) {
    $assigned[] = [
      'id' => (int) $row['id'],
      'form_id' => (int) $row['form_id'],
      'form_title' => ll_tf_task_display_title($row['task_title'] ?? null, $row['form_title'] ?? null),
      'template_title' => (string) $row['form_title'],
      'due_on' => $row['due_on'] ?? null,
      'status' => (string) $row['status'],
      'reviewer_scope' => (string) $row['reviewer_scope'],
      'group_id' => (int) $row['group_id'],
      'group_name' => (string) $row['group_name'],
      'department_id' => (int) $row['department_id'],
      'department_name' => (string) $row['department_name'],
      'updated_at' => $row['updated_at'],
      'submitted_at' => $row['submitted_at'],
    ];
  }

  $creatorGroups = [];
  foreach ($memberships as $m) {
    if (in_array('form_creator', $m['roles'], true) || !empty($user['is_super']) || ll_tf_can_manage_org($user)) {
      $creatorGroups[] = $m;
    }
  }
  if (!empty($user['is_super']) || ll_tf_can_manage_org($user)) {
    // Super/org managers see all groups as potential creator scope.
    $allGroups = ll_pdo()->query(
      'SELECT g.id AS group_id, g.name AS group_name, d.id AS department_id, d.name AS department_name
       FROM org_groups g INNER JOIN departments d ON d.id = g.department_id
       ORDER BY d.name, g.name'
    )->fetchAll();
    $creatorGroups = array_map(static function ($r) {
      return [
        'department_id' => (int) $r['department_id'],
        'department_name' => (string) $r['department_name'],
        'group_id' => (int) $r['group_id'],
        'group_name' => (string) $r['group_name'],
        'roles' => ['form_creator'],
      ];
    }, $allGroups);
  }

  ll_ok([
    'memberships' => $memberships,
    'assigned_tasks' => $assigned,
    'creator_groups' => $creatorGroups,
  ]);
}

function ll_tf_route_departments(array $user, ?int $id, string $sub): void
{
  $method = ll_method();
  $pdo = ll_pdo();

  if ($method === 'GET' && $id === null) {
    $rows = $pdo->query(
      'SELECT id, name, description, created_by, created_at, updated_at
       FROM departments ORDER BY name ASC'
    )->fetchAll();
    ll_ok(['departments' => array_map('ll_tf_row_department', $rows)]);
  }

  if ($method === 'GET' && $id !== null) {
    $stmt = $pdo->prepare('SELECT * FROM departments WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if (!$row) {
      ll_error('Department not found', 404);
    }
    ll_ok(['department' => ll_tf_row_department($row)]);
  }

  if ($method === 'POST' && $id === null) {
    if (!ll_tf_can_manage_org($user)) {
      ll_error('Forbidden', 403);
    }
    $body = ll_read_json_body();
    $name = trim((string) ($body['name'] ?? ''));
    $desc = trim((string) ($body['description'] ?? ''));
    if ($name === '') {
      ll_error('name is required');
    }
    try {
      $pdo->prepare(
        'INSERT INTO departments (name, description, created_by) VALUES (?, ?, ?)'
      )->execute([$name, $desc !== '' ? $desc : null, (int) $user['id']]);
    } catch (PDOException $e) {
      ll_error('Could not create department (name may already exist)');
    }
    $newId = (int) $pdo->lastInsertId();
    $stmt = $pdo->prepare('SELECT * FROM departments WHERE id = ?');
    $stmt->execute([$newId]);
    ll_ok(['department' => ll_tf_row_department($stmt->fetch())], 201);
  }

  if ($id !== null && (($method === 'POST' && $sub === 'update') || $method === 'PATCH' || $method === 'PUT')) {
    if (!ll_tf_can_manage_org($user)) {
      ll_error('Forbidden', 403);
    }
    $stmt = $pdo->prepare('SELECT * FROM departments WHERE id = ?');
    $stmt->execute([$id]);
    if (!$stmt->fetch()) {
      ll_error('Department not found', 404);
    }
    $body = ll_read_json_body();
    $name = array_key_exists('name', $body) ? trim((string) $body['name']) : null;
    $desc = array_key_exists('description', $body) ? trim((string) $body['description']) : null;
    if ($name !== null && $name === '') {
      ll_error('name cannot be empty');
    }
    if ($name !== null) {
      $pdo->prepare('UPDATE departments SET name = ? WHERE id = ?')->execute([$name, $id]);
    }
    if ($desc !== null) {
      $pdo->prepare('UPDATE departments SET description = ? WHERE id = ?')
        ->execute([$desc !== '' ? $desc : null, $id]);
    }
    $stmt = $pdo->prepare('SELECT * FROM departments WHERE id = ?');
    $stmt->execute([$id]);
    ll_ok(['department' => ll_tf_row_department($stmt->fetch())]);
  }

  if ($id !== null && (($method === 'POST' && $sub === 'delete') || $method === 'DELETE')) {
    if (!ll_tf_can_manage_org($user)) {
      ll_error('Forbidden', 403);
    }
    $pdo->prepare('DELETE FROM departments WHERE id = ?')->execute([$id]);
    ll_ok(['deleted' => true, 'id' => $id]);
  }

  ll_error('Not found', 404);
}

function ll_tf_route_groups(array $user, ?int $id, string $sub, ?int $subId): void
{
  $method = ll_method();
  $pdo = ll_pdo();

  if ($method === 'GET' && $id === null) {
    $deptId = isset($_GET['department_id']) && ctype_digit((string) $_GET['department_id'])
      ? (int) $_GET['department_id'] : null;
    if ($deptId) {
      $stmt = $pdo->prepare(
        'SELECT g.*, d.name AS department_name
         FROM org_groups g INNER JOIN departments d ON d.id = g.department_id
         WHERE g.department_id = ? ORDER BY g.name ASC'
      );
      $stmt->execute([$deptId]);
    } else {
      $stmt = $pdo->query(
        'SELECT g.*, d.name AS department_name
         FROM org_groups g INNER JOIN departments d ON d.id = g.department_id
         ORDER BY d.name ASC, g.name ASC'
      );
    }
    ll_ok(['groups' => array_map('ll_tf_row_group', $stmt->fetchAll())]);
  }

  if ($method === 'GET' && $id !== null && $sub === '') {
    $stmt = $pdo->prepare(
      'SELECT g.*, d.name AS department_name
       FROM org_groups g INNER JOIN departments d ON d.id = g.department_id
       WHERE g.id = ? LIMIT 1'
    );
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if (!$row) {
      ll_error('Group not found', 404);
    }
    ll_ok(['group' => ll_tf_row_group($row)]);
  }

  if ($method === 'POST' && $id === null) {
    if (!ll_tf_can_manage_org($user)) {
      ll_error('Forbidden', 403);
    }
    $body = ll_read_json_body();
    $deptId = (int) ($body['department_id'] ?? 0);
    $name = trim((string) ($body['name'] ?? ''));
    $desc = trim((string) ($body['description'] ?? ''));
    if ($deptId < 1 || $name === '') {
      ll_error('department_id and name are required');
    }
    $chk = $pdo->prepare('SELECT id FROM departments WHERE id = ?');
    $chk->execute([$deptId]);
    if (!$chk->fetch()) {
      ll_error('Department not found', 404);
    }
    try {
      $pdo->prepare(
        'INSERT INTO org_groups (department_id, name, description, created_by) VALUES (?, ?, ?, ?)'
      )->execute([$deptId, $name, $desc !== '' ? $desc : null, (int) $user['id']]);
    } catch (PDOException $e) {
      ll_error('Could not create group (name may already exist in this department)');
    }
    $newId = (int) $pdo->lastInsertId();
    $stmt = $pdo->prepare(
      'SELECT g.*, d.name AS department_name FROM org_groups g
       INNER JOIN departments d ON d.id = g.department_id WHERE g.id = ?'
    );
    $stmt->execute([$newId]);
    ll_ok(['group' => ll_tf_row_group($stmt->fetch())], 201);
  }

  if ($id !== null && $sub === 'update' && $method === 'POST'
    || $id !== null && $sub === '' && ($method === 'PATCH' || $method === 'PUT')) {
    if (!ll_tf_can_manage_org($user)) {
      ll_error('Forbidden', 403);
    }
    $stmt = $pdo->prepare('SELECT * FROM org_groups WHERE id = ?');
    $stmt->execute([$id]);
    if (!$stmt->fetch()) {
      ll_error('Group not found', 404);
    }
    $body = ll_read_json_body();
    if (array_key_exists('name', $body)) {
      $name = trim((string) $body['name']);
      if ($name === '') {
        ll_error('name cannot be empty');
      }
      $pdo->prepare('UPDATE org_groups SET name = ? WHERE id = ?')->execute([$name, $id]);
    }
    if (array_key_exists('description', $body)) {
      $desc = trim((string) $body['description']);
      $pdo->prepare('UPDATE org_groups SET description = ? WHERE id = ?')
        ->execute([$desc !== '' ? $desc : null, $id]);
    }
    if (array_key_exists('department_id', $body)) {
      $deptId = (int) $body['department_id'];
      $chk = $pdo->prepare('SELECT id FROM departments WHERE id = ?');
      $chk->execute([$deptId]);
      if (!$chk->fetch()) {
        ll_error('Department not found', 404);
      }
      $pdo->prepare('UPDATE org_groups SET department_id = ? WHERE id = ?')->execute([$deptId, $id]);
    }
    $stmt = $pdo->prepare(
      'SELECT g.*, d.name AS department_name FROM org_groups g
       INNER JOIN departments d ON d.id = g.department_id WHERE g.id = ?'
    );
    $stmt->execute([$id]);
    ll_ok(['group' => ll_tf_row_group($stmt->fetch())]);
  }

  if ($id !== null && (($method === 'POST' && $sub === 'delete') || ($method === 'DELETE' && $sub === ''))) {
    if (!ll_tf_can_manage_org($user)) {
      ll_error('Forbidden', 403);
    }
    $pdo->prepare('DELETE FROM org_groups WHERE id = ?')->execute([$id]);
    ll_ok(['deleted' => true, 'id' => $id]);
  }

  // Members
  if ($id !== null && $sub === 'members') {
    ll_tf_route_members($user, $id, $subId, $method);
  }

  // Forms under group
  if ($id !== null && $sub === 'forms') {
    ll_tf_route_group_forms($user, $id, $method);
  }

  ll_error('Not found', 404);
}

function ll_tf_route_members(array $user, int $groupId, ?int $memberId, string $method): void
{
  $pdo = ll_pdo();
  $chk = $pdo->prepare('SELECT id FROM org_groups WHERE id = ?');
  $chk->execute([$groupId]);
  if (!$chk->fetch()) {
    ll_error('Group not found', 404);
  }

  if ($method === 'GET') {
    $stmt = $pdo->prepare(
      'SELECT gm.id, gm.group_id, gm.user_id, gm.role, gm.created_at,
              u.username, u.display_name
       FROM group_members gm
       INNER JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = ?
       ORDER BY u.display_name ASC, gm.role ASC'
    );
    $stmt->execute([$groupId]);
    $members = array_map(static function ($r) {
      return [
        'id' => (int) $r['id'],
        'group_id' => (int) $r['group_id'],
        'user_id' => (int) $r['user_id'],
        'role' => (string) $r['role'],
        'username' => (string) $r['username'],
        'display_name' => (string) ($r['display_name'] ?: $r['username']),
        'created_at' => $r['created_at'],
      ];
    }, $stmt->fetchAll());
    ll_ok(['members' => $members]);
  }

  if ($method === 'POST' && $memberId === null) {
    if (!ll_tf_can_manage_org($user)) {
      ll_error('Forbidden', 403);
    }
    $body = ll_read_json_body();
    // Support remove via POST body action
    if (($body['action'] ?? '') === 'remove' || !empty($body['remove'])) {
      $uid = (int) ($body['user_id'] ?? 0);
      $role = (string) ($body['role'] ?? '');
      $mid = (int) ($body['member_id'] ?? 0);
      if ($mid > 0) {
        $pdo->prepare('DELETE FROM group_members WHERE id = ? AND group_id = ?')->execute([$mid, $groupId]);
      } elseif ($uid > 0 && in_array($role, ll_tf_roles(), true)) {
        $pdo->prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ? AND role = ?')
          ->execute([$groupId, $uid, $role]);
      } else {
        ll_error('member_id or user_id+role required to remove');
      }
      ll_ok(['deleted' => true]);
    }

    $uid = (int) ($body['user_id'] ?? 0);
    $role = (string) ($body['role'] ?? '');
    if ($uid < 1 || !in_array($role, ll_tf_roles(), true)) {
      ll_error('user_id and valid role are required');
    }
    $u = ll_find_user_by_id($uid);
    if (!$u || (int) ($u['is_active'] ?? 0) !== 1) {
      ll_error('User not found or inactive', 404);
    }
    try {
      $pdo->prepare(
        'INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)'
      )->execute([$groupId, $uid, $role]);
    } catch (PDOException $e) {
      ll_error('Member already has this role in the group');
    }
    $newId = (int) $pdo->lastInsertId();
    $stmt = $pdo->prepare(
      'SELECT gm.id, gm.group_id, gm.user_id, gm.role, gm.created_at, u.username, u.display_name
       FROM group_members gm INNER JOIN users u ON u.id = gm.user_id WHERE gm.id = ?'
    );
    $stmt->execute([$newId]);
    $r = $stmt->fetch();
    ll_ok(['member' => [
      'id' => (int) $r['id'],
      'group_id' => (int) $r['group_id'],
      'user_id' => (int) $r['user_id'],
      'role' => (string) $r['role'],
      'username' => (string) $r['username'],
      'display_name' => (string) ($r['display_name'] ?: $r['username']),
      'created_at' => $r['created_at'],
    ]], 201);
  }

  if (($method === 'POST' || $method === 'DELETE') && $memberId !== null) {
    if (!ll_tf_can_manage_org($user)) {
      ll_error('Forbidden', 403);
    }
    $pdo->prepare('DELETE FROM group_members WHERE id = ? AND group_id = ?')->execute([$memberId, $groupId]);
    ll_ok(['deleted' => true, 'id' => $memberId]);
  }

  ll_error('Not found', 404);
}

function ll_tf_assert_form_creator(array $user, int $groupId): void
{
  if (!empty($user['is_super']) || ll_tf_can_manage_org($user)) {
    return;
  }
  if (!ll_tf_user_has_group_role((int) $user['id'], $groupId, 'form_creator')) {
    ll_error('Form creator role required for this group', 403);
  }
}

function ll_tf_assert_can_delete_form(array $user, array $form): void
{
  if (!empty($user['is_super']) || ll_tf_can_manage_org($user)) {
    return;
  }
  $createdBy = (int) ($form['created_by'] ?? 0);
  if ($createdBy > 0 && $createdBy === (int) $user['id']) {
    return;
  }
  ll_error('Only the form creator can delete this form', 403);
}

function ll_tf_delete_form_cascade(int $formId): void
{
  $pdo = ll_pdo();
  $tidStmt = $pdo->prepare('SELECT id FROM form_tasks WHERE form_id = ?');
  $tidStmt->execute([$formId]);
  $taskIds = [];
  foreach ($tidStmt->fetchAll() as $row) {
    $taskIds[] = (int) $row['id'];
  }
  $fidStmt = $pdo->prepare('SELECT id FROM form_fields WHERE form_id = ?');
  $fidStmt->execute([$formId]);
  $fieldIds = [];
  foreach ($fidStmt->fetchAll() as $row) {
    $fieldIds[] = (int) $row['id'];
  }
  if ($taskIds) {
    foreach ($taskIds as $tid) {
      ll_tf_doc_delete_task_dir($tid);
    }
    $ph = implode(',', array_fill(0, count($taskIds), '?'));
    $pdo->prepare("DELETE FROM form_answers WHERE task_id IN ($ph)")->execute($taskIds);
    $pdo->prepare("DELETE FROM form_comments WHERE task_id IN ($ph)")->execute($taskIds);
    try {
      $pdo->prepare("DELETE FROM form_task_events WHERE task_id IN ($ph)")->execute($taskIds);
    } catch (Throwable $e) {
      /* table may not exist yet */
    }
    try {
      $pdo->prepare("DELETE FROM form_task_reviewers WHERE task_id IN ($ph)")->execute($taskIds);
    } catch (Throwable $e) {
      /* table may not exist yet */
    }
    $pdo->prepare("DELETE FROM form_tasks WHERE id IN ($ph)")->execute($taskIds);
  }
  if ($fieldIds) {
    $ph = implode(',', array_fill(0, count($fieldIds), '?'));
    $pdo->prepare("DELETE FROM form_answers WHERE field_id IN ($ph)")->execute($fieldIds);
    $pdo->prepare("DELETE FROM form_fields WHERE id IN ($ph)")->execute($fieldIds);
  }
  $pdo->prepare('DELETE FROM form_templates WHERE id = ?')->execute([$formId]);
}

function ll_tf_route_group_forms(array $user, int $groupId, string $method): void
{
  $pdo = ll_pdo();
  $chk = $pdo->prepare('SELECT id FROM org_groups WHERE id = ?');
  $chk->execute([$groupId]);
  if (!$chk->fetch()) {
    ll_error('Group not found', 404);
  }

  if ($method === 'GET') {
    // Visible if member of group, or manage_org / super, or has any review/create role
    $uid = (int) $user['id'];
    $roles = ll_user_group_roles($uid, $groupId);
    if (
      empty($roles)
      && empty($user['is_super'])
      && !ll_tf_can_manage_org($user)
    ) {
      ll_error('Forbidden', 403);
    }
    $stmt = $pdo->prepare(
      'SELECT f.*, u.display_name AS created_by_name
       FROM form_templates f
       LEFT JOIN users u ON u.id = f.created_by
       WHERE f.group_id = ?
       ORDER BY f.updated_at DESC'
    );
    $stmt->execute([$groupId]);
    $forms = array_map(static function ($r) {
      return [
        'id' => (int) $r['id'],
        'group_id' => (int) $r['group_id'],
        'title' => (string) $r['title'],
        'description' => $r['description'] !== null ? (string) $r['description'] : null,
        'created_by' => $r['created_by'] !== null ? (int) $r['created_by'] : null,
        'created_by_name' => $r['created_by_name'] ?? null,
        'is_active' => (int) $r['is_active'] === 1,
        'created_at' => $r['created_at'],
        'updated_at' => $r['updated_at'],
      ];
    }, $stmt->fetchAll());
    ll_ok(['forms' => $forms]);
  }

  if ($method === 'POST') {
    ll_tf_assert_form_creator($user, $groupId);
    $body = ll_read_json_body();
    $title = trim((string) ($body['title'] ?? ''));
    $desc = trim((string) ($body['description'] ?? ''));
    if ($title === '') {
      ll_error('title is required');
    }
    $pdo->prepare(
      'INSERT INTO form_templates (group_id, title, description, created_by, is_active)
       VALUES (?, ?, ?, ?, 1)'
    )->execute([$groupId, $title, $desc !== '' ? $desc : null, (int) $user['id']]);
    $newId = (int) $pdo->lastInsertId();
    ll_tf_ensure_system_fields($newId);
    ll_ok(['form' => ll_tf_load_form($newId)], 201);
  }

  ll_error('Not found', 404);
}

function ll_tf_load_fields(int $formId): array
{
  $stmt = ll_pdo()->prepare(
    'SELECT * FROM form_fields WHERE form_id = ? ORDER BY sort_order ASC, id ASC'
  );
  $stmt->execute([$formId]);
  return array_map('ll_tf_row_field', $stmt->fetchAll());
}

function ll_tf_load_form(int $formId): ?array
{
  $stmt = ll_pdo()->prepare(
    'SELECT f.*, g.name AS group_name, g.department_id, d.name AS department_name,
            u.display_name AS created_by_name
     FROM form_templates f
     INNER JOIN org_groups g ON g.id = f.group_id
     INNER JOIN departments d ON d.id = g.department_id
     LEFT JOIN users u ON u.id = f.created_by
     WHERE f.id = ? LIMIT 1'
  );
  $stmt->execute([$formId]);
  $r = $stmt->fetch();
  if (!$r) {
    return null;
  }
  ll_tf_ensure_system_fields($formId);
  return [
    'id' => (int) $r['id'],
    'group_id' => (int) $r['group_id'],
    'group_name' => (string) $r['group_name'],
    'department_id' => (int) $r['department_id'],
    'department_name' => (string) $r['department_name'],
    'title' => (string) $r['title'],
    'description' => $r['description'] !== null ? (string) $r['description'] : null,
    'created_by' => $r['created_by'] !== null ? (int) $r['created_by'] : null,
    'created_by_name' => $r['created_by_name'] ?? null,
    'is_active' => (int) $r['is_active'] === 1,
    'created_at' => $r['created_at'],
    'updated_at' => $r['updated_at'],
    'fields' => ll_tf_load_fields($formId),
  ];
}

function ll_tf_assert_can_view_form(array $user, array $form): void
{
  if (!empty($user['is_super']) || ll_tf_can_manage_org($user)) {
    return;
  }
  $roles = ll_user_group_roles((int) $user['id'], (int) $form['group_id']);
  if ($roles) {
    return;
  }
  // Assignees with a task on this form
  $stmt = ll_pdo()->prepare(
    'SELECT id FROM form_tasks WHERE form_id = ? AND assignee_id = ? LIMIT 1'
  );
  $stmt->execute([(int) $form['id'], (int) $user['id']]);
  if ($stmt->fetch()) {
    return;
  }
  ll_error('Forbidden', 403);
}

function ll_tf_route_forms(array $user, ?int $id, string $sub, ?int $subId, string $subVerb): void
{
  $method = ll_method();
  $pdo = ll_pdo();

  if ($id === null) {
    ll_error('Not found', 404);
  }

  $form = ll_tf_load_form($id);
  if (!$form) {
    ll_error('Form not found', 404);
  }

  if ($method === 'GET' && $sub === '') {
    ll_tf_assert_can_view_form($user, $form);
    ll_ok(['form' => $form]);
  }

  if (($method === 'POST' && $sub === 'update') || (($method === 'PATCH' || $method === 'PUT') && $sub === '')) {
    ll_tf_assert_form_creator($user, (int) $form['group_id']);
    $body = ll_read_json_body();
    if (array_key_exists('title', $body)) {
      $title = trim((string) $body['title']);
      if ($title === '') {
        ll_error('title cannot be empty');
      }
      $pdo->prepare('UPDATE form_templates SET title = ? WHERE id = ?')->execute([$title, $id]);
    }
    if (array_key_exists('description', $body)) {
      $desc = trim((string) $body['description']);
      $pdo->prepare('UPDATE form_templates SET description = ? WHERE id = ?')
        ->execute([$desc !== '' ? $desc : null, $id]);
    }
    if (array_key_exists('is_active', $body)) {
      $pdo->prepare('UPDATE form_templates SET is_active = ? WHERE id = ?')
        ->execute([!empty($body['is_active']) ? 1 : 0, $id]);
    }
    ll_ok(['form' => ll_tf_load_form($id)]);
  }

  if (($method === 'POST' && $sub === 'delete') || ($method === 'DELETE' && $sub === '')) {
    ll_tf_assert_can_delete_form($user, $form);
    $pdo->beginTransaction();
    try {
      ll_tf_delete_form_cascade($id);
      $pdo->commit();
    } catch (Throwable $e) {
      $pdo->rollBack();
      throw $e;
    }
    ll_ok(['deleted' => true, 'id' => $id]);
  }

  if ($sub === 'fields') {
    ll_tf_route_fields($user, $form, $subId, $subVerb, $method);
  }

  if ($sub === 'assign' && $method === 'GET') {
    ll_tf_list_open_assignments($user, $form);
  }

  if ($sub === 'assign' && $method === 'POST') {
    ll_tf_assign_tasks($user, $form);
  }

  if ($sub === 'create-tasks' && $method === 'POST') {
    ll_tf_assign_tasks($user, $form);
  }

  ll_error('Not found', 404);
}

function ll_tf_parse_field_body(array $body, ?array $existing = null): array
{
  $label = trim((string) ($body['label'] ?? ($existing['label'] ?? '')));
  if ($label === '') {
    ll_error('label is required');
  }
  $type = (string) ($body['field_type'] ?? ($existing['field_type'] ?? 'text'));
  if (!in_array($type, ll_tf_field_types(), true)) {
    ll_error('Invalid field_type');
  }
  if ($existing === null && in_array($type, ll_tf_system_field_types(), true)) {
    ll_error('System fields cannot be added manually');
  }
  if ($existing !== null && ll_tf_is_system_field($existing)) {
    $type = (string) $existing['field_type'];
  }
  // field_key is optional. Existing fields keep their key; new fields get a
  // unique key allocated at insert time (never regenerate on update/reorder).
  if ($existing !== null && !empty($existing['field_key'])) {
    $key = (string) $existing['field_key'];
  } else {
    $key = trim((string) ($body['field_key'] ?? ''));
    $key = $key !== '' ? ll_tf_slug_key($key) : '';
  }
  $options = $body['options'] ?? ($existing['options'] ?? []);
  if (!is_array($options)) {
    $options = [];
  }
  $required = array_key_exists('required', $body)
    ? !empty($body['required'])
    : !empty($existing['required']);
  $readonly = array_key_exists('readonly_value', $body)
    ? (string) $body['readonly_value']
    : ($existing['readonly_value'] ?? null);
  $calcOp = array_key_exists('calc_op', $body)
    ? ($body['calc_op'] !== null && $body['calc_op'] !== '' ? (string) $body['calc_op'] : null)
    : ($existing['calc_op'] ?? null);
  $calcLeft = array_key_exists('calc_left_field_id', $body)
    ? ($body['calc_left_field_id'] !== null && $body['calc_left_field_id'] !== '' ? (int) $body['calc_left_field_id'] : null)
    : ($existing['calc_left_field_id'] ?? null);
  $calcRight = array_key_exists('calc_right_field_id', $body)
    ? ($body['calc_right_field_id'] !== null && $body['calc_right_field_id'] !== '' ? (int) $body['calc_right_field_id'] : null)
    : ($existing['calc_right_field_id'] ?? null);
  $sort = array_key_exists('sort_order', $body)
    ? (int) $body['sort_order']
    : (int) ($existing['sort_order'] ?? 0);

  if ($type === 'readonly') {
    $required = false;
  }
  if ($type === 'calculated') {
    $required = false;
    if ($calcOp === null || !in_array($calcOp, ll_tf_calc_ops(), true)) {
      ll_error('calculated fields require calc_op (add|subtract|multiply|divide)');
    }
    if (!$calcLeft || !$calcRight) {
      ll_error('calculated fields require calc_left_field_id and calc_right_field_id');
    }
  }
  if ($type === 'select' && empty($options)) {
    // Allow empty; UI can fill later
  }

  return [
    'field_key' => $key,
    'label' => $label,
    'field_type' => $type,
    'options_json' => json_encode(array_values($options), JSON_UNESCAPED_UNICODE),
    'readonly_value' => $type === 'readonly' ? ($readonly !== null ? (string) $readonly : '') : null,
    'calc_op' => $type === 'calculated' ? $calcOp : null,
    'calc_left_field_id' => $type === 'calculated' ? $calcLeft : null,
    'calc_right_field_id' => $type === 'calculated' ? $calcRight : null,
    'required' => $required ? 1 : 0,
    'sort_order' => $sort,
  ];
}

function ll_tf_route_fields(array $user, array $form, ?int $fieldId, string $verb, string $method): void
{
  ll_tf_assert_form_creator($user, (int) $form['group_id']);
  $pdo = ll_pdo();
  $formId = (int) $form['id'];

  if ($method === 'GET' && $fieldId === null) {
    ll_ok(['fields' => ll_tf_load_fields($formId)]);
  }

  if ($method === 'POST' && $fieldId === null && $verb === '') {
    $body = ll_read_json_body();
    if (($body['action'] ?? '') === 'reorder' && is_array($body['order'] ?? null)) {
      $order = array_values(array_map('intval', $body['order']));
      $upd = $pdo->prepare('UPDATE form_fields SET sort_order = ? WHERE id = ? AND form_id = ?');
      foreach ($order as $i => $fid) {
        $upd->execute([$i, $fid, $formId]);
      }
      ll_ok(['fields' => ll_tf_load_fields($formId)]);
    }
    $parsed = ll_tf_parse_field_body($body);
    $parsed['field_key'] = ll_tf_allocate_field_key($pdo, $formId, $parsed['label'], $parsed['field_key']);
    if (!array_key_exists('sort_order', $body)) {
      $stmtMax = $pdo->prepare('SELECT COALESCE(MAX(sort_order), -1) FROM form_fields WHERE form_id = ?');
      $stmtMax->execute([$formId]);
      $parsed['sort_order'] = ((int) $stmtMax->fetchColumn()) + 1;
    }
    $pdo->prepare(
      'INSERT INTO form_fields
       (form_id, field_key, label, field_type, options_json, readonly_value, calc_op, calc_left_field_id, calc_right_field_id, required, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )->execute([
      $formId,
      $parsed['field_key'],
      $parsed['label'],
      $parsed['field_type'],
      $parsed['options_json'],
      $parsed['readonly_value'],
      $parsed['calc_op'],
      $parsed['calc_left_field_id'],
      $parsed['calc_right_field_id'],
      $parsed['required'],
      $parsed['sort_order'],
    ]);
    $newId = (int) $pdo->lastInsertId();
    $stmt = $pdo->prepare('SELECT * FROM form_fields WHERE id = ?');
    $stmt->execute([$newId]);
    ll_ok(['field' => ll_tf_row_field($stmt->fetch())], 201);
  }

  if ($fieldId !== null) {
    $stmt = $pdo->prepare('SELECT * FROM form_fields WHERE id = ? AND form_id = ?');
    $stmt->execute([$fieldId, $formId]);
    $existingRow = $stmt->fetch();
    if (!$existingRow) {
      ll_error('Field not found', 404);
    }
    $existing = ll_tf_row_field($existingRow);

    if (($method === 'POST' && $verb === 'update') || $method === 'PATCH' || $method === 'PUT') {
      if (ll_tf_is_system_field($existing)) {
        $body = ll_read_json_body();
        if (array_key_exists('sort_order', $body)) {
          $pdo->prepare('UPDATE form_fields SET sort_order = ? WHERE id = ? AND form_id = ?')
            ->execute([(int) $body['sort_order'], $fieldId, $formId]);
        }
        $stmt = $pdo->prepare('SELECT * FROM form_fields WHERE id = ?');
        $stmt->execute([$fieldId]);
        ll_ok(['field' => ll_tf_row_field($stmt->fetch())]);
      }
      $parsed = ll_tf_parse_field_body(ll_read_json_body(), $existing);
      $pdo->prepare(
        'UPDATE form_fields SET field_key = ?, label = ?, field_type = ?, options_json = ?,
         readonly_value = ?, calc_op = ?, calc_left_field_id = ?, calc_right_field_id = ?,
         required = ?, sort_order = ? WHERE id = ? AND form_id = ?'
      )->execute([
        $parsed['field_key'],
        $parsed['label'],
        $parsed['field_type'],
        $parsed['options_json'],
        $parsed['readonly_value'],
        $parsed['calc_op'],
        $parsed['calc_left_field_id'],
        $parsed['calc_right_field_id'],
        $parsed['required'],
        $parsed['sort_order'],
        $fieldId,
        $formId,
      ]);
      $stmt = $pdo->prepare('SELECT * FROM form_fields WHERE id = ?');
      $stmt->execute([$fieldId]);
      ll_ok(['field' => ll_tf_row_field($stmt->fetch())]);
    }

    if ($method === 'DELETE' || ($method === 'POST' && $verb === 'delete')) {
      if (ll_tf_is_system_field($existing)) {
        ll_error('System fields cannot be deleted');
      }
      ll_tf_doc_cleanup_field($fieldId);
      $pdo->prepare('DELETE FROM form_fields WHERE id = ? AND form_id = ?')->execute([$fieldId, $formId]);
      ll_ok(['deleted' => true, 'id' => $fieldId]);
    }

    if ($method === 'POST' && $verb === '') {
      $body = ll_read_json_body();
      if (($body['action'] ?? '') === 'delete' || !empty($body['delete'])) {
        if (ll_tf_is_system_field($existing)) {
          ll_error('System fields cannot be deleted');
        }
        ll_tf_doc_cleanup_field($fieldId);
        $pdo->prepare('DELETE FROM form_fields WHERE id = ? AND form_id = ?')->execute([$fieldId, $formId]);
        ll_ok(['deleted' => true, 'id' => $fieldId]);
      }
    }
  }

  ll_error('Not found', 404);
}

function ll_tf_list_open_assignments(array $user, array $form): void
{
  ll_tf_assert_form_creator($user, (int) $form['group_id']);
  $stmt = ll_pdo()->prepare(
    "SELECT t.id AS task_id, t.assignee_id, t.status,
            ua.display_name, ua.username
     FROM form_tasks t
     INNER JOIN users ua ON ua.id = t.assignee_id
     WHERE t.form_id = ? AND t.status <> 'closed'
     ORDER BY ua.display_name ASC, ua.username ASC"
  );
  $stmt->execute([(int) $form['id']]);
  $assignees = [];
  foreach ($stmt->fetchAll() as $r) {
    $assignees[] = [
      'task_id' => (int) $r['task_id'],
      'assignee_id' => (int) $r['assignee_id'],
      'user_id' => (int) $r['assignee_id'],
      'status' => (string) $r['status'],
      'display_name' => (string) ($r['display_name'] ?: $r['username']),
    ];
  }
  ll_ok([
    'assignees' => $assignees,
    'assignee_ids' => array_values(array_map(static fn ($a) => $a['assignee_id'], $assignees)),
  ]);
}

/** @return list<int> */
function ll_tf_normalize_assignee_ids($raw, array $body = []): array
{
  if ((!is_array($raw) || !$raw) && isset($body['assignee_id'])) {
    $raw = [(int) $body['assignee_id']];
  }
  if (!is_array($raw)) {
    $raw = [];
  }
  $out = [];
  $seen = [];
  foreach ($raw as $aid) {
    $aid = (int) $aid;
    if ($aid < 1 || isset($seen[$aid])) {
      continue;
    }
    $seen[$aid] = true;
    $out[] = $aid;
  }
  return $out;
}

/** @param list<int> $assigneeIds */
/** @param list<int> $reviewerIds */
function ll_tf_assert_assignment_people(array $user, int $groupId, array $assigneeIds, array $reviewerIds): void
{
  $actorId = (int) $user['id'];
  if (!$assigneeIds) {
    ll_error('Assign To is required');
  }
  if (!$reviewerIds) {
    ll_error('At least one reviewer is required');
  }
  $pdo = ll_pdo();
  $mem = $pdo->prepare('SELECT id FROM group_members WHERE group_id = ? AND user_id = ? LIMIT 1');
  foreach ($assigneeIds as $aid) {
    if ($aid === $actorId) {
      ll_error('Cannot assign a task to yourself');
    }
    if (in_array($aid, $reviewerIds, true)) {
      ll_error('Reviewer cannot be the same person as Assign To');
    }
    $mem->execute([$groupId, $aid]);
    if (!$mem->fetch() && empty($user['is_super']) && !ll_tf_can_manage_org($user)) {
      ll_error("User {$aid} is not a member of this group");
    }
    $u = ll_find_user_by_id($aid);
    if (!$u || (int) ($u['is_active'] ?? 0) !== 1) {
      ll_error("Assignee {$aid} not found or inactive");
    }
  }
  foreach ($reviewerIds as $rid) {
    if ($rid === $actorId) {
      ll_error('You cannot assign yourself as a reviewer');
    }
    $mem->execute([$groupId, $rid]);
    if (!$mem->fetch() && empty($user['is_super']) && !ll_tf_can_manage_org($user)) {
      ll_error('Reviewer must be a member of this group');
    }
    $revUser = ll_find_user_by_id($rid);
    if (!$revUser || (int) ($revUser['is_active'] ?? 0) !== 1) {
      ll_error('Reviewer not found or inactive');
    }
  }
}

function ll_tf_assign_tasks(array $user, array $form): void
{
  ll_tf_assert_form_creator($user, (int) $form['group_id']);
  if (empty($form['is_active'])) {
    ll_error('Cannot create a task from an inactive template');
  }
  $body = ll_read_json_body();
  $draftTaskId = (int) ($body['task_id'] ?? $body['draft_task_id'] ?? 0);
  if ($draftTaskId > 0) {
    $existing = ll_tf_load_task($draftTaskId);
    if (!$existing || (int) $existing['form_id'] !== (int) $form['id']) {
      ll_error('Task not found', 404);
    }
    ll_tf_finalize_task_assignment($user, $existing, $body);
  }
  $assigneeIds = ll_tf_normalize_assignee_ids($body['assignee_ids'] ?? $body['assignees'] ?? [], $body);
  if (!$assigneeIds || !empty($body['draft'])) {
    ll_tf_create_draft_task($user, $form, $body);
  }
  $reviewerIds = ll_tf_read_reviewer_ids($body);
  $status = (string) ($body['status'] ?? 'pending');
  if ($status === 'submitted') {
    $status = 'completed';
  }
  if (!in_array($status, ['pending', 'in_progress', 'completed'], true)) {
    ll_error('Status must be pending, in progress, or completed');
  }
  $scope = (string) ($body['reviewer_scope'] ?? 'group');
  if (!in_array($scope, ['group', 'department'], true)) {
    $scope = 'group';
  }
  $taskTitle = trim((string) ($body['title'] ?? $body['task_title'] ?? ''));
  if (strlen($taskTitle) > 200) {
    $taskTitle = substr($taskTitle, 0, 200);
  }
  $dueOn = trim((string) ($body['due_on'] ?? $body['due_at'] ?? ''));
  if ($dueOn === '') {
    $dueOn = null;
  } elseif (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $dueOn)) {
    ll_error('due_on must be YYYY-MM-DD');
  }
  $pdo = ll_pdo();
  $groupId = (int) $form['group_id'];
  $formId = (int) $form['id'];
  ll_tf_assert_assignment_people($user, $groupId, $assigneeIds, $reviewerIds);
  ll_tf_ensure_system_fields($formId);
  $fields = ll_tf_load_fields($formId);
  $snapshot = json_encode(ll_tf_fields_snapshot($fields), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  $reviewerId = $reviewerIds[0];
  $created = [];
  $ins = $pdo->prepare(
    'INSERT INTO form_tasks
      (form_id, assignee_id, assigned_by, reviewer_id, reviewer_scope, status, title, due_on, field_snapshot_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  $ansIns = $pdo->prepare(
    'INSERT INTO form_answers (task_id, field_id, value_text) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE value_text = VALUES(value_text)'
  );

  $actorId = (int) $user['id'];
  foreach ($assigneeIds as $aid) {
    $ins->execute([
      $formId,
      $aid,
      $actorId,
      $reviewerId,
      $scope,
      $status,
      $taskTitle !== '' ? $taskTitle : null,
      $dueOn,
      $snapshot,
    ]);
    $taskId = (int) $pdo->lastInsertId();
    foreach ($fields as $f) {
      if (($f['field_type'] ?? '') === 'readonly') {
        $ansIns->execute([$taskId, (int) $f['id'], (string) ($f['readonly_value'] ?? '')]);
      }
    }
    ll_tf_replace_task_reviewers($taskId, $reviewerIds);
    $assignee = ll_find_user_by_id($aid);
    ll_tf_log_task_event($taskId, $actorId, 'created', null, $status);
    ll_tf_log_task_event($taskId, $actorId, 'assigned', null, $status, ll_tf_user_display_name($assignee) ?: null);
    $created[] = $taskId;
  }
  if (!$created) {
    ll_error('Assign To is required');
  }
  ll_ok([
    'task_ids' => $created,
    'task' => count($created) === 1 ? ll_tf_load_task($created[0]) : null,
    'count' => count($created),
  ], 201);
}

function ll_tf_create_draft_task(array $user, array $form, array $body): void
{
  $status = (string) ($body['status'] ?? 'pending');
  if ($status === 'submitted') {
    $status = 'completed';
  }
  if (!in_array($status, ['pending', 'in_progress', 'completed'], true)) {
    $status = 'pending';
  }
  $pdo = ll_pdo();
  $formId = (int) $form['id'];
  $actorId = (int) $user['id'];
  $existingDraft = $pdo->prepare(
    'SELECT id FROM form_tasks
     WHERE form_id = ? AND assigned_by = ? AND assignee_id IS NULL
     ORDER BY id DESC LIMIT 1'
  );
  $existingDraft->execute([$formId, $actorId]);
  $draftId = (int) ($existingDraft->fetchColumn() ?: 0);
  if ($draftId > 0) {
    $task = ll_tf_load_task($draftId);
    if ($task) {
      ll_ok([
        'task_ids' => [$draftId],
        'task' => $task,
        'count' => 1,
        'draft' => true,
      ], 201);
    }
  }
  ll_tf_ensure_system_fields($formId);
  $fields = ll_tf_load_fields($formId);
  $snapshot = json_encode(ll_tf_fields_snapshot($fields), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  $pdo->prepare(
    'INSERT INTO form_tasks
      (form_id, assignee_id, assigned_by, reviewer_id, reviewer_scope, status, title, due_on, field_snapshot_json)
     VALUES (?, NULL, ?, NULL, \'group\', ?, NULL, NULL, ?)'
  )->execute([$formId, (int) $user['id'], $status, $snapshot]);
  $taskId = (int) $pdo->lastInsertId();
  $ansIns = $pdo->prepare(
    'INSERT INTO form_answers (task_id, field_id, value_text) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE value_text = VALUES(value_text)'
  );
  foreach ($fields as $f) {
    if (($f['field_type'] ?? '') === 'readonly') {
      $ansIns->execute([$taskId, (int) $f['id'], (string) ($f['readonly_value'] ?? '')]);
    }
  }
  ll_tf_log_task_event($taskId, (int) $user['id'], 'created', null, $status);
  $task = ll_tf_load_task($taskId);
  ll_ok([
    'task_ids' => [$taskId],
    'task' => $task,
    'count' => 1,
    'draft' => true,
  ], 201);
}

function ll_tf_copy_task_answers(int $fromTaskId, int $toTaskId): void
{
  $pdo = ll_pdo();
  $rows = $pdo->prepare('SELECT field_id, value_text FROM form_answers WHERE task_id = ?');
  $rows->execute([$fromTaskId]);
  $ins = $pdo->prepare(
    'INSERT INTO form_answers (task_id, field_id, value_text) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE value_text = VALUES(value_text)'
  );
  foreach ($rows->fetchAll() as $row) {
    $ins->execute([$toTaskId, (int) $row['field_id'], $row['value_text']]);
  }
}

function ll_tf_finalize_task_assignment(array $user, array $task, array $body): void
{
  if (!empty($task['assignee_id'])) {
    ll_error('This task is already assigned');
  }
  $assigneeIds = ll_tf_normalize_assignee_ids($body['assignee_ids'] ?? $body['assignees'] ?? null, $body);
  $reviewerIds = ll_tf_read_reviewer_ids($body);
  $scope = (string) ($body['reviewer_scope'] ?? 'group');
  if (!in_array($scope, ['group', 'department'], true)) {
    $scope = 'group';
  }
  $pdo = ll_pdo();
  $groupId = (int) $task['group_id'];
  $formId = (int) $task['form_id'];
  $actorId = (int) $user['id'];
  ll_tf_assert_assignment_people($user, $groupId, $assigneeIds, $reviewerIds);
  $reviewerId = $reviewerIds[0];
  $first = $assigneeIds[0];
  $pdo->prepare(
    'UPDATE form_tasks SET assignee_id = ?, reviewer_id = ?, reviewer_scope = ?, assigned_by = COALESCE(assigned_by, ?)
     WHERE id = ?'
  )->execute([$first, $reviewerId, $scope, $actorId, (int) $task['id']]);
  ll_tf_replace_task_reviewers((int) $task['id'], $reviewerIds);
  $assignee = ll_find_user_by_id($first);
  ll_tf_log_task_event(
    (int) $task['id'],
    $actorId,
    'assigned',
    null,
    (string) ($task['status'] ?? 'pending'),
    ll_tf_user_display_name($assignee) ?: null
  );
  $created = [(int) $task['id']];
  $extras = array_slice($assigneeIds, 1);
  if ($extras) {
    $ins = $pdo->prepare(
      'INSERT INTO form_tasks
        (form_id, assignee_id, assigned_by, reviewer_id, reviewer_scope, status, title, due_on, field_snapshot_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $snapshot = $pdo->prepare('SELECT field_snapshot_json, status, title, due_on FROM form_tasks WHERE id = ?');
    $snapshot->execute([(int) $task['id']]);
    $src = $snapshot->fetch() ?: [];
    $cloneStatus = (string) ($src['status'] ?? $task['status'] ?? 'pending');
    foreach ($extras as $aid) {
      $ins->execute([
        $formId,
        $aid,
        $actorId,
        $reviewerId,
        $scope,
        $cloneStatus,
        $src['title'] ?? $task['task_title'] ?? null,
        $src['due_on'] ?? $task['due_on'] ?? null,
        $src['field_snapshot_json'] ?? null,
      ]);
      $cloneId = (int) $pdo->lastInsertId();
      ll_tf_copy_task_answers((int) $task['id'], $cloneId);
      ll_tf_replace_task_reviewers($cloneId, $reviewerIds);
      $cloneAssignee = ll_find_user_by_id($aid);
      ll_tf_log_task_event($cloneId, $actorId, 'created', null, $cloneStatus);
      ll_tf_log_task_event($cloneId, $actorId, 'assigned', null, $cloneStatus, ll_tf_user_display_name($cloneAssignee) ?: null);
      $created[] = $cloneId;
    }
  }
  $fresh = ll_tf_load_task((int) $task['id']);
  ll_ok([
    'task' => $fresh,
    'task_ids' => $created,
    'count' => count($created),
  ]);
}

function ll_tf_can_review_task(array $user, array $taskRow): bool
{
  if (!empty($user['is_super']) || ll_tf_can_manage_org($user)) {
    return true;
  }
  $uid = (int) $user['id'];
  $reviewerIds = $taskRow['reviewer_ids'] ?? null;
  if (!is_array($reviewerIds)) {
    $reviewerIds = ll_tf_task_reviewer_id_list((int) ($taskRow['id'] ?? 0));
  }
  $reviewerIds = array_values(array_filter(array_map('intval', $reviewerIds ?: [])));
  if ($reviewerIds) {
    return in_array($uid, $reviewerIds, true);
  }
  $designated = (int) ($taskRow['reviewer_id'] ?? 0);
  if ($designated > 0) {
    return $uid === $designated;
  }
  $groupId = (int) $taskRow['group_id'];
  $deptId = (int) $taskRow['department_id'];
  $scope = (string) $taskRow['reviewer_scope'];
  if ($scope === 'department') {
    $stmt = ll_pdo()->prepare(
      'SELECT gm.id FROM group_members gm
       INNER JOIN org_groups g ON g.id = gm.group_id
       WHERE gm.user_id = ? AND gm.role = \'reviewer\' AND g.department_id = ?
       LIMIT 1'
    );
    $stmt->execute([$uid, $deptId]);
    return (bool) $stmt->fetch();
  }
  return ll_tf_user_has_group_role($uid, $groupId, 'reviewer');
}

function ll_tf_load_task(int $taskId): ?array
{
  $stmt = ll_pdo()->prepare(
    "SELECT t.*, f.title AS form_title, f.group_id, f.description AS form_description,
            f.created_by AS form_created_by,
            g.name AS group_name, g.department_id, d.name AS department_name,
            ua.display_name AS assignee_name, ua.username AS assignee_username,
            ub.display_name AS assigned_by_name,
            ur.display_name AS reviewer_name, ur.username AS reviewer_username
     FROM form_tasks t
     INNER JOIN form_templates f ON f.id = t.form_id
     INNER JOIN org_groups g ON g.id = f.group_id
     INNER JOIN departments d ON d.id = g.department_id
     LEFT JOIN users ua ON ua.id = t.assignee_id
     LEFT JOIN users ub ON ub.id = t.assigned_by
     LEFT JOIN users ur ON ur.id = t.reviewer_id
     WHERE t.id = ? LIMIT 1"
  );
  $stmt->execute([$taskId]);
  $r = $stmt->fetch();
  if (!$r) {
    return null;
  }
  $fields = ll_tf_fields_from_snapshot($r['field_snapshot_json'] ?? null);
  if (!$fields) {
    $fields = ll_tf_load_fields((int) $r['form_id']);
    if ($fields) {
      try {
        ll_pdo()->prepare('UPDATE form_tasks SET field_snapshot_json = ? WHERE id = ?')->execute([
          json_encode(ll_tf_fields_snapshot($fields), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
          $taskId,
        ]);
      } catch (Throwable $e) {
        /* snapshot column may be mid-migrate */
      }
    }
  }
  $ansStmt = ll_pdo()->prepare('SELECT field_id, value_text FROM form_answers WHERE task_id = ?');
  $ansStmt->execute([$taskId]);
  $answersByFieldId = [];
  foreach ($ansStmt->fetchAll() as $a) {
    $answersByFieldId[(int) $a['field_id']] = $a['value_text'];
  }
  // Ensure readonly values present
  foreach ($fields as $f) {
    if ($f['field_type'] === 'readonly' && !array_key_exists($f['id'], $answersByFieldId)) {
      $answersByFieldId[$f['id']] = $f['readonly_value'];
    }
  }
  $answersByFieldId = ll_tf_apply_calculated($fields, $answersByFieldId);
  $answers = [];
  foreach ($fields as $f) {
    $answers[] = [
      'field_id' => $f['id'],
      'value' => $answersByFieldId[$f['id']] ?? null,
    ];
  }
  try {
    $cmt = ll_pdo()->prepare(
      'SELECT c.id, c.task_id, c.user_id, c.body, c.created_at, c.status_at_time, c.attachments_json,
              c.time_spent_minutes,
              u.display_name, u.username
       FROM form_comments c INNER JOIN users u ON u.id = c.user_id
       WHERE c.task_id = ? ORDER BY c.created_at ASC'
    );
    $cmt->execute([$taskId]);
    $commentRows = $cmt->fetchAll();
  } catch (Throwable $e) {
    $cmt = ll_pdo()->prepare(
      'SELECT c.id, c.task_id, c.user_id, c.body, c.created_at, c.status_at_time, c.attachments_json,
              u.display_name, u.username
       FROM form_comments c INNER JOIN users u ON u.id = c.user_id
       WHERE c.task_id = ? ORDER BY c.created_at ASC'
    );
    $cmt->execute([$taskId]);
    $commentRows = $cmt->fetchAll();
  }
  $comments = array_map(static function ($c) {
    $statusAt = $c['status_at_time'] ?? null;
    $statusAt = is_string($statusAt) && $statusAt !== '' ? $statusAt : null;
    $spent = $c['time_spent_minutes'] ?? null;
    return [
      'id' => (int) $c['id'],
      'task_id' => (int) $c['task_id'],
      'user_id' => (int) $c['user_id'],
      'body' => (string) $c['body'],
      'created_at' => $c['created_at'],
      'status_at_time' => $statusAt,
      'time_spent_minutes' => $spent !== null && $spent !== '' ? (int) $spent : null,
      'attachments' => ll_tf_comment_attachments_public($c['attachments_json'] ?? null),
      'display_name' => (string) ($c['display_name'] ?: $c['username']),
    ];
  }, $commentRows);

  $progress = ll_tf_progress($fields, $answersByFieldId);
  $reviewers = ll_tf_load_task_reviewers($taskId);
  if (!$reviewers && isset($r['reviewer_id']) && (int) $r['reviewer_id'] > 0) {
    $reviewers[] = [
      'id' => (int) $r['reviewer_id'],
      'display_name' => (string) ($r['reviewer_name'] ?: ($r['reviewer_username'] ?? '')),
    ];
  }
  $reviewerIds = array_values(array_map(static fn ($rev) => (int) $rev['id'], $reviewers));
  $reviewerNames = array_values(array_filter(array_map(
    static fn ($rev) => trim((string) ($rev['display_name'] ?? '')),
    $reviewers
  )));

  return [
    'id' => (int) $r['id'],
    'form_id' => (int) $r['form_id'],
    'form_title' => ll_tf_task_display_title($r['title'] ?? null, $r['form_title'] ?? null),
    'template_title' => (string) $r['form_title'],
    'task_title' => trim((string) ($r['title'] ?? '')) !== '' ? trim((string) $r['title']) : null,
    'due_on' => $r['due_on'] ?? null,
    'form_description' => $r['form_description'] !== null ? (string) $r['form_description'] : null,
    'form_created_by' => $r['form_created_by'] !== null ? (int) $r['form_created_by'] : null,
    'group_id' => (int) $r['group_id'],
    'group_name' => (string) $r['group_name'],
    'department_id' => (int) $r['department_id'],
    'department_name' => (string) $r['department_name'],
    'assignee_id' => $r['assignee_id'] !== null && (int) $r['assignee_id'] > 0 ? (int) $r['assignee_id'] : null,
    'assignee_name' => ($r['assignee_id'] !== null && (int) $r['assignee_id'] > 0)
      ? (string) ($r['assignee_name'] ?: $r['assignee_username'])
      : null,
    'is_draft' => $r['assignee_id'] === null || (int) $r['assignee_id'] < 1,
    'assigned_by' => $r['assigned_by'] !== null ? (int) $r['assigned_by'] : null,
    'assigned_by_name' => $r['assigned_by_name'] ?? null,
    'reviewer_id' => $reviewerIds[0] ?? (isset($r['reviewer_id']) && $r['reviewer_id'] !== null ? (int) $r['reviewer_id'] : null),
    'reviewer_ids' => $reviewerIds,
    'reviewers' => $reviewers,
    'reviewer_name' => $reviewerNames ? implode(', ', $reviewerNames) : null,
    'reviewer_scope' => (string) $r['reviewer_scope'],
    'status' => (string) $r['status'],
    'submitted_at' => $r['submitted_at'],
    'approved_at' => $r['approved_at'],
    'closed_at' => $r['closed_at'],
    'created_at' => $r['created_at'],
    'updated_at' => $r['updated_at'],
    'fields' => $fields,
    'answers' => $answers,
    'comments' => $comments,
    'events' => ll_tf_load_task_events($taskId),
    'progress' => $progress,
  ];
}

function ll_tf_assert_task_access(array $user, array $task): void
{
  $uid = (int) $user['id'];
  if (!empty($user['is_super']) || ll_tf_can_manage_org($user)) {
    return;
  }
  if ((int) ($task['assignee_id'] ?? 0) > 0 && $uid === (int) $task['assignee_id']) {
    return;
  }
  if (ll_tf_is_task_form_creator($user, $task)) {
    return;
  }
  if (ll_tf_can_review_task($user, $task)) {
    return;
  }
  if (ll_tf_user_has_group_role($uid, (int) $task['group_id'], 'form_creator')) {
    return;
  }
  ll_error('Forbidden', 403);
}

function ll_tf_route_tasks(array $user, ?int $id, string $sub): void
{
  $method = ll_method();
  $pdo = ll_pdo();

  if ($method === 'GET' && $id === null) {
    $mine = isset($_GET['mine']) && $_GET['mine'] !== '0';
    $review = isset($_GET['review']) && $_GET['review'] !== '0';
    $since = trim((string) ($_GET['since'] ?? ''));
    $uid = (int) $user['id'];

    if ($mine) {
      $sql = "SELECT t.id, t.form_id, t.status, t.reviewer_scope, t.updated_at, t.submitted_at,
                     t.title AS task_title, t.due_on,
                     f.title AS form_title, g.id AS group_id, g.name AS group_name,
                     d.id AS department_id, d.name AS department_name
              FROM form_tasks t
              INNER JOIN form_templates f ON f.id = t.form_id
              INNER JOIN org_groups g ON g.id = f.group_id
              INNER JOIN departments d ON d.id = g.department_id
              WHERE t.assignee_id = ?";
      $params = [$uid];
      if ($since !== '') {
        $sql .= ' AND t.updated_at > ?';
        $params[] = $since;
      }
      $sql .= ' ORDER BY t.updated_at DESC';
      $stmt = $pdo->prepare($sql);
      $stmt->execute($params);
      ll_ok(['tasks' => array_map('ll_tf_task_list_row', $stmt->fetchAll())]);
    }

    if ($review) {
      ll_tf_route_review_list($user, $since);
    }

    ll_error('Specify ?mine=1 or ?review=1', 400);
  }

  if ($id === null) {
    ll_error('Not found', 404);
  }

  $task = ll_tf_load_task($id);
  if (!$task) {
    ll_error('Task not found', 404);
  }
  ll_tf_assert_task_access($user, $task);

  if ($method === 'GET' && $sub === '') {
    ll_ok(['task' => $task]);
  }

  if ($method === 'POST' && $sub === 'status') {
    ll_tf_task_set_status($user, $task, ll_read_json_body());
  }

  if ($method === 'POST' && $sub === 'answers') {
    ll_tf_task_save_answers($user, $task, ll_read_json_body());
  }

  if ($method === 'POST' && $sub === 'files') {
    ll_tf_task_upload_file($user, $task);
  }

  if ($method === 'GET' && $sub === 'file') {
    ll_tf_task_download_file($user, $task);
  }

  if ($method === 'GET' && $sub === 'comment-file') {
    ll_tf_comment_download_file($user, $task);
  }

  if ($method === 'POST' && $sub === 'comments') {
    ll_tf_task_add_comment($user, $task);
  }

  if ($method === 'POST' && $sub === 'submit') {
    ll_tf_task_submit($user, $task);
  }

  if ($method === 'POST' && $sub === 'approve') {
    if (ll_tf_user_is_assignee($user, $task)) {
      ll_error('You cannot approve your own assignment', 403);
    }
    if (!ll_tf_can_review_task($user, $task)) {
      ll_error('Reviewer role required', 403);
    }
    if (!in_array($task['status'], ['submitted', 'in_progress', 'rework'], true)) {
      ll_error('Task cannot be approved from status ' . $task['status']);
    }
    $from = (string) $task['status'];
    $pdo->prepare(
      "UPDATE form_tasks SET status = 'approved', approved_at = UTC_TIMESTAMP() WHERE id = ?"
    )->execute([$id]);
    ll_tf_log_task_event((int) $id, (int) $user['id'], 'approved', $from, 'approved');
    ll_ok(['task' => ll_tf_load_task($id)]);
  }

  if ($method === 'POST' && $sub === 'rework') {
    if (!ll_tf_can_review_task($user, $task)) {
      ll_error('Reviewer role required', 403);
    }
    $body = ll_read_json_body();
    $note = trim((string) ($body['body'] ?? $body['note'] ?? ''));
    $from = (string) $task['status'];
    $pdo->prepare(
      "UPDATE form_tasks SET status = 'rework', submitted_at = NULL, approved_at = NULL WHERE id = ?"
    )->execute([$id]);
    if ($note !== '') {
      ll_tf_insert_comment((int) $id, (int) $user['id'], $note, 'rework');
    }
    ll_tf_log_task_event((int) $id, (int) $user['id'], 'rework', $from, 'rework');
    ll_ok(['task' => ll_tf_load_task($id)]);
  }

  if ($method === 'POST' && $sub === 'close') {
    if (ll_tf_user_is_assignee($user, $task)) {
      ll_error('You cannot close your own assignment', 403);
    }
    $uid = (int) $user['id'];
    $canClose = !empty($user['is_super'])
      || ll_tf_can_manage_org($user)
      || ll_tf_user_has_group_role($uid, (int) $task['group_id'], 'form_creator');
    if (!$canClose) {
      ll_error('Form creator role required to close', 403);
    }
    if ($task['status'] !== 'approved') {
      ll_error('Only approved tasks can be closed');
    }
    $pdo->prepare(
      "UPDATE form_tasks SET status = 'closed', closed_at = UTC_TIMESTAMP() WHERE id = ?"
    )->execute([$id]);
    ll_tf_log_task_event((int) $id, (int) $user['id'], 'closed', 'approved', 'closed');
    ll_ok(['task' => ll_tf_load_task($id)]);
  }

  // PATCH-style update via POST update
  if (($method === 'POST' && $sub === 'update') || ($method === 'PATCH' && $sub === '')) {
    $body = ll_read_json_body();
    if (isset($body['assignee_ids']) || isset($body['assignee_id']) || isset($body['assignees'])) {
      ll_tf_assert_form_creator($user, (int) $task['group_id']);
      ll_tf_finalize_task_assignment($user, $task, $body);
    }
    if (isset($body['status'])) {
      ll_tf_task_set_status($user, $task, $body);
    }
    if (isset($body['answers'])) {
      ll_tf_task_save_answers($user, $task, $body);
    }
    ll_ok(['task' => ll_tf_load_task($id)]);
  }

  ll_error('Not found', 404);
}

function ll_tf_task_list_row(array $row): array
{
  return [
    'id' => (int) $row['id'],
    'form_id' => (int) $row['form_id'],
    'form_title' => ll_tf_task_display_title($row['task_title'] ?? null, $row['form_title'] ?? null),
    'template_title' => (string) ($row['form_title'] ?? ''),
    'due_on' => $row['due_on'] ?? null,
    'status' => (string) $row['status'],
    'reviewer_scope' => (string) ($row['reviewer_scope'] ?? 'group'),
    'group_id' => (int) ($row['group_id'] ?? 0),
    'group_name' => (string) ($row['group_name'] ?? ''),
    'department_id' => (int) ($row['department_id'] ?? 0),
    'department_name' => (string) ($row['department_name'] ?? ''),
    'assignee_id' => isset($row['assignee_id']) ? (int) $row['assignee_id'] : null,
    'assignee_name' => $row['assignee_name'] ?? null,
    'updated_at' => $row['updated_at'] ?? null,
    'submitted_at' => $row['submitted_at'] ?? null,
    'progress' => isset($row['progress_percent']) ? [
      'percent' => (int) $row['progress_percent'],
      'filled' => (int) ($row['progress_filled'] ?? 0),
      'total' => (int) ($row['progress_total'] ?? 0),
    ] : null,
  ];
}

function ll_tf_assert_required_fields_filled(array $task, array $answersById): void
{
  foreach ($task['fields'] as $f) {
    if (empty($f['required'])) {
      continue;
    }
    if (in_array($f['field_type'], ['readonly', 'calculated'], true) || ll_tf_is_system_field($f)) {
      continue;
    }
    $val = $answersById[(int) $f['id']] ?? null;
    if ($val === null || trim((string) $val) === '') {
      ll_error('Required field missing: ' . $f['label']);
    }
  }
}

function ll_tf_task_set_status(array $user, array $task, array $body): void
{
  $status = (string) ($body['status'] ?? '');
  if ($status === 'submitted') {
    ll_tf_task_submit($user, $task, $body);
    return;
  }
  if (!in_array($status, ['pending', 'in_progress', 'completed'], true)) {
    ll_error('Assignees may set status to pending, in_progress, or completed');
  }
  if (!ll_tf_can_set_task_status($user, $task)) {
    ll_error('Only the assignee or form creator can change this status', 403);
  }
  if (in_array($task['status'], ['submitted', 'approved', 'closed'], true)) {
    ll_error('Task is locked after submit');
  }
  if (is_array($body['answers'] ?? null) && ll_tf_can_edit_task_answers($user, $task)) {
    ll_tf_task_save_answers($user, $task, ['answers' => $body['answers']], false);
    $task = ll_tf_load_task((int) $task['id']) ?? $task;
  }
  $from = (string) ($task['status'] ?? '');
  if ($from !== $status) {
    ll_pdo()->prepare('UPDATE form_tasks SET status = ? WHERE id = ?')
      ->execute([$status, (int) $task['id']]);
    ll_tf_log_task_event((int) $task['id'], (int) $user['id'], 'status_changed', $from, $status);
  }
  ll_ok(['task' => ll_tf_load_task((int) $task['id'])]);
}

function ll_tf_task_submit(array $user, array $task, ?array $jsonBody = null): void
{
  if (!ll_tf_can_set_task_status($user, $task)) {
    ll_error('Only the assignee or form creator can submit this task', 403);
  }
  if (($task['status'] ?? '') !== 'completed') {
    ll_error('Complete the task before submitting');
  }

  $answersById = [];
  foreach ($task['answers'] as $a) {
    $answersById[(int) $a['field_id']] = $a['value'] ?? null;
  }
  if (is_array($jsonBody['answers'] ?? null) && ll_tf_can_edit_task_answers($user, $task)) {
    ll_tf_task_save_answers($user, $task, ['answers' => $jsonBody['answers']], false);
    $task = ll_tf_load_task((int) $task['id']) ?? $task;
    $answersById = [];
    foreach ($task['answers'] as $a) {
      $answersById[(int) $a['field_id']] = $a['value'] ?? null;
    }
  }
  ll_tf_assert_required_fields_filled($task, $answersById);

  $ct = strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? ''));
  $multipart = str_contains($ct, 'multipart/form-data');
  $text = '';
  $linksIn = [];
  if ($multipart) {
    $text = trim((string) ($_POST['body'] ?? ''));
    $rawLinks = $_POST['links'] ?? [];
    if (is_string($rawLinks)) {
      $decoded = json_decode($rawLinks, true);
      $linksIn = is_array($decoded) ? $decoded : [];
    } elseif (is_array($rawLinks)) {
      $linksIn = $rawLinks;
    }
  } elseif (is_array($jsonBody)) {
    $text = trim((string) ($jsonBody['body'] ?? ''));
    $linksIn = $jsonBody['links'] ?? [];
  }
  $links = ll_tf_normalize_comment_links($linksIn);
  $uploads = $multipart ? ll_tf_collect_upload_files() : [];
  if (count($uploads) > 8) {
    ll_error('At most 8 files per comment');
  }
  $acceptedAll = [];
  foreach ($uploads as $file) {
    $acceptedAll[] = ll_tf_accept_upload($file);
  }

  $taskId = (int) $task['id'];
  $stored = [];
  $attachments = [];
  try {
    foreach ($acceptedAll as $accepted) {
      $storedName = 'cmt_' . bin2hex(random_bytes(8)) . '.' . $accepted['ext'];
      $rel = ll_tf_store_task_file($taskId, $storedName, $accepted['tmp']);
      $stored[] = $rel;
      $attachments[] = [
        'type' => 'file',
        'name' => $accepted['safe_name'],
        'size' => $accepted['size'],
        'mime' => $accepted['mime'],
        'stored' => $rel,
      ];
    }
    foreach ($links as $link) {
      $attachments[] = $link;
    }
    if ($text !== '' || $attachments) {
      ll_tf_insert_comment($taskId, (int) $user['id'], $text, 'submitted', $attachments);
    }
  } catch (Throwable $e) {
    foreach ($stored as $rel) {
      ll_tf_doc_unlink_stored($rel);
    }
    throw $e;
  }

  $from = (string) $task['status'];
  ll_pdo()->prepare(
    "UPDATE form_tasks SET status = 'submitted', submitted_at = UTC_TIMESTAMP() WHERE id = ?"
  )->execute([$taskId]);
  ll_tf_log_task_event($taskId, (int) $user['id'], 'submitted', $from, 'submitted');
  try {
    $fresh = ll_tf_load_task($taskId);
    ll_tf_notify_task_completed($fresh ?? $task, $user);
  } catch (Throwable $e) {
    // Task is submitted; notification failure must not fail the status change.
  }
  ll_ok(['task' => ll_tf_load_task($taskId)]);
}

function ll_tf_task_save_answers(array $user, array $task, array $body, bool $respond = true): void
{
  $uid = (int) $user['id'];
  if (!ll_tf_can_edit_task_answers($user, $task)) {
    ll_error('Only the form creator can edit answers', 403);
  }
  if (in_array($task['status'], ['approved', 'closed'], true)) {
    ll_error('Answers are locked after approval');
  }
  $answers = $body['answers'] ?? null;
  if (!is_array($answers)) {
    ll_error('answers array is required');
  }
  $fieldsById = [];
  foreach ($task['fields'] as $f) {
    $fieldsById[(int) $f['id']] = $f;
  }
  $pdo = ll_pdo();
  $upsert = $pdo->prepare(
    'INSERT INTO form_answers (task_id, field_id, value_text) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE value_text = VALUES(value_text)'
  );
  $answersByFieldId = [];
  foreach ($task['answers'] as $a) {
    $answersByFieldId[(int) $a['field_id']] = $a['value'] ?? null;
  }
  foreach ($answers as $a) {
    $fid = (int) ($a['field_id'] ?? 0);
    if ($fid < 1 || !isset($fieldsById[$fid])) {
      continue;
    }
    $f = $fieldsById[$fid];
    $val = $a['value'] ?? null;
    if ($val !== null && !is_scalar($val)) {
      $val = json_encode($val);
    }
    $valStr = $val === null ? null : (string) $val;
    if (in_array($f['field_type'], ['number', 'calculated'], true)
        && !ll_tf_is_valid_number_answer($valStr)) {
      ll_error('Invalid number for field: ' . $f['label']);
    }
    if ($f['field_type'] === 'url' && !ll_tf_is_valid_url_answer($valStr)) {
      ll_error('Invalid URL for field: ' . $f['label']);
    }
    if (in_array($f['field_type'], ['readonly', 'calculated', 'document', 'assign_to', 'status', 'reviewer'], true)) {
      continue; // ignore client writes; calculated is recomputed; documents via /files
    }
    $upsert->execute([(int) $task['id'], $fid, $valStr]);
    $answersByFieldId[$fid] = $valStr;
  }
  // Recompute calculated
  foreach ($task['fields'] as $f) {
    if ($f['field_type'] === 'readonly') {
      $answersByFieldId[$f['id']] = $f['readonly_value'];
      $upsert->execute([(int) $task['id'], $f['id'], (string) ($f['readonly_value'] ?? '')]);
    }
  }
  $answersByFieldId = ll_tf_apply_calculated($task['fields'], $answersByFieldId);
  foreach ($task['fields'] as $f) {
    if ($f['field_type'] === 'calculated') {
      $computed = $answersByFieldId[$f['id']] ?? null;
      if (!ll_tf_is_valid_number_answer($computed)) {
        $computed = null;
        $answersByFieldId[$f['id']] = null;
      }
      $upsert->execute([(int) $task['id'], $f['id'], $computed]);
    }
  }
  // Auto move pending → in_progress on first save
  if ($task['status'] === 'pending') {
    $pdo->prepare("UPDATE form_tasks SET status = 'in_progress' WHERE id = ?")
      ->execute([(int) $task['id']]);
    ll_tf_log_task_event((int) $task['id'], (int) $user['id'], 'status_changed', 'pending', 'in_progress');
  } else {
    $pdo->prepare('UPDATE form_tasks SET updated_at = UTC_TIMESTAMP() WHERE id = ?')
      ->execute([(int) $task['id']]);
  }
  if ($respond) {
    ll_ok(['task' => ll_tf_load_task((int) $task['id'])]);
  }
}

function ll_tf_task_add_comment(array $user, array $task): void
{
  $ct = strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? ''));
  $multipart = str_contains($ct, 'multipart/form-data');
  $text = '';
  $linksIn = [];
  $timeSpent = null;
  if ($multipart) {
    $text = trim((string) ($_POST['body'] ?? ''));
    $rawLinks = $_POST['links'] ?? [];
    if (is_string($rawLinks)) {
      $decoded = json_decode($rawLinks, true);
      $linksIn = is_array($decoded) ? $decoded : [];
    } elseif (is_array($rawLinks)) {
      $linksIn = $rawLinks;
    }
    $timeSpent = ll_tf_parse_time_spent_minutes($_POST['time_spent_minutes'] ?? $_POST['time_spent'] ?? null);
  } else {
    $body = ll_read_json_body();
    $text = trim((string) ($body['body'] ?? ''));
    $linksIn = $body['links'] ?? [];
    $timeSpent = ll_tf_parse_time_spent_minutes($body['time_spent_minutes'] ?? $body['time_spent'] ?? null);
  }
  $links = ll_tf_normalize_comment_links($linksIn);
  $uploads = $multipart ? ll_tf_collect_upload_files() : [];
  if (count($uploads) > 8) {
    ll_error('At most 8 files per comment');
  }
  $acceptedAll = [];
  foreach ($uploads as $file) {
    $acceptedAll[] = ll_tf_accept_upload($file);
  }
  if ($text === '' && !$links && !$acceptedAll) {
    ll_error('Comment text, file, or link is required');
  }

  $taskId = (int) $task['id'];
  $stored = [];
  $attachments = [];
  try {
    foreach ($acceptedAll as $accepted) {
      $storedName = 'cmt_' . bin2hex(random_bytes(8)) . '.' . $accepted['ext'];
      $rel = ll_tf_store_task_file($taskId, $storedName, $accepted['tmp']);
      $stored[] = $rel;
      $attachments[] = [
        'type' => 'file',
        'name' => $accepted['safe_name'],
        'size' => $accepted['size'],
        'mime' => $accepted['mime'],
        'stored' => $rel,
      ];
    }
    foreach ($links as $link) {
      $attachments[] = $link;
    }
    ll_tf_insert_comment($taskId, (int) $user['id'], $text, (string) ($task['status'] ?? ''), $attachments, $timeSpent);
  } catch (Throwable $e) {
    foreach ($stored as $rel) {
      ll_tf_doc_unlink_stored($rel);
    }
    throw $e;
  }
  ll_ok(['task' => ll_tf_load_task($taskId)], 201);
}

function ll_tf_comment_download_file(array $user, array $task): void
{
  $commentId = (int) ($_GET['comment_id'] ?? 0);
  $index = (int) ($_GET['i'] ?? -1);
  if ($commentId < 1 || $index < 0) {
    ll_error('File not found', 404);
  }
  $stmt = ll_pdo()->prepare(
    'SELECT id, attachments_json FROM form_comments WHERE id = ? AND task_id = ? LIMIT 1'
  );
  $stmt->execute([$commentId, (int) $task['id']]);
  $row = $stmt->fetch();
  if (!$row) {
    ll_error('File not found', 404);
  }
  $atts = ll_tf_parse_comment_attachments($row['attachments_json'] ?? null);
  $att = $atts[$index] ?? null;
  if (!$att || ($att['type'] ?? '') !== 'file') {
    ll_error('File not found', 404);
  }
  $abs = ll_tf_doc_abs_path((string) ($att['stored'] ?? ''));
  if (!$abs || !is_file($abs)) {
    ll_error('File not found', 404);
  }
  $downloadName = (string) ($att['name'] ?? 'document');
  $downloadName = str_replace(['"', "\r", "\n"], '', $downloadName);
  $mime = (string) (($att['mime'] ?? '') !== '' ? $att['mime'] : 'application/octet-stream');
  $inline = str_starts_with($mime, 'image/') || $mime === 'application/pdf' || str_starts_with($mime, 'text/');
  header('Content-Type: ' . $mime);
  header('X-Content-Type-Options: nosniff');
  header('Cache-Control: private, no-store');
  header('Content-Length: ' . (string) filesize($abs));
  header(
    ($inline ? 'Content-Disposition: inline' : 'Content-Disposition: attachment')
    . '; filename="' . $downloadName . '"'
  );
  readfile($abs);
  exit;
}

function ll_tf_task_upload_file(array $user, array $task): void
{
  if (!ll_tf_can_edit_task_answers($user, $task)) {
    ll_error('Only the form creator can upload files', 403);
  }
  if (in_array($task['status'], ['approved', 'closed'], true)) {
    ll_error('Answers are locked after approval');
  }
  $fid = (int) ($_POST['field_id'] ?? 0);
  $fieldsById = [];
  foreach ($task['fields'] as $f) {
    $fieldsById[(int) $f['id']] = $f;
  }
  if ($fid < 1 || !isset($fieldsById[$fid]) || ($fieldsById[$fid]['field_type'] ?? '') !== 'document') {
    ll_error('Document field not found');
  }
  if (empty($_FILES['file']) || !is_array($_FILES['file'])) {
    ll_error('file is required');
  }
  $accepted = ll_tf_accept_upload($_FILES['file']);
  $taskId = (int) $task['id'];
  $storedName = $fid . '_' . bin2hex(random_bytes(8)) . '.' . $accepted['ext'];
  $stored = ll_tf_store_task_file($taskId, $storedName, $accepted['tmp']);
  $size = $accepted['size'];
  $mime = $accepted['mime'];
  $safeName = $accepted['safe_name'];
  foreach ($task['answers'] as $a) {
    if ((int) ($a['field_id'] ?? 0) === $fid) {
      $prev = ll_tf_parse_document_answer($a['value'] ?? null);
      if ($prev && ($prev['stored'] ?? '') !== $stored) {
        ll_tf_doc_unlink_stored($prev['stored']);
      }
      break;
    }
  }
  $payload = json_encode([
    'name' => $safeName,
    'size' => $size,
    'mime' => $mime,
    'stored' => $stored,
  ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  $pdo = ll_pdo();
  $pdo->prepare(
    'INSERT INTO form_answers (task_id, field_id, value_text) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE value_text = VALUES(value_text)'
  )->execute([$taskId, $fid, $payload]);
  if ($task['status'] === 'pending') {
    $pdo->prepare("UPDATE form_tasks SET status = 'in_progress' WHERE id = ?")
      ->execute([$taskId]);
    ll_tf_log_task_event($taskId, (int) $user['id'], 'status_changed', 'pending', 'in_progress');
  } else {
    $pdo->prepare('UPDATE form_tasks SET updated_at = UTC_TIMESTAMP() WHERE id = ?')
      ->execute([$taskId]);
  }
  ll_ok(['task' => ll_tf_load_task($taskId)]);
}

function ll_tf_task_download_file(array $user, array $task): void
{
  $fid = (int) ($_GET['field_id'] ?? 0);
  $fieldsById = [];
  foreach ($task['fields'] as $f) {
    $fieldsById[(int) $f['id']] = $f;
  }
  if ($fid < 1 || !isset($fieldsById[$fid]) || ($fieldsById[$fid]['field_type'] ?? '') !== 'document') {
    ll_error('Document field not found', 404);
  }
  $value = null;
  foreach ($task['answers'] as $a) {
    if ((int) ($a['field_id'] ?? 0) === $fid) {
      $value = $a['value'] ?? null;
      break;
    }
  }
  $meta = ll_tf_parse_document_answer($value);
  if (!$meta) {
    ll_error('File not found', 404);
  }
  $abs = ll_tf_doc_abs_path($meta['stored']);
  if (!$abs || !is_file($abs)) {
    ll_error('File not found', 404);
  }
  $downloadName = $meta['name'] !== '' ? $meta['name'] : 'document';
  $downloadName = str_replace(['"', "\r", "\n"], '', $downloadName);
  $mime = $meta['mime'] !== '' ? $meta['mime'] : 'application/octet-stream';
  $inline = str_starts_with($mime, 'image/') || $mime === 'application/pdf' || str_starts_with($mime, 'text/');
  header('Content-Type: ' . $mime);
  header('X-Content-Type-Options: nosniff');
  header('Cache-Control: private, no-store');
  header('Content-Length: ' . (string) filesize($abs));
  header(
    ($inline ? 'Content-Disposition: inline' : 'Content-Disposition: attachment')
    . '; filename="' . $downloadName . '"'
  );
  readfile($abs);
  exit;
}

function ll_tf_route_review(array $user, ?int $id, string $sub): void
{
  // Paths: review/tasks  OR  review (with ?since=) — parts[2] may be "tasks" (non-numeric id)
  if (ll_method() === 'GET') {
    $since = trim((string) ($_GET['since'] ?? ''));
    ll_tf_route_review_list($user, $since);
  }
  ll_error('Not found', 404);
}

function ll_tf_route_review_list(array $user, string $since = ''): void
{
  $pdo = ll_pdo();
  $uid = (int) $user['id'];
  $isAll = !empty($user['is_super']) || ll_tf_can_manage_org($user);

  if ($isAll) {
    $sql = "SELECT t.id, t.form_id, t.status, t.reviewer_scope, t.updated_at, t.submitted_at,
                   t.title AS task_title, t.due_on,
                   t.assignee_id, ua.display_name AS assignee_name,
                   f.title AS form_title, g.id AS group_id, g.name AS group_name,
                   d.id AS department_id, d.name AS department_name
            FROM form_tasks t
            INNER JOIN form_templates f ON f.id = t.form_id
            INNER JOIN org_groups g ON g.id = f.group_id
            INNER JOIN departments d ON d.id = g.department_id
            INNER JOIN users ua ON ua.id = t.assignee_id
            WHERE t.status <> 'closed'";
    $params = [];
    if ($since !== '') {
      $sql .= ' AND t.updated_at > ?';
      $params[] = $since;
    }
    $sql .= ' ORDER BY FIELD(t.status, \'submitted\', \'rework\', \'completed\', \'in_progress\', \'pending\', \'approved\'), t.updated_at DESC';
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
  } else {
    $sql = "SELECT DISTINCT t.id, t.form_id, t.status, t.reviewer_scope, t.updated_at, t.submitted_at,
                   t.title AS task_title, t.due_on,
                   t.assignee_id, ua.display_name AS assignee_name,
                   f.title AS form_title, g.id AS group_id, g.name AS group_name,
                   d.id AS department_id, d.name AS department_name
            FROM form_tasks t
            INNER JOIN form_templates f ON f.id = t.form_id
            INNER JOIN org_groups g ON g.id = f.group_id
            INNER JOIN departments d ON d.id = g.department_id
            INNER JOIN users ua ON ua.id = t.assignee_id
            LEFT JOIN form_task_reviewers ftr ON ftr.task_id = t.id AND ftr.user_id = ?
            LEFT JOIN group_members gm ON gm.user_id = ? AND gm.role = 'reviewer'
            LEFT JOIN org_groups rg ON rg.id = gm.group_id
            WHERE t.status <> 'closed'
              AND (
                ftr.user_id IS NOT NULL
                OR t.reviewer_id = ?
                OR (
                  t.reviewer_id IS NULL
                  AND NOT EXISTS (SELECT 1 FROM form_task_reviewers x WHERE x.task_id = t.id)
                  AND gm.id IS NOT NULL
                  AND (
                    (t.reviewer_scope = 'group' AND g.id = gm.group_id)
                    OR (t.reviewer_scope = 'department' AND g.department_id = rg.department_id)
                  )
                )
              )";
    $params = [$uid, $uid, $uid];
    if ($since !== '') {
      $sql .= ' AND t.updated_at > ?';
      $params[] = $since;
    }
    $sql .= ' ORDER BY FIELD(t.status, \'submitted\', \'rework\', \'completed\', \'in_progress\', \'pending\', \'approved\'), t.updated_at DESC';
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
  }

  $tasks = [];
  foreach ($stmt->fetchAll() as $row) {
    $full = ll_tf_load_task((int) $row['id']);
    $list = ll_tf_task_list_row($row);
    if ($full) {
      $list['progress'] = $full['progress'];
    }
    $tasks[] = $list;
  }
  ll_ok(['tasks' => $tasks, 'polled_at' => gmdate('Y-m-d H:i:s')]);
}

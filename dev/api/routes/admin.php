<?php

declare(strict_types=1);

function ll_route_admin(string $action, ?int $id, array $parts): void
{
  switch ($action) {
    case 'users':
      ll_admin_users($id);
      break;
    case 'roles':
      ll_admin_roles($id);
      break;
    case 'access-requests':
      $sub = $parts[2] ?? '';
      $reqId = isset($parts[2]) && ctype_digit((string) $parts[2]) ? (int) $parts[2] : null;
      $verb = $parts[3] ?? '';
      ll_admin_access_requests($reqId, $verb ?: $sub);
      break;
    default:
      ll_error('Not found', 404);
  }
}

function ll_admin_users(?int $id): void
{
  // Permission-based: admin.users is enough. Rank is only used later to
  // block assigning/editing roles above the actor and Super User accounts.
  $actor = ll_require_permission('admin.users');
  $pdo = ll_pdo();
  $method = ll_method();

  if ($method === 'GET' && $id === null) {
    $rows = $pdo->query(
      'SELECT u.id, u.username, u.display_name, u.role_id, u.telecaller_name, u.is_active,
              u.must_change_password, u.notes, u.created_at, u.updated_at,
              r.name AS role_name, r.role_key, r.rank AS role_rank
       FROM users u INNER JOIN roles r ON r.id = u.role_id
       ORDER BY r.rank DESC, u.username ASC'
    )->fetchAll();
    ll_ok(['users' => array_map(static function ($row) {
      return [
        'id' => (int) $row['id'],
        'username' => $row['username'],
        'display_name' => $row['display_name'],
        'role_id' => (int) $row['role_id'],
        'role_name' => $row['role_name'],
        'role_key' => $row['role_key'],
        'role_rank' => (int) $row['role_rank'],
        'telecaller_name' => $row['telecaller_name'],
        'is_active' => (int) $row['is_active'] === 1,
        'must_change_password' => (int) $row['must_change_password'] === 1,
        'notes' => $row['notes'],
        'created_at' => $row['created_at'],
        'updated_at' => $row['updated_at'],
      ];
    }, $rows)]);
  }

  if ($method === 'GET' && $id !== null) {
    $row = ll_find_user_by_id($id);
    if (!$row) {
      ll_error('User not found', 404);
    }
    ll_ok(['user' => ll_public_user($row) + [
      'notes' => $row['notes'] ?? null,
      'created_at' => $row['created_at'] ?? null,
      'updated_at' => $row['updated_at'] ?? null,
    ]]);
  }

  if ($method === 'POST' && $id === null) {
    $body = ll_read_json_body();
    $username = trim((string) ($body['username'] ?? ''));
    $password = (string) ($body['password'] ?? '');
    $display = trim((string) ($body['display_name'] ?? ''));
    $roleId = (int) ($body['role_id'] ?? 0);
    $telecaller = trim((string) ($body['telecaller_name'] ?? ''));
    $notes = trim((string) ($body['notes'] ?? ''));
    $active = array_key_exists('is_active', $body) ? (bool) $body['is_active'] : true;
    if ($username === '' || $password === '' || $roleId < 1) {
      ll_error('username, password, and role_id are required');
    }
    if (strlen($password) < 5) {
      ll_error('Password must be at least 5 characters');
    }
    ll_assert_role_assignable($actor, $roleId);
    if (ll_find_user_by_username($username)) {
      ll_error('Username already exists');
    }
    $hash = password_hash($password, PASSWORD_BCRYPT);
    $pdo->prepare(
      'INSERT INTO users (username, password_hash, display_name, role_id, telecaller_name, is_active, must_change_password, notes)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)'
    )->execute([
      $username,
      $hash,
      $display !== '' ? $display : $username,
      $roleId,
      $telecaller !== '' ? $telecaller : null,
      $active ? 1 : 0,
      $notes !== '' ? $notes : null,
    ]);
    $newId = (int) $pdo->lastInsertId();
    ll_ok(['user' => ll_public_user(ll_find_user_by_id($newId))], 201);
  }

  if (($method === 'PUT' || $method === 'PATCH') && $id !== null) {
    $row = ll_find_user_by_id($id);
    if (!$row) {
      ll_error('User not found', 404);
    }
    ll_assert_user_editable($actor, $row);
    $body = ll_read_json_body();
    $fields = [];
    $params = [];

    if (array_key_exists('display_name', $body)) {
      $fields[] = 'display_name = ?';
      $params[] = trim((string) $body['display_name']);
    }
    if (array_key_exists('telecaller_name', $body)) {
      $fields[] = 'telecaller_name = ?';
      $val = trim((string) $body['telecaller_name']);
      $params[] = $val !== '' ? $val : null;
    }
    if (array_key_exists('notes', $body)) {
      $fields[] = 'notes = ?';
      $val = trim((string) $body['notes']);
      $params[] = $val !== '' ? $val : null;
    }
    if (array_key_exists('is_active', $body)) {
      if (($row['role_key'] ?? '') === 'super' && !(bool) $body['is_active']) {
        ll_error('Super User cannot be deactivated');
      }
      $fields[] = 'is_active = ?';
      $params[] = (bool) $body['is_active'] ? 1 : 0;
    }
    if (array_key_exists('role_id', $body)) {
      $roleId = (int) $body['role_id'];
      if ((int) $id === (int) $actor['id']) {
        ll_error('Cannot change your own role', 403);
      }
      if (($row['role_key'] ?? '') === 'super' && $roleId !== (int) $row['role_id']) {
        ll_error('Cannot change Super User role', 403);
      }
      ll_assert_role_assignable($actor, $roleId);
      $fields[] = 'role_id = ?';
      $params[] = $roleId;
    }
    if (!empty($body['password'])) {
      $password = (string) $body['password'];
      if (strlen($password) < 5) {
        ll_error('Password must be at least 5 characters');
      }
      $fields[] = 'password_hash = ?';
      $params[] = password_hash($password, PASSWORD_BCRYPT);
      $fields[] = 'must_change_password = ?';
      $params[] = !empty($body['must_change_password']) ? 1 : 0;
    }
    if (array_key_exists('must_change_password', $body) && empty($body['password'])) {
      $fields[] = 'must_change_password = ?';
      $params[] = (bool) $body['must_change_password'] ? 1 : 0;
    }
    if (array_key_exists('username', $body)) {
      $username = trim((string) $body['username']);
      if ($username === '') {
        ll_error('Username cannot be empty');
      }
      $other = ll_find_user_by_username($username);
      if ($other && (int) $other['id'] !== $id) {
        ll_error('Username already exists');
      }
      if (($row['role_key'] ?? '') === 'super') {
        // allow rename of display but keep username flexible for super too unless empty
      }
      $fields[] = 'username = ?';
      $params[] = $username;
    }

    if (!$fields) {
      ll_error('No fields to update');
    }
    $fields[] = 'updated_at = UTC_TIMESTAMP()';
    $params[] = $id;
    $pdo->prepare('UPDATE users SET ' . implode(', ', $fields) . ' WHERE id = ?')->execute($params);
    ll_ok(['user' => ll_public_user(ll_find_user_by_id($id))]);
  }

  if ($method === 'DELETE' && $id !== null) {
    $row = ll_find_user_by_id($id);
    if (!$row) {
      ll_error('User not found', 404);
    }
    if (($row['role_key'] ?? '') === 'super') {
      ll_error('Super User is undeletable', 403);
    }
    if ((int) $row['id'] === (int) $actor['id']) {
      ll_error('Cannot delete your own account');
    }
    ll_assert_user_editable($actor, $row);
    $pdo->prepare('DELETE FROM users WHERE id = ?')->execute([$id]);
    ll_ok(['deleted' => true]);
  }

  ll_error('Method not allowed', 405);
}

/** Target user must be strictly below actor rank; Super accounts are Super-only. */
function ll_assert_user_editable(array $actor, array $targetRow): void
{
  if (($targetRow['role_key'] ?? '') === 'super' && empty($actor['is_super'])) {
    ll_error('Only Super User can edit Super User accounts', 403);
  }
  if (!empty($actor['is_super'])) {
    return;
  }
  $targetRank = (int) ($targetRow['role_rank'] ?? 0);
  if ($targetRank >= ll_user_rank($actor)) {
    ll_error('Cannot edit a user at or above your rank', 403);
  }
}

/**
 * Assignable roles must be strictly below the actor's rank.
 * Non-super cannot assign Super. Super may assign any non-Super role.
 */
function ll_assert_role_assignable(array $actor, int $roleId): void
{
  $stmt = ll_pdo()->prepare('SELECT id, rank, role_key FROM roles WHERE id = ? LIMIT 1');
  $stmt->execute([$roleId]);
  $role = $stmt->fetch();
  if (!$role) {
    ll_error('Role not found');
  }
  if (($role['role_key'] ?? '') === 'super' || (int) ($role['rank'] ?? 0) >= 100) {
    ll_error('Cannot assign Super User role', 403);
  }
  if (!empty($actor['is_super'])) {
    return;
  }
  if ((int) $role['rank'] >= ll_user_rank($actor)) {
    ll_error('Cannot assign a role at or above your own rank', 403);
  }
}

/** Role create/update/delete: target rank must be strictly below actor (Super locked). */
function ll_assert_role_manageable(array $actor, array $roleRow, ?int $newRank = null): void
{
  if (($roleRow['role_key'] ?? '') === 'super') {
    ll_error('Super User role cannot be edited', 403);
  }
  if (!empty($actor['is_super'])) {
    return;
  }
  $currentRank = (int) ($roleRow['rank'] ?? 0);
  $rank = $newRank !== null ? $newRank : $currentRank;
  if ($currentRank >= ll_user_rank($actor) || $rank >= ll_user_rank($actor)) {
    ll_error('Cannot manage a role at or above your own rank', 403);
  }
}

function ll_admin_roles(?int $id): void
{
  // Permission-based: admin.roles is enough. Rank gates stay on create/update.
  $actor = ll_require_permission('admin.roles');
  $pdo = ll_pdo();
  $method = ll_method();

  if ($method === 'GET' && $id === null) {
    $rows = $pdo->query('SELECT * FROM roles ORDER BY rank DESC, name ASC')->fetchAll();
    ll_ok([
      'roles' => array_map('ll_format_role', $rows),
      'permission_catalog' => ll_permission_catalog(),
    ]);
  }

  if ($method === 'GET' && $id !== null) {
    $stmt = $pdo->prepare('SELECT * FROM roles WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if (!$row) {
      ll_error('Role not found', 404);
    }
    ll_ok(['role' => ll_format_role($row), 'permission_catalog' => ll_permission_catalog()]);
  }

  if ($method === 'POST' && $id === null) {
    $body = ll_read_json_body();
    $name = trim((string) ($body['name'] ?? ''));
    $rank = (int) ($body['rank'] ?? 10);
    $perms = ll_normalize_permissions($body['permissions'] ?? []);
    if ($name === '') {
      ll_error('Role name is required');
    }
    if ($rank >= 100 || strtolower(preg_replace('/[^a-z0-9_]+/', '_', $name) ?: '') === 'super') {
      ll_error('Cannot create another Super User rank', 403);
    }
    if (empty($actor['is_super']) && $rank >= ll_user_rank($actor)) {
      ll_error('Cannot create a role at or above your own rank', 403);
    }
    $key = preg_replace('/[^a-z0-9_]+/', '_', strtolower($name)) ?: ('role_' . time());
    try {
      $pdo->prepare(
        'INSERT INTO roles (name, role_key, rank, permissions, is_system) VALUES (?, ?, ?, ?, 0)'
      )->execute([$name, $key, $rank, json_encode($perms, JSON_UNESCAPED_UNICODE)]);
    } catch (Throwable $e) {
      ll_error('Could not create role (name may already exist)');
    }
    $newId = (int) $pdo->lastInsertId();
    $stmt = $pdo->prepare('SELECT * FROM roles WHERE id = ?');
    $stmt->execute([$newId]);
    ll_ok(['role' => ll_format_role($stmt->fetch())], 201);
  }

  if (($method === 'PUT' || $method === 'PATCH') && $id !== null) {
    $stmt = $pdo->prepare('SELECT * FROM roles WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if (!$row) {
      ll_error('Role not found', 404);
    }
    $body = ll_read_json_body();
    $name = array_key_exists('name', $body) ? trim((string) $body['name']) : $row['name'];
    $rank = array_key_exists('rank', $body) ? (int) $body['rank'] : (int) $row['rank'];
    $perms = array_key_exists('permissions', $body)
      ? ll_normalize_permissions($body['permissions'])
      : ll_normalize_permissions($row['permissions']);

    if ($name === '') {
      ll_error('Role name is required');
    }
    if ($rank >= 100 || strtolower(preg_replace('/[^a-z0-9_]+/', '_', $name) ?: '') === 'super') {
      ll_error('Cannot elevate role to Super User', 403);
    }
    ll_assert_role_manageable($actor, $row, $rank);

    $pdo->prepare(
      'UPDATE roles SET name = ?, rank = ?, permissions = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?'
    )->execute([$name, $rank, json_encode($perms, JSON_UNESCAPED_UNICODE), $id]);
    $stmt->execute([$id]);
    ll_ok(['role' => ll_format_role($stmt->fetch())]);
  }

  if ($method === 'DELETE' && $id !== null) {
    $stmt = $pdo->prepare('SELECT * FROM roles WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if (!$row) {
      ll_error('Role not found', 404);
    }
    if ((int) $row['is_system'] === 1 || ($row['role_key'] ?? '') === 'super') {
      ll_error('System roles cannot be deleted', 403);
    }
    ll_assert_role_manageable($actor, $row);
    $cstmt = $pdo->prepare('SELECT COUNT(*) FROM users WHERE role_id = ?');
    $cstmt->execute([$id]);
    if ((int) $cstmt->fetchColumn() > 0) {
      ll_error('Role is assigned to users; reassign them first');
    }
    $pdo->prepare('DELETE FROM roles WHERE id = ?')->execute([$id]);
    ll_ok(['deleted' => true]);
  }

  ll_error('Method not allowed', 405);
}

function ll_format_role(array $row): array
{
  return [
    'id' => (int) $row['id'],
    'name' => $row['name'],
    'role_key' => $row['role_key'],
    'rank' => (int) $row['rank'],
    'permissions' => ll_normalize_permissions($row['permissions']),
    'is_system' => (int) ($row['is_system'] ?? 0) === 1,
    'created_at' => $row['created_at'] ?? null,
    'updated_at' => $row['updated_at'] ?? null,
  ];
}

function ll_admin_access_requests(?int $id, string $verb): void
{
  $actor = ll_require_permission('admin.access_requests');
  $pdo = ll_pdo();
  $method = ll_method();

  if ($method === 'GET' && ($id === null || $verb === 'list' || $verb === '')) {
    $status = $_GET['status'] ?? 'pending';
    if ($status === 'all') {
      $rows = $pdo->query('SELECT * FROM access_requests ORDER BY created_at DESC')->fetchAll();
    } else {
      $stmt = $pdo->prepare('SELECT * FROM access_requests WHERE status = ? ORDER BY created_at DESC');
      $stmt->execute([$status]);
      $rows = $stmt->fetchAll();
    }
    ll_ok(['requests' => $rows]);
  }

  if ($method === 'POST' && $id !== null && ($verb === 'approve' || $verb === 'deny')) {
    $stmt = $pdo->prepare('SELECT * FROM access_requests WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $req = $stmt->fetch();
    if (!$req) {
      ll_error('Request not found', 404);
    }
    if ($req['status'] !== 'pending') {
      ll_error('Request already reviewed');
    }
    $body = ll_read_json_body();

    if ($verb === 'deny') {
      $note = trim((string) ($body['review_note'] ?? ''));
      $pdo->prepare(
        'UPDATE access_requests SET status = \'denied\', reviewer_id = ?, review_note = ?, reviewed_at = UTC_TIMESTAMP() WHERE id = ?'
      )->execute([(int) $actor['id'], $note !== '' ? $note : null, $id]);
      ll_clear_access_request_notifications($id);
      ll_ok(['request' => ll_fetch_access_request($id)]);
    }

    // approve → create user
    $username = trim((string) ($body['username'] ?? $req['requested_username'] ?? ''));
    $password = (string) ($body['password'] ?? '');
    $display = trim((string) ($body['display_name'] ?? $req['full_name'] ?? ''));
    $roleId = (int) ($body['role_id'] ?? 0);
    $telecaller = trim((string) ($body['telecaller_name'] ?? ''));
    if ($username === '' || $password === '' || $roleId < 1) {
      ll_error('username, password, and role_id are required to approve');
    }
    ll_assert_role_assignable($actor, $roleId);
    if (ll_find_user_by_username($username)) {
      ll_error('Username already exists');
    }
    $hash = password_hash($password, PASSWORD_BCRYPT);
    $pdo->prepare(
      'INSERT INTO users (username, password_hash, display_name, role_id, telecaller_name, is_active, must_change_password)
       VALUES (?, ?, ?, ?, ?, 1, 1)'
    )->execute([
      $username,
      $hash,
      $display !== '' ? $display : $username,
      $roleId,
      $telecaller !== '' ? $telecaller : null,
    ]);
    $newUserId = (int) $pdo->lastInsertId();
    $note = trim((string) ($body['review_note'] ?? ''));
    $pdo->prepare(
      'UPDATE access_requests SET status = \'approved\', reviewer_id = ?, assigned_role_id = ?, created_user_id = ?,
       review_note = ?, reviewed_at = UTC_TIMESTAMP() WHERE id = ?'
    )->execute([(int) $actor['id'], $roleId, $newUserId, $note !== '' ? $note : null, $id]);
    ll_clear_access_request_notifications($id);
    ll_ok([
      'request' => ll_fetch_access_request($id),
      'user' => ll_public_user(ll_find_user_by_id($newUserId)),
    ]);
  }

  ll_error('Not found', 404);
}

/** Remove access-request notifications for every admin when a request is resolved. */
function ll_clear_access_request_notifications(int $requestId): void
{
  $pdo = ll_pdo();
  // Match by JSON meta.access_request_id (MySQL JSON_EXTRACT) and fallback LIKE.
  $pdo->prepare(
    "DELETE FROM notifications
     WHERE type = 'access_request'
       AND (
         JSON_UNQUOTE(JSON_EXTRACT(meta, '$.access_request_id')) = ?
         OR meta LIKE ?
       )"
  )->execute([(string) $requestId, '%"access_request_id":' . $requestId . '%']);
}

function ll_fetch_access_request(int $id): ?array
{
  $stmt = ll_pdo()->prepare('SELECT * FROM access_requests WHERE id = ? LIMIT 1');
  $stmt->execute([$id]);
  $row = $stmt->fetch();
  return $row ?: null;
}

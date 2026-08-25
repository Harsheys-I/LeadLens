<?php

declare(strict_types=1);

function ll_cookie_name(): string
{
  return (string) ($GLOBALS['LL_CONFIG']['session']['cookie_name'] ?? 'leadlens_session');
}

function ll_session_ttl(): int
{
  return (int) ($GLOBALS['LL_CONFIG']['session']['ttl_seconds'] ?? 1209600);
}

function ll_public_user(?array $row): ?array
{
  if (!$row) {
    return null;
  }
  $permissions = ll_normalize_permissions($row['permissions'] ?? []);
  return [
    'id' => (int) $row['id'],
    'username' => (string) $row['username'],
    'display_name' => (string) ($row['display_name'] ?? ''),
    'role_id' => (int) $row['role_id'],
    'role_name' => (string) ($row['role_name'] ?? ''),
    'role_key' => (string) ($row['role_key'] ?? ''),
    'role_rank' => (int) ($row['role_rank'] ?? 0),
    'telecaller_name' => $row['telecaller_name'] !== null && $row['telecaller_name'] !== ''
      ? (string) $row['telecaller_name']
      : null,
    'is_active' => (int) ($row['is_active'] ?? 0) === 1,
    'must_change_password' => (int) ($row['must_change_password'] ?? 0) === 1,
    'permissions' => $permissions,
    'is_super' => (($row['role_key'] ?? '') === 'super') || ((int) ($row['role_rank'] ?? 0) >= 100),
  ];
}

function ll_find_user_by_id(int $id): ?array
{
  $stmt = ll_pdo()->prepare(
    'SELECT u.*, r.name AS role_name, r.role_key, r.rank AS role_rank, r.permissions
     FROM users u
     INNER JOIN roles r ON r.id = u.role_id
     WHERE u.id = ? LIMIT 1'
  );
  $stmt->execute([$id]);
  $row = $stmt->fetch();
  return $row ?: null;
}

function ll_find_user_by_username(string $username): ?array
{
  $stmt = ll_pdo()->prepare(
    'SELECT u.*, r.name AS role_name, r.role_key, r.rank AS role_rank, r.permissions
     FROM users u
     INNER JOIN roles r ON r.id = u.role_id
     WHERE LOWER(u.username) = LOWER(?) LIMIT 1'
  );
  $stmt->execute([trim($username)]);
  $row = $stmt->fetch();
  return $row ?: null;
}

function ll_set_session_cookie(string $token, int $expiresAt): void
{
  $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
  setcookie(ll_cookie_name(), $token, [
    'expires' => $expiresAt,
    'path' => '/',
    'secure' => $secure,
    'httponly' => true,
    'samesite' => 'Lax',
  ]);
}

function ll_clear_session_cookie(): void
{
  $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
  setcookie(ll_cookie_name(), '', [
    'expires' => time() - 3600,
    'path' => '/',
    'secure' => $secure,
    'httponly' => true,
    'samesite' => 'Lax',
  ]);
}

function ll_create_session(int $userId): string
{
  $token = bin2hex(random_bytes(32));
  $ttl = ll_session_ttl();
  $expiresAt = time() + $ttl;
  $expiresIso = gmdate('Y-m-d H:i:s', $expiresAt);

  $stmt = ll_pdo()->prepare(
    'INSERT INTO sessions (user_id, token_hash, expires_at, created_at, last_seen_at)
     VALUES (?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())'
  );
  $stmt->execute([$userId, hash('sha256', $token), $expiresIso]);
  ll_set_session_cookie($token, $expiresAt);
  return $token;
}

function ll_destroy_session(?string $token = null): void
{
  $token = $token ?? ($_COOKIE[ll_cookie_name()] ?? '');
  if ($token !== '') {
    $stmt = ll_pdo()->prepare('DELETE FROM sessions WHERE token_hash = ?');
    $stmt->execute([hash('sha256', $token)]);
  }
  ll_clear_session_cookie();
}

function ll_current_user(): ?array
{
  static $cached = false;
  static $user = null;
  if ($cached) {
    return $user;
  }
  $cached = true;

  $token = $_COOKIE[ll_cookie_name()] ?? '';
  if ($token === '') {
    return null;
  }

  $stmt = ll_pdo()->prepare(
    'SELECT s.id AS session_id, s.expires_at,
            u.id, u.username, u.password_hash, u.display_name, u.role_id, u.telecaller_name,
            u.is_active, u.must_change_password, u.created_at, u.updated_at,
            r.name AS role_name, r.role_key, r.rank AS role_rank, r.permissions
     FROM sessions s
     INNER JOIN users u ON u.id = s.user_id
     INNER JOIN roles r ON r.id = u.role_id
     WHERE s.token_hash = ?
     LIMIT 1'
  );
  $stmt->execute([hash('sha256', $token)]);
  $row = $stmt->fetch();
  if (!$row) {
    ll_clear_session_cookie();
    return null;
  }

  $expires = strtotime($row['expires_at'] . ' UTC');
  if ($expires !== false && $expires < time()) {
    ll_destroy_session($token);
    return null;
  }

  if ((int) $row['is_active'] !== 1) {
    ll_destroy_session($token);
    return null;
  }

  ll_pdo()->prepare('UPDATE sessions SET last_seen_at = UTC_TIMESTAMP() WHERE id = ?')
    ->execute([(int) $row['session_id']]);

  $user = ll_public_user($row);
  return $user;
}

function ll_require_user(): array
{
  $user = ll_current_user();
  if (!$user) {
    ll_error('Authentication required', 401);
  }
  return $user;
}

function ll_require_permission(string $permission): array
{
  $user = ll_require_user();
  if (!ll_user_has_permission($user, $permission)) {
    ll_error('Forbidden', 403);
  }
  return $user;
}

function ll_require_admin_rank(): array
{
  $user = ll_require_user();
  if (!ll_is_admin_rank($user)) {
    ll_error('Admin access required', 403);
  }
  return $user;
}

<?php

declare(strict_types=1);

function ll_cookie_name(): string
{
  if (function_exists('ll_is_dev_request') && ll_is_dev_request()) {
    return 'leadlens_session_dev';
  }
  return (string) ($GLOBALS['LL_CONFIG']['session']['cookie_name'] ?? 'leadlens_session');
}

function ll_cookie_path(): string
{
  if (function_exists('ll_is_dev_request') && ll_is_dev_request()) {
    return '/dev/';
  }
  return '/';
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
  $userId = (int) $row['id'];
  return [
    'id' => $userId,
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

function ll_request_is_https(): bool
{
  if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') {
    return true;
  }
  $fwd = strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''));
  if ($fwd === 'https') {
    return true;
  }
  return (string) ($_SERVER['SERVER_PORT'] ?? '') === '443';
}

function ll_min_password_length(): int
{
  return 8;
}

function ll_set_session_cookie(string $token, int $expiresAt): void
{
  $secure = ll_request_is_https();
  setcookie(ll_cookie_name(), $token, [
    'expires' => $expiresAt,
    'path' => ll_cookie_path(),
    'secure' => $secure,
    'httponly' => true,
    'samesite' => 'Lax',
  ]);
}

function ll_clear_session_cookie(): void
{
  $secure = ll_request_is_https();
  setcookie(ll_cookie_name(), '', [
    'expires' => time() - 3600,
    'path' => ll_cookie_path(),
    'secure' => $secure,
    'httponly' => true,
    'samesite' => 'Lax',
  ]);
}

/** Revoke sessions for a user. Keep the current cookie token when provided. */
function ll_destroy_user_sessions(int $userId, ?string $keepToken = null): void
{
  if ($userId < 1) {
    return;
  }
  if ($keepToken !== null && $keepToken !== '') {
    ll_pdo()->prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?')
      ->execute([$userId, hash('sha256', $keepToken)]);
    return;
  }
  ll_pdo()->prepare('DELETE FROM sessions WHERE user_id = ?')->execute([$userId]);
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

/**
 * Credentials replayed by unattended clients (erp_upload.py), not by the browser.
 * HTTP Basic, PHP_AUTH_*, multipart/query username+password, or X-LeadLens-Script-Auth
 * (base64 user:pass). Some hosts drop Authorization; the script header is the fallback.
 *
 * @return array{0: string, 1: string}|null
 */
function ll_script_credential_pair(): ?array
{
  $user = '';
  $pass = '';
  if (isset($_SERVER['PHP_AUTH_USER'])) {
    $user = trim((string) $_SERVER['PHP_AUTH_USER']);
    $pass = (string) ($_SERVER['PHP_AUTH_PW'] ?? '');
  }
  if ($user === '' || $pass === '') {
    $header = (string) ($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
    if (stripos($header, 'Basic ') === 0) {
      $decoded = base64_decode(substr($header, 6), true);
      if (is_string($decoded) && str_contains($decoded, ':')) {
        [$basicUser, $basicPass] = explode(':', $decoded, 2);
        $user = trim($basicUser);
        $pass = $basicPass;
      }
    }
  }
  if ($user === '' || $pass === '') {
    $script = (string) ($_SERVER['HTTP_X_LEADLENS_SCRIPT_AUTH'] ?? '');
    if ($script !== '') {
      $decoded = base64_decode($script, true);
      if (is_string($decoded) && str_contains($decoded, ':')) {
        [$scriptUser, $scriptPass] = explode(':', $decoded, 2);
        $user = trim($scriptUser);
        $pass = $scriptPass;
      }
    }
  }
  if ($user === '' || $pass === '') {
    $user = trim((string) ($_POST['username'] ?? $_GET['username'] ?? ''));
    $pass = (string) ($_POST['password'] ?? $_GET['password'] ?? '');
  }
  if ($user === '' || $pass === '') {
    return null;
  }
  return [$user, $pass];
}

/**
 * True when this request re-proves the session user's password the way erp_upload.py does.
 * Browser cookie sessions do not send those credentials, so must_change_password still applies.
 */
function ll_request_is_verified_script_login(array $sessionUser): bool
{
  $pair = ll_script_credential_pair();
  if ($pair === null) {
    return false;
  }
  [$username, $password] = $pair;
  $row = ll_find_user_by_username($username);
  if (!$row || (int) $row['is_active'] !== 1) {
    return false;
  }
  if ((int) $row['id'] !== (int) $sessionUser['id']) {
    return false;
  }
  return password_verify($password, (string) $row['password_hash']);
}

function ll_require_user(bool $allowPasswordChangePending = false): array
{
  $user = ll_current_user();
  if (!$user) {
    ll_error('Authentication required', 401);
  }
  // Midnight ERP sync logs in with the account password and keeps sending it (Basic /
  // X-LeadLens-Script-Auth). Ignore must_change_password for that non-browser proof so
  // settings/audit, stage, the OpenAI proxy, and publish are not blocked. Cookie-only
  // browser sessions still get the password-change wall. Do not clear the user flag.
  if (
    !$allowPasswordChangePending
    && !empty($user['must_change_password'])
    && !ll_request_is_verified_script_login($user)
  ) {
    ll_error('Password change required', 403, ['password_change_required' => true]);
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
  // Legacy helper — prefer permission checks. Kept for compatibility.
  $user = ll_require_user();
  if (
    !ll_user_has_permission($user, 'admin.users')
    && !ll_user_has_permission($user, 'admin.roles')
    && !ll_user_has_permission($user, 'admin.access_requests')
    && empty($user['is_super'])
  ) {
    ll_error('Admin access required', 403);
  }
  return $user;
}

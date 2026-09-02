<?php

declare(strict_types=1);

/**
 * One-time schema + seed. Visit /api/install.php once after configuring config.local.php.
 * Protect or remove after setup (or set app.install_locked = true).
 */

header('Content-Type: text/html; charset=utf-8');

$configLocal = __DIR__ . '/config.local.php';
if (!is_file($configLocal)) {
  http_response_code(503);
  echo '<h1>GPP AI install</h1><p>Copy <code>api/config.example.php</code> → <code>api/config.local.php</code> with MySQL credentials first.</p>';
  exit;
}

$GLOBALS['LL_CONFIG'] = require $configLocal;
require_once __DIR__ . '/lib/response.php';
require_once __DIR__ . '/lib/permissions.php';
require_once __DIR__ . '/lib/db.php';

if (!empty($GLOBALS['LL_CONFIG']['app']['install_locked'])) {
  http_response_code(403);
  echo '<h1>Install locked</h1><p>Set <code>app.install_locked</code> to false in config.local.php to re-run.</p>';
  exit;
}

function ll_install_run(): void
{
  $pdo = ll_pdo();

  $pdo->exec("CREATE TABLE IF NOT EXISTS roles (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(80) NOT NULL,
    role_key VARCHAR(40) NOT NULL,
    rank INT NOT NULL DEFAULT 0,
    permissions JSON NOT NULL,
    is_system TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_roles_key (role_key),
    UNIQUE KEY uq_roles_name (name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

  $pdo->exec("CREATE TABLE IF NOT EXISTS users (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(80) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(120) NOT NULL DEFAULT '',
    role_id INT UNSIGNED NOT NULL,
    telecaller_name VARCHAR(120) NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    must_change_password TINYINT(1) NOT NULL DEFAULT 0,
    notes TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_users_username (username),
    KEY idx_users_role (role_id),
    KEY idx_users_telecaller (telecaller_name),
    CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

  $pdo->exec("CREATE TABLE IF NOT EXISTS sessions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL,
    token_hash CHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL,
    last_seen_at DATETIME NOT NULL,
    UNIQUE KEY uq_sessions_token (token_hash),
    KEY idx_sessions_user (user_id),
    KEY idx_sessions_expires (expires_at),
    CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

  $pdo->exec("CREATE TABLE IF NOT EXISTS access_requests (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(120) NOT NULL,
    email VARCHAR(160) NOT NULL DEFAULT '',
    requested_username VARCHAR(80) NOT NULL DEFAULT '',
    reason TEXT NULL,
    preferred_module VARCHAR(80) NOT NULL DEFAULT '',
    status ENUM('pending','approved','denied') NOT NULL DEFAULT 'pending',
    reviewer_id INT UNSIGNED NULL,
    assigned_role_id INT UNSIGNED NULL,
    created_user_id INT UNSIGNED NULL,
    review_note TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at DATETIME NULL,
    KEY idx_access_status (status),
    CONSTRAINT fk_access_reviewer FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_access_role FOREIGN KEY (assigned_role_id) REFERENCES roles(id) ON DELETE SET NULL,
    CONSTRAINT fk_access_user FOREIGN KEY (created_user_id) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

  $pdo->exec("CREATE TABLE IF NOT EXISTS notifications (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL,
    type VARCHAR(60) NOT NULL,
    title VARCHAR(200) NOT NULL,
    body TEXT NULL,
    meta JSON NULL,
    is_read TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_notif_user_read (user_id, is_read),
    CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

  $pdo->exec("CREATE TABLE IF NOT EXISTS published_dashboards (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    telecaller_name VARCHAR(120) NOT NULL,
    title VARCHAR(200) NOT NULL DEFAULT '',
    payload LONGTEXT NOT NULL,
    meta JSON NULL,
    uploaded_by INT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_pub_telecaller (telecaller_name),
    KEY idx_pub_uploaded (uploaded_by),
    CONSTRAINT fk_pub_user FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

  $pdo->exec("CREATE TABLE IF NOT EXISTS app_settings (
    setting_key VARCHAR(80) NOT NULL PRIMARY KEY,
    setting_value LONGTEXT NULL,
    updated_by INT UNSIGNED NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_app_settings_updated (updated_by),
    CONSTRAINT fk_app_settings_user FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

  $pdo->exec("CREATE TABLE IF NOT EXISTS audit_jobs (
    job_id CHAR(36) NOT NULL PRIMARY KEY,
    owner_user_id INT UNSIGNED NULL,
    owner_name VARCHAR(120) NOT NULL DEFAULT '',
    file_name VARCHAR(255) NOT NULL DEFAULT '',
    status VARCHAR(40) NOT NULL DEFAULT '',
    mode VARCHAR(60) NOT NULL DEFAULT '',
    payload LONGTEXT NOT NULL,
    client_updated_at VARCHAR(40) NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_audit_jobs_client_updated (client_updated_at),
    KEY idx_audit_jobs_owner (owner_user_id),
    CONSTRAINT fk_audit_jobs_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

  $pdo->exec("CREATE TABLE IF NOT EXISTS perf_published_dashboards (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    telecaller_name VARCHAR(120) NOT NULL,
    title VARCHAR(200) NOT NULL DEFAULT '',
    payload LONGTEXT NOT NULL,
    meta JSON NULL,
    uploaded_by INT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_perf_pub_telecaller (telecaller_name),
    KEY idx_perf_pub_uploaded (uploaded_by),
    CONSTRAINT fk_perf_pub_user FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

  $roles = [
    ['Super User', 'super', 100, ll_default_role_permissions('super'), 1],
    ['Admin', 'admin', 50, ll_default_role_permissions('admin'), 1],
    ['TeleCaller', 'telecaller', 10, ll_default_role_permissions('telecaller'), 1],
  ];

  $upsertRole = $pdo->prepare(
    'INSERT INTO roles (name, role_key, rank, permissions, is_system)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), rank = VALUES(rank), permissions = VALUES(permissions), is_system = VALUES(is_system)'
  );
  foreach ($roles as $role) {
    $upsertRole->execute([
      $role[0],
      $role[1],
      $role[2],
      json_encode($role[3], JSON_UNESCAPED_UNICODE),
      $role[4],
    ]);
  }

  $superId = (int) $pdo->query("SELECT id FROM roles WHERE role_key = 'super' LIMIT 1")->fetchColumn();
  if ($superId < 1) {
    throw new RuntimeException('Failed to seed Super User role');
  }

  $existing = $pdo->prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1');
  $existing->execute(['super user']);
  $userId = $existing->fetchColumn();

  $hash = password_hash('12345', PASSWORD_BCRYPT);
  if ($userId) {
    $pdo->prepare(
      'UPDATE users SET password_hash = ?, display_name = ?, role_id = ?, is_active = 1, must_change_password = 1 WHERE id = ?'
    )->execute([$hash, 'Super User', $superId, (int) $userId]);
  } else {
    $pdo->prepare(
      'INSERT INTO users (username, password_hash, display_name, role_id, telecaller_name, is_active, must_change_password)
       VALUES (?, ?, ?, ?, NULL, 1, 1)'
    )->execute(['super user', $hash, 'Super User', $superId]);
  }
}

try {
  ll_install_run();
  echo '<h1>GPP AI install OK</h1>';
  echo '<p>Tables created/verified. Seed Super User: <code>super user</code> / <code>12345</code> (change password on first login).</p>';
  echo '<p>Recommended: set <code>app.install_locked</code> to <code>true</code> in <code>config.local.php</code>, or delete/rename this file.</p>';
  echo '<p><a href="../">Go to login</a></p>';
} catch (Throwable $e) {
  http_response_code(500);
  echo '<h1>Install failed</h1><pre>' . htmlspecialchars($e->getMessage(), ENT_QUOTES, 'UTF-8') . '</pre>';
}

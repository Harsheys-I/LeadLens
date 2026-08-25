<?php

declare(strict_types=1);

require_once __DIR__ . '/crypto.php';

function ll_ensure_app_settings_table(): void
{
  static $done = false;
  if ($done) {
    return;
  }
  $done = true;
  ll_pdo()->exec(
    "CREATE TABLE IF NOT EXISTS app_settings (
      setting_key VARCHAR(80) NOT NULL PRIMARY KEY,
      setting_value LONGTEXT NULL,
      updated_by INT UNSIGNED NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_app_settings_updated (updated_by),
      CONSTRAINT fk_app_settings_user FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
  );
}

function ll_setting_get(string $key): ?array
{
  ll_ensure_app_settings_table();
  $stmt = ll_pdo()->prepare(
    'SELECT setting_key, setting_value, updated_by, updated_at FROM app_settings WHERE setting_key = ? LIMIT 1'
  );
  $stmt->execute([$key]);
  $row = $stmt->fetch();
  return $row ?: null;
}

function ll_setting_set(string $key, ?string $value, ?int $userId): void
{
  ll_ensure_app_settings_table();
  ll_pdo()->prepare(
    'INSERT INTO app_settings (setting_key, setting_value, updated_by, updated_at)
     VALUES (?, ?, ?, UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by), updated_at = UTC_TIMESTAMP()'
  )->execute([$key, $value, $userId]);
}

function ll_setting_delete(string $key): void
{
  ll_ensure_app_settings_table();
  ll_pdo()->prepare('DELETE FROM app_settings WHERE setting_key = ?')->execute([$key]);
}

function ll_openai_key_configured(): bool
{
  $row = ll_setting_get('openai_api_key_encrypted');
  return $row && trim((string) ($row['setting_value'] ?? '')) !== '';
}

function ll_openai_key_plaintext(): ?string
{
  $row = ll_setting_get('openai_api_key_encrypted');
  if (!$row || trim((string) ($row['setting_value'] ?? '')) === '') {
    return null;
  }
  return ll_decrypt_secret((string) $row['setting_value']);
}

function ll_can_manage_server_settings(array $user): bool
{
  return !empty($user['is_super']);
}

function ll_can_use_openai_proxy(array $user): bool
{
  return ll_user_has_permission($user, 'telecaller.bucket1')
    || ll_user_has_permission($user, 'telecaller.settings')
    || !empty($user['is_super']);
}

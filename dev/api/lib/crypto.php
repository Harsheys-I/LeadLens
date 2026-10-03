<?php

declare(strict_types=1);

/** AES-256-GCM helpers for secrets stored in app_settings. */

function ll_secrets_key_is_placeholder(string $raw): bool
{
  $raw = trim($raw);
  if ($raw === '') {
    return true;
  }
  $known = [
    'change-me-to-a-long-random-string',
    'change-me-to-another-long-random-string',
  ];
  return in_array($raw, $known, true);
}

function ll_secrets_key(): string
{
  $cfg = $GLOBALS['LL_CONFIG'] ?? [];
  $raw = trim((string) ($cfg['app']['secrets_key'] ?? ''));
  if (ll_secrets_key_is_placeholder($raw)) {
    $raw = trim((string) ($cfg['session']['secret'] ?? ''));
  }
  if (ll_secrets_key_is_placeholder($raw)) {
    ll_error(
      'Secrets key is not configured. Set app.secrets_key (or session.secret) in api/config.local.php to a long random string that is not the example placeholder.',
      503
    );
  }
  return hash('sha256', $raw, true);
}

function ll_encrypt_secret(string $plaintext): string
{
  $key = ll_secrets_key();
  $iv = random_bytes(12);
  $tag = '';
  $cipher = openssl_encrypt($plaintext, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag, '', 16);
  if ($cipher === false) {
    ll_error('Failed to encrypt secret', 500);
  }
  return base64_encode($iv . $tag . $cipher);
}

function ll_decrypt_secret(string $encoded): ?string
{
  $raw = base64_decode($encoded, true);
  if ($raw === false || strlen($raw) < 28) {
    return null;
  }
  $iv = substr($raw, 0, 12);
  $tag = substr($raw, 12, 16);
  $cipher = substr($raw, 28);
  $plain = openssl_decrypt($cipher, 'aes-256-gcm', ll_secrets_key(), OPENSSL_RAW_DATA, $iv, $tag);
  return $plain === false ? null : $plain;
}

function ll_mask_api_key(string $key): string
{
  $key = trim($key);
  $len = strlen($key);
  if ($len <= 8) {
    return str_repeat('•', max(4, $len));
  }
  return substr($key, 0, 3) . '…' . substr($key, -4);
}

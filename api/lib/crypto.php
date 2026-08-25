<?php

declare(strict_types=1);

/** AES-256-GCM helpers for secrets stored in app_settings. */

function ll_secrets_key(): string
{
  $cfg = $GLOBALS['LL_CONFIG'] ?? [];
  $raw = (string) ($cfg['app']['secrets_key'] ?? '');
  if ($raw === '') {
    $raw = (string) ($cfg['session']['secret'] ?? '');
  }
  if ($raw === '' || $raw === 'change-me-to-a-long-random-string') {
    // Deterministic fallback so installs still work; operators should set secrets_key.
    $raw = 'leadlens-dev-secrets-key-' . ($cfg['db']['name'] ?? 'local');
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

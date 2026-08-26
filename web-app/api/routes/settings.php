<?php

declare(strict_types=1);

require_once __DIR__ . '/../lib/settings.php';

function ll_route_settings(string $action): void
{
  switch ($action) {
    case 'audit':
      ll_settings_audit();
      break;
    case 'openai-key':
      ll_settings_openai_key();
      break;
    case 'openai-key-status':
      ll_settings_openai_key_status();
      break;
    default:
      ll_error('Not found', 404);
  }
}

function ll_settings_audit(): void
{
  $user = ll_require_user();
  $method = ll_method();

  if ($method === 'GET') {
    if (
      !ll_user_has_permission($user, 'module.telecaller_audit')
      && !ll_user_has_permission($user, 'telecaller.bucket1')
      && !ll_user_has_permission($user, 'telecaller.settings')
      && empty($user['is_super'])
    ) {
      ll_error('Forbidden', 403);
    }
    $row = ll_setting_get('audit_settings');
    $settings = null;
    if ($row && $row['setting_value']) {
      $decoded = json_decode((string) $row['setting_value'], true);
      $settings = is_array($decoded) ? $decoded : null;
    }
    // Never include API key in settings blob
    if (is_array($settings)) {
      unset($settings['apiKey'], $settings['openaiKey'], $settings['openai_api_key']);
    }
    ll_ok([
      'settings' => $settings,
      'updated_at' => $row['updated_at'] ?? null,
      'can_write' => ll_can_manage_server_settings($user),
    ]);
  }

  if ($method === 'PUT' || $method === 'POST') {
    if (!ll_can_manage_server_settings($user)) {
      ll_error('Only Super User can save server-wide settings', 403);
    }
    $body = ll_read_json_body();
    $settings = $body['settings'] ?? $body;
    if (!is_array($settings)) {
      ll_error('settings object required');
    }
    unset($settings['apiKey'], $settings['openaiKey'], $settings['openai_api_key']);
    $json = json_encode($settings, JSON_UNESCAPED_UNICODE);
    if ($json === false) {
      ll_error('Could not encode settings');
    }
    ll_setting_set('audit_settings', $json, (int) $user['id']);
    ll_ok(['settings' => $settings, 'message' => 'Saved for everyone']);
  }

  ll_error('Method not allowed', 405);
}

function ll_settings_openai_key_status(): void
{
  $user = ll_require_user();
  if (!ll_can_use_openai_proxy($user)) {
    ll_error('Forbidden', 403);
  }
  $configured = ll_openai_key_configured();
  $out = ['configured' => $configured];
  if ($configured && !empty($user['is_super'])) {
    $plain = ll_openai_key_plaintext();
    $out['masked'] = $plain ? ll_mask_api_key($plain) : null;
  }
  ll_ok($out);
}

function ll_settings_openai_key(): void
{
  $user = ll_require_user();
  if (!ll_can_manage_server_settings($user)) {
    ll_error('Only Super User can manage the server OpenAI key', 403);
  }
  $method = ll_method();

  if ($method === 'GET') {
    $plain = ll_openai_key_plaintext();
    ll_ok([
      'configured' => $plain !== null && $plain !== '',
      'masked' => $plain ? ll_mask_api_key($plain) : null,
    ]);
  }

  if ($method === 'PUT' || $method === 'POST') {
    $body = ll_read_json_body();
    $key = trim((string) ($body['api_key'] ?? $body['key'] ?? ''));
    if ($key === '') {
      ll_error('api_key is required');
    }
    if (!preg_match('/^sk-[A-Za-z0-9_-]{20,}$/', $key)) {
      ll_error('That does not look like an OpenAI API key');
    }
    ll_setting_set('openai_api_key_encrypted', ll_encrypt_secret($key), (int) $user['id']);
    ll_ok(['configured' => true, 'masked' => ll_mask_api_key($key), 'message' => 'Server key saved (encrypted)']);
  }

  if ($method === 'DELETE') {
    ll_setting_delete('openai_api_key_encrypted');
    ll_ok(['configured' => false, 'message' => 'Server key cleared']);
  }

  ll_error('Method not allowed', 405);
}

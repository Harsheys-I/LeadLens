<?php

declare(strict_types=1);

require_once __DIR__ . '/../lib/settings.php';

/**
 * Server-side OpenAI proxy so Admins/TeleCallers never need the raw API key in the browser.
 * Paths: /api/openai/chat/completions  /api/openai/models
 *
 * Chat completions are constrained to the saved audit model and safe request shape.
 */
function ll_route_openai(string $action, array $parts): void
{
  $user = ll_require_user();
  if (!ll_can_use_openai_proxy($user)) {
    ll_error('Forbidden', 403);
  }

  $key = ll_openai_key_plaintext();
  if ($key === null || $key === '') {
    ll_error('Server OpenAI API key is not configured. Ask a Super User to save it in Settings.', 503);
  }

  $sub = $action;
  if ($action === 'chat' && ($parts[2] ?? '') === 'completions') {
    $sub = 'chat/completions';
  }

  if ($sub === 'chat/completions') {
    ll_require_method('POST');
    $body = file_get_contents('php://input');
    if ($body === false || trim($body) === '') {
      ll_error('Request body required');
    }
    $payload = json_decode($body, true);
    if (!is_array($payload)) {
      ll_error('Invalid JSON body');
    }
    $safe = ll_openai_sanitize_chat_payload($payload);
    ll_openai_proxy(
      'https://api.openai.com/v1/chat/completions',
      'POST',
      $key,
      json_encode($safe, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}'
    );
  }

  if ($sub === 'models') {
    ll_require_method('GET');
    // Super only — listing the full account catalog is not needed for audits.
    if (empty($user['is_super'])) {
      ll_error('Forbidden', 403);
    }
    ll_openai_proxy('https://api.openai.com/v1/models', 'GET', $key, null);
  }

  ll_error('Not found', 404);
}

/** @param array<string, mixed> $payload @return array<string, mixed> */
function ll_openai_sanitize_chat_payload(array $payload): array
{
  $allowedModel = ll_audit_settings_model();

  $messages = $payload['messages'] ?? null;
  if (!is_array($messages) || !$messages) {
    ll_error('messages array is required');
  }
  if (count($messages) > 40) {
    ll_error('Too many messages');
  }

  $maxTokens = isset($payload['max_tokens']) ? (int) $payload['max_tokens'] : 4096;
  if ($maxTokens < 1) {
    $maxTokens = 1;
  }
  if ($maxTokens > 8192) {
    $maxTokens = 8192;
  }

  $temperature = isset($payload['temperature']) ? (float) $payload['temperature'] : 0.2;
  if ($temperature < 0) {
    $temperature = 0.0;
  }
  if ($temperature > 2) {
    $temperature = 2.0;
  }

  // Reject high-cost / abuse-prone options.
  if (!empty($payload['stream'])) {
    ll_error('Streaming is not allowed through the proxy');
  }
  if (isset($payload['tools']) || isset($payload['functions']) || isset($payload['tool_choice'])) {
    ll_error('Tools are not allowed through the proxy');
  }
  if (isset($payload['n']) && (int) $payload['n'] > 1) {
    ll_error('n > 1 is not allowed through the proxy');
  }

  $safe = [
    'model' => $allowedModel,
    'messages' => $messages,
    'max_tokens' => $maxTokens,
    'temperature' => $temperature,
    'n' => 1,
  ];
  if (isset($payload['response_format']) && is_array($payload['response_format'])) {
    $safe['response_format'] = $payload['response_format'];
  }
  return $safe;
}

function ll_openai_proxy(string $url, string $method, string $apiKey, ?string $body): void
{
  if (!function_exists('curl_init')) {
    ll_error('cURL is required for the OpenAI proxy', 500);
  }
  $ch = curl_init($url);
  $headers = [
    'Authorization: Bearer ' . $apiKey,
    'Accept: application/json',
  ];
  $opts = [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CUSTOMREQUEST => $method,
    CURLOPT_TIMEOUT => 180,
    CURLOPT_HTTPHEADER => $headers,
  ];
  if ($method === 'POST') {
    $headers[] = 'Content-Type: application/json';
    $opts[CURLOPT_HTTPHEADER] = $headers;
    $opts[CURLOPT_POSTFIELDS] = $body ?? '{}';
  }
  curl_setopt_array($ch, $opts);
  $response = curl_exec($ch);
  $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
  $err = curl_error($ch);
  curl_close($ch);

  if ($response === false) {
    ll_error('OpenAI proxy failed', 502);
  }

  http_response_code($status > 0 ? $status : 502);
  header('Content-Type: application/json; charset=utf-8');
  header('Cache-Control: no-store');
  echo $response;
  exit;
}

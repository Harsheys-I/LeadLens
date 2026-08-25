<?php

declare(strict_types=1);

require_once __DIR__ . '/../lib/settings.php';

/**
 * Server-side OpenAI proxy so Admins/TeleCallers never need the raw API key in the browser.
 * Paths: /api/openai/chat/completions  /api/openai/models
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
    ll_openai_proxy('https://api.openai.com/v1/chat/completions', 'POST', $key, $body);
  }

  if ($sub === 'models') {
    ll_require_method('GET');
    ll_openai_proxy('https://api.openai.com/v1/models', 'GET', $key, null);
  }

  ll_error('Not found', 404);
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
    ll_error('OpenAI proxy failed: ' . ($err ?: 'unknown error'), 502);
  }

  http_response_code($status > 0 ? $status : 502);
  header('Content-Type: application/json; charset=utf-8');
  header('Cache-Control: no-store');
  echo $response;
  exit;
}

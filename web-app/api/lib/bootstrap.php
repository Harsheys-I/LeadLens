<?php

declare(strict_types=1);

header('X-Content-Type-Options: nosniff');

function ll_is_dev_request(): bool
{
  static $cached = null;
  if ($cached !== null) {
    return $cached;
  }
  $script = str_replace('\\', '/', (string) ($_SERVER['SCRIPT_NAME'] ?? ''));
  if (preg_match('#(?:^|/)dev/api(?:/|$)#', $script)) {
    return $cached = true;
  }
  $uri = (string) (parse_url((string) ($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH) ?: '');
  return $cached = (bool) preg_match('#^/dev(?:/|$)#', $uri);
}

$configLocal = __DIR__ . '/../config.local.php';
$configExample = __DIR__ . '/../config.example.php';

// Staging copy at /dev/api has no gitignored config; reuse production api/config.local.php.
if (!is_file($configLocal) && ll_is_dev_request()) {
  $prodConfig = __DIR__ . '/../../../api/config.local.php';
  if (is_file($prodConfig)) {
    $configLocal = $prodConfig;
  }
}

if (is_file($configLocal)) {
  $GLOBALS['LL_CONFIG'] = require $configLocal;
  $GLOBALS['LL_CONFIG_SOURCE'] = 'local';
} elseif (is_file($configExample)) {
  // Fallback only so missing-local is detectable; placeholders must not be used live.
  $GLOBALS['LL_CONFIG'] = require $configExample;
  $GLOBALS['LL_CONFIG_SOURCE'] = 'example';
} else {
  http_response_code(503);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode(['ok' => false, 'error' => 'Missing API config']);
  exit;
}

require_once __DIR__ . '/response.php';
require_once __DIR__ . '/permissions.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/auth.php';

// CORS not needed — same origin. Allow credentialed fetch defaults.
if (ll_method() === 'OPTIONS') {
  http_response_code(204);
  exit;
}

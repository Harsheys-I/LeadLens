<?php

declare(strict_types=1);

header('X-Content-Type-Options: nosniff');

$configLocal = __DIR__ . '/../config.local.php';
$configExample = __DIR__ . '/../config.example.php';

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

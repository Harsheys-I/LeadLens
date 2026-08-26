<?php

declare(strict_types=1);

require_once __DIR__ . '/lib/bootstrap.php';

$path = $_GET['r'] ?? '';
$path = trim((string) $path, '/');
$parts = $path === '' ? [] : explode('/', $path);
$resource = $parts[0] ?? '';
$action = $parts[1] ?? '';
$id = isset($parts[2]) && ctype_digit($parts[2]) ? (int) $parts[2] : null;

try {
  switch ($resource) {
    case 'auth':
      require __DIR__ . '/routes/auth.php';
      ll_route_auth($action);
      break;
    case 'admin':
      require __DIR__ . '/routes/admin.php';
      ll_route_admin($action, $id, $parts);
      break;
    case 'notifications':
      require __DIR__ . '/routes/notifications.php';
      ll_route_notifications($action, $id);
      break;
    case 'dashboards':
      require __DIR__ . '/routes/dashboards.php';
      ll_route_dashboards($action, $id);
      break;
    case 'settings':
      require __DIR__ . '/routes/settings.php';
      ll_route_settings($action);
      break;
    case 'jobs':
      require __DIR__ . '/routes/jobs.php';
      ll_route_jobs($action, $id, $parts);
      break;
    case 'openai':
      require __DIR__ . '/routes/openai.php';
      ll_route_openai($action, $parts);
      break;
    case 'meta':
      ll_ok([
        'permissions' => ll_permission_catalog(),
        'app' => $GLOBALS['LL_CONFIG']['app']['name'] ?? 'LeadLens',
      ]);
      break;
    default:
      ll_error('Not found', 404);
  }
} catch (Throwable $e) {
  ll_error('Server error: ' . $e->getMessage(), 500);
}

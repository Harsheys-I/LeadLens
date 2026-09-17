<?php

declare(strict_types=1);

require_once __DIR__ . '/../lib/dashboard-publish.php';

function ll_dashboard_can_view_all(array $user): bool
{
  return ll_user_has_permission($user, 'dashboards.view_all')
    || ll_user_has_permission($user, 'admin.users')
    || !empty($user['is_super']);
}

function ll_dashboard_decode_results($payload): array
{
  if (is_string($payload)) {
    $decoded = json_decode($payload, true);
  } else {
    $decoded = $payload;
  }
  if (!is_array($decoded)) {
    return [];
  }
  $results = $decoded['results'] ?? [];
  return is_array($results) ? $results : [];
}

function ll_dashboard_decode_meta($meta): array
{
  if (is_string($meta)) {
    $decoded = json_decode($meta, true);
    return is_array($decoded) ? $decoded : [];
  }
  return is_array($meta) ? $meta : [];
}

function ll_route_dashboards(string $action, ?int $id): void
{
  $method = ll_method();

  if ($method === 'POST' && ($action === 'publish' || $action === '')) {
    $user = ll_require_permission('telecaller.upload_dashboard');
    $body = ll_read_json_body();
    $items = $body['dashboards'] ?? null;
    if (!is_array($items) || !$items) {
      ll_error('dashboards array is required');
    }
    $out = ll_publish_telecaller_dashboards($items, $user);
    ll_ok(['published' => $out['published'], 'cleared' => $out['cleared']], 201);
  }

  if ($method === 'GET' && ($action === 'list' || $action === '')) {
    $user = ll_require_permission('telecaller.dashboard');
    $pdo = ll_pdo();
    $viewAll = ll_dashboard_can_view_all($user);

    if ($viewAll) {
      $rows = $pdo->query(
        'SELECT d.id, d.telecaller_name, d.title, d.meta, d.uploaded_by, d.created_at, d.updated_at,
                u.display_name AS uploaded_by_name
         FROM published_dashboards d
         INNER JOIN (
           SELECT telecaller_name, MAX(id) AS max_id
           FROM published_dashboards
           GROUP BY telecaller_name
         ) latest ON latest.max_id = d.id
         LEFT JOIN users u ON u.id = d.uploaded_by
         ORDER BY d.telecaller_name ASC'
      )->fetchAll();
    } else {
      $name = $user['telecaller_name'] ?? '';
      if ($name === null || $name === '') {
        ll_ok(['dashboards' => []]);
      }
      $stmt = $pdo->prepare(
        'SELECT d.id, d.telecaller_name, d.title, d.meta, d.uploaded_by, d.created_at, d.updated_at,
                u.display_name AS uploaded_by_name
         FROM published_dashboards d
         LEFT JOIN users u ON u.id = d.uploaded_by
         WHERE d.telecaller_name = ?
         ORDER BY d.id DESC
         LIMIT 1'
      );
      $stmt->execute([$name]);
      $rows = $stmt->fetchAll();
    }

    $out = [];
    foreach ($rows as $row) {
      $meta = ll_dashboard_decode_meta($row['meta']);
      $out[] = [
        'id' => (int) $row['id'],
        'telecaller_name' => $row['telecaller_name'],
        'title' => $row['title'],
        'meta' => $meta ?: null,
        'uploaded_by' => $row['uploaded_by'] !== null ? (int) $row['uploaded_by'] : null,
        'uploaded_by_name' => $row['uploaded_by_name'],
        'created_at' => $row['created_at'],
        'updated_at' => $row['updated_at'],
      ];
    }
    ll_ok(['dashboards' => $out]);
  }

  if ($method === 'GET' && $action === 'combined') {
    $user = ll_require_permission('telecaller.dashboard');
    $pdo = ll_pdo();
    $viewAll = ll_dashboard_can_view_all($user);

    if ($viewAll) {
      $rows = $pdo->query(
        'SELECT d.id, d.telecaller_name, d.title, d.payload, d.meta, d.uploaded_by, d.created_at, d.updated_at
         FROM published_dashboards d
         INNER JOIN (
           SELECT telecaller_name, MAX(id) AS max_id
           FROM published_dashboards
           GROUP BY telecaller_name
         ) latest ON latest.max_id = d.id
         ORDER BY d.telecaller_name ASC'
      )->fetchAll();
    } else {
      $name = $user['telecaller_name'] ?? '';
      if ($name === null || $name === '') {
        ll_ok([
          'results' => [],
          'dashboards' => [],
          'title' => 'Dashboard',
          'updated_at' => null,
          'view_all' => false,
        ]);
      }
      $stmt = $pdo->prepare(
        'SELECT d.id, d.telecaller_name, d.title, d.payload, d.meta, d.uploaded_by, d.created_at, d.updated_at
         FROM published_dashboards d
         WHERE d.telecaller_name = ?
         ORDER BY d.id DESC
         LIMIT 1'
      );
      $stmt->execute([$name]);
      $rows = $stmt->fetchAll();
    }

    // One board per TeleCaller (latest only — publish clears all boards then inserts fresh).
    $byName = [];
    foreach ($rows as $row) {
      $tc = trim((string) $row['telecaller_name']);
      $key = strtolower($tc);
      // Prefer higher id if a case/whitespace orphan somehow remains.
      if (isset($byName[$key]) && (int) $byName[$key]['id'] > (int) $row['id']) {
        continue;
      }
      $byName[$key] = [
        'id' => (int) $row['id'],
        'telecaller_name' => $tc,
        'title' => $row['title'],
        'results' => ll_dashboard_decode_results($row['payload']),
        'uploaded_by' => $row['uploaded_by'] !== null ? (int) $row['uploaded_by'] : null,
        'created_at' => $row['created_at'],
        'updated_at' => $row['updated_at'],
      ];
    }

    $merged = [];
    $metaOut = [];
    $latestUpdated = null;
    foreach ($byName as $entry) {
      foreach ($entry['results'] as $result) {
        $merged[] = $result;
      }
      $metaOut[] = [
        'id' => $entry['id'],
        'telecaller_name' => $entry['telecaller_name'],
        'title' => $entry['title'],
        'lead_count' => count($entry['results']),
        'uploaded_by' => $entry['uploaded_by'],
        'created_at' => $entry['created_at'],
        'updated_at' => $entry['updated_at'],
      ];
      $stamp = $entry['updated_at'] ?: $entry['created_at'];
      if ($stamp && ($latestUpdated === null || strcmp((string) $stamp, (string) $latestUpdated) > 0)) {
        $latestUpdated = $stamp;
      }
    }

    $first = reset($byName);
    $title = $viewAll ? 'All TeleCallers' : (($first['title'] ?? null) ?: ($user['telecaller_name'] ?? 'Dashboard'));
    ll_ok([
      'results' => $merged,
      'dashboards' => array_values($metaOut),
      'title' => $title,
      'updated_at' => $latestUpdated,
      'view_all' => $viewAll,
    ]);
  }

  if ($method === 'GET' && $action === 'telecaller-names') {
    ll_require_permission('admin.users');
    $pdo = ll_pdo();
    // Merge Bucket 1 Followup Review + TeleCalling Performance published telecaller names (case-insensitive dedupe).
    $byLower = [];
    $addName = static function (string $raw) use (&$byLower): void {
      $name = trim($raw);
      if ($name === '') {
        return;
      }
      $key = strtolower($name);
      if (!isset($byLower[$key])) {
        $byLower[$key] = $name;
      }
    };
    $auditRows = $pdo->query(
      'SELECT DISTINCT telecaller_name
       FROM published_dashboards
       WHERE telecaller_name IS NOT NULL AND telecaller_name <> \'\''
    )->fetchAll();
    foreach ($auditRows as $row) {
      $addName((string) ($row['telecaller_name'] ?? ''));
    }
    try {
      $perfRows = $pdo->query(
        'SELECT DISTINCT telecaller_name
         FROM perf_published_dashboards
         WHERE telecaller_name IS NOT NULL AND telecaller_name <> \'\''
      )->fetchAll();
      foreach ($perfRows as $row) {
        $addName((string) ($row['telecaller_name'] ?? ''));
      }
    } catch (Throwable $e) {
      // Perf table may not exist yet on older installs.
    }
    $names = array_values($byLower);
    natcasesort($names);
    ll_ok(['names' => array_values($names)]);
  }

  if ($method === 'GET' && ($action === 'get' || ctype_digit($action))) {
    $user = ll_require_permission('telecaller.dashboard');
    $dashId = $id ?? (int) $action;
    if ($dashId < 1) {
      ll_error('Dashboard id required');
    }
    $stmt = ll_pdo()->prepare(
      'SELECT d.*, u.display_name AS uploaded_by_name
       FROM published_dashboards d
       LEFT JOIN users u ON u.id = d.uploaded_by
       WHERE d.id = ? LIMIT 1'
    );
    $stmt->execute([$dashId]);
    $row = $stmt->fetch();
    if (!$row) {
      ll_error('Dashboard not found', 404);
    }

    $viewAll = ll_dashboard_can_view_all($user);
    if (!$viewAll) {
      $name = $user['telecaller_name'] ?? '';
      if ($name === null || $name === '' || strcasecmp((string) $name, (string) $row['telecaller_name']) !== 0) {
        ll_error('Forbidden', 403);
      }
    }

    $payload = json_decode((string) $row['payload'], true);
    $meta = ll_dashboard_decode_meta($row['meta']);
    ll_ok([
      'dashboard' => [
        'id' => (int) $row['id'],
        'telecaller_name' => $row['telecaller_name'],
        'title' => $row['title'],
        'meta' => $meta ?: null,
        'payload' => is_array($payload) ? $payload : ['results' => []],
        'uploaded_by' => $row['uploaded_by'] !== null ? (int) $row['uploaded_by'] : null,
        'uploaded_by_name' => $row['uploaded_by_name'],
        'created_at' => $row['created_at'],
        'updated_at' => $row['updated_at'],
      ],
    ]);
  }

  // Delete all published dashboards — Admin / Super / view_all only.
  if ($method === 'DELETE' && ($action === 'all' || $action === 'delete-all')) {
    $user = ll_require_user();
    if (!ll_dashboard_can_view_all($user)) {
      ll_error('Forbidden', 403);
    }
    $pdo = ll_pdo();
    $count = (int) $pdo->query('SELECT COUNT(*) FROM published_dashboards')->fetchColumn();
    $pdo->exec('DELETE FROM published_dashboards');
    ll_ok(['deleted' => true, 'count' => $count]);
  }

  if ($method === 'POST' && ($action === 'delete-all')) {
    $user = ll_require_user();
    if (!ll_dashboard_can_view_all($user)) {
      ll_error('Forbidden', 403);
    }
    $pdo = ll_pdo();
    $count = (int) $pdo->query('SELECT COUNT(*) FROM published_dashboards')->fetchColumn();
    $pdo->exec('DELETE FROM published_dashboards');
    ll_ok(['deleted' => true, 'count' => $count]);
  }

  if ($method === 'DELETE' && ($id !== null || ctype_digit($action))) {
    $user = ll_require_user();
    // TeleCallers cannot delete — only Admin/Super/view_all (uploader alone is not enough).
    if (!ll_dashboard_can_view_all($user)) {
      ll_error('Forbidden', 403);
    }
    $dashId = $id ?? (int) $action;
    $stmt = ll_pdo()->prepare('SELECT * FROM published_dashboards WHERE id = ? LIMIT 1');
    $stmt->execute([$dashId]);
    $row = $stmt->fetch();
    if (!$row) {
      ll_error('Dashboard not found', 404);
    }
    $rowName = trim((string) ($row['telecaller_name'] ?? ''));
    // Remove the whole TeleCaller board (all legacy/case-variant rows for that name).
    $name = $rowName !== '' ? $rowName : (string) $row['telecaller_name'];
    ll_pdo()->prepare(
      'DELETE FROM published_dashboards WHERE LOWER(TRIM(telecaller_name)) = LOWER(?)'
    )->execute([$name]);
    ll_ok(['deleted' => true, 'telecaller_name' => $rowName]);
  }

  ll_error('Not found', 404);
}

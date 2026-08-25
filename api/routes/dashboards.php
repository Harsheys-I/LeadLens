<?php

declare(strict_types=1);

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
    $pdo = ll_pdo();
    $ins = $pdo->prepare(
      'INSERT INTO published_dashboards (telecaller_name, title, payload, meta, uploaded_by)
       VALUES (?, ?, ?, ?, ?)'
    );
    $created = [];
    foreach ($items as $item) {
      if (!is_array($item)) {
        continue;
      }
      $telecaller = trim((string) ($item['telecaller_name'] ?? ''));
      if ($telecaller === '') {
        continue;
      }
      $title = trim((string) ($item['title'] ?? ($telecaller . ' dashboard')));
      $results = $item['results'] ?? [];
      if (!is_array($results)) {
        ll_error('Each dashboard needs a results array');
      }
      $meta = [
        'source_file' => $item['source_file'] ?? null,
        'lead_count' => $item['lead_count'] ?? count($results),
        'uploaded_at' => gmdate('c'),
        'uploaded_by_name' => $user['display_name'] ?: $user['username'],
      ];
      if (isset($item['meta']) && is_array($item['meta'])) {
        $meta = array_merge($meta, $item['meta']);
      }
      $payload = json_encode([
        'results' => $results,
        'telecaller_name' => $telecaller,
      ], JSON_UNESCAPED_UNICODE);
      if ($payload === false) {
        ll_error('Failed to encode dashboard payload');
      }
      $ins->execute([
        $telecaller,
        $title,
        $payload,
        json_encode($meta, JSON_UNESCAPED_UNICODE),
        (int) $user['id'],
      ]);
      $created[] = [
        'id' => (int) $pdo->lastInsertId(),
        'telecaller_name' => $telecaller,
        'title' => $title,
      ];
    }
    if (!$created) {
      ll_error('No valid dashboards to publish');
    }
    ll_ok(['published' => $created], 201);
  }

  if ($method === 'GET' && ($action === 'list' || $action === '')) {
    $user = ll_require_permission('telecaller.dashboard');
    $pdo = ll_pdo();
    $viewAll = ll_user_has_permission($user, 'dashboards.view_all')
      || ll_user_has_permission($user, 'admin.users')
      || !empty($user['is_super']);

    if ($viewAll) {
      $rows = $pdo->query(
        'SELECT d.id, d.telecaller_name, d.title, d.meta, d.uploaded_by, d.created_at, d.updated_at,
                u.display_name AS uploaded_by_name
         FROM published_dashboards d
         LEFT JOIN users u ON u.id = d.uploaded_by
         ORDER BY d.created_at DESC'
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
         ORDER BY d.created_at DESC'
      );
      $stmt->execute([$name]);
      $rows = $stmt->fetchAll();
    }

    $out = [];
    foreach ($rows as $row) {
      $meta = $row['meta'];
      if (is_string($meta)) {
        $decoded = json_decode($meta, true);
        $meta = is_array($decoded) ? $decoded : null;
      }
      $out[] = [
        'id' => (int) $row['id'],
        'telecaller_name' => $row['telecaller_name'],
        'title' => $row['title'],
        'meta' => $meta,
        'uploaded_by' => $row['uploaded_by'] !== null ? (int) $row['uploaded_by'] : null,
        'uploaded_by_name' => $row['uploaded_by_name'],
        'created_at' => $row['created_at'],
        'updated_at' => $row['updated_at'],
      ];
    }
    ll_ok(['dashboards' => $out]);
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

    $viewAll = ll_user_has_permission($user, 'dashboards.view_all')
      || ll_user_has_permission($user, 'admin.users')
      || !empty($user['is_super']);
    if (!$viewAll) {
      $name = $user['telecaller_name'] ?? '';
      if ($name === null || $name === '' || strcasecmp((string) $name, (string) $row['telecaller_name']) !== 0) {
        ll_error('Forbidden', 403);
      }
    }

    $payload = json_decode((string) $row['payload'], true);
    $meta = is_string($row['meta']) ? json_decode($row['meta'], true) : $row['meta'];
    ll_ok([
      'dashboard' => [
        'id' => (int) $row['id'],
        'telecaller_name' => $row['telecaller_name'],
        'title' => $row['title'],
        'meta' => is_array($meta) ? $meta : null,
        'payload' => is_array($payload) ? $payload : ['results' => []],
        'uploaded_by' => $row['uploaded_by'] !== null ? (int) $row['uploaded_by'] : null,
        'uploaded_by_name' => $row['uploaded_by_name'],
        'created_at' => $row['created_at'],
        'updated_at' => $row['updated_at'],
      ],
    ]);
  }

  if ($method === 'DELETE' && ($id !== null || ctype_digit($action))) {
    $user = ll_require_user();
    $dashId = $id ?? (int) $action;
    $canManage = ll_user_has_permission($user, 'telecaller.upload_dashboard')
      || ll_user_has_permission($user, 'dashboards.view_all')
      || !empty($user['is_super']);
    if (!$canManage) {
      ll_error('Forbidden', 403);
    }
    $stmt = ll_pdo()->prepare('SELECT * FROM published_dashboards WHERE id = ? LIMIT 1');
    $stmt->execute([$dashId]);
    $row = $stmt->fetch();
    if (!$row) {
      ll_error('Dashboard not found', 404);
    }
    $viewAll = ll_user_has_permission($user, 'dashboards.view_all') || !empty($user['is_super']);
    if (!$viewAll && (int) ($row['uploaded_by'] ?? 0) !== (int) $user['id']) {
      ll_error('Forbidden', 403);
    }
    ll_pdo()->prepare('DELETE FROM published_dashboards WHERE id = ?')->execute([$dashId]);
    ll_ok(['deleted' => true]);
  }

  ll_error('Not found', 404);
}

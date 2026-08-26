<?php

declare(strict_types=1);

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
    $pdo = ll_pdo();
    $del = $pdo->prepare('DELETE FROM published_dashboards WHERE telecaller_name = ?');
    $ins = $pdo->prepare(
      'INSERT INTO published_dashboards (telecaller_name, title, payload, meta, uploaded_by)
       VALUES (?, ?, ?, ?, ?)'
    );
    $created = [];
    $pending = [];
    foreach ($items as $item) {
      if (!is_array($item)) {
        continue;
      }
      $telecaller = trim((string) ($item['telecaller_name'] ?? ''));
      if ($telecaller === '') {
        continue;
      }
      $title = trim((string) ($item['title'] ?? ($telecaller . ' dashboard')));
      $incoming = $item['results'] ?? [];
      if (!is_array($incoming)) {
        ll_error('Each dashboard needs a results array');
      }

      $meta = [
        'source_file' => $item['source_file'] ?? null,
        'lead_count' => count($incoming),
        'uploaded_at' => gmdate('c'),
        'uploaded_by_name' => $user['display_name'] ?: $user['username'],
        'replaced' => true,
      ];
      if (isset($item['meta']) && is_array($item['meta'])) {
        $meta = array_merge($meta, $item['meta']);
        $meta['lead_count'] = count($incoming);
        $meta['replaced'] = true;
      }

      $payload = json_encode([
        'results' => $incoming,
        'telecaller_name' => $telecaller,
      ], JSON_UNESCAPED_UNICODE);
      if ($payload === false) {
        ll_error('Failed to encode dashboard payload');
      }
      $metaJson = json_encode($meta, JSON_UNESCAPED_UNICODE);
      if ($metaJson === false) {
        ll_error('Failed to encode dashboard meta');
      }

      $pending[] = [
        'telecaller' => $telecaller,
        'title' => $title,
        'payload' => $payload,
        'metaJson' => $metaJson,
        'lead_count' => count($incoming),
      ];
    }
    if (!$pending) {
      ll_error('No valid dashboards to publish');
    }

    $pdo->beginTransaction();
    try {
      foreach ($pending as $row) {
        // Replace (not merge): drop any prior board for this TeleCaller, then insert fresh.
        $del->execute([$row['telecaller']]);
        $ins->execute([$row['telecaller'], $row['title'], $row['payload'], $row['metaJson'], (int) $user['id']]);
        $created[] = [
          'id' => (int) $pdo->lastInsertId(),
          'telecaller_name' => $row['telecaller'],
          'title' => $row['title'],
          'replaced' => true,
          'merged' => false,
          'lead_count' => $row['lead_count'],
        ];
      }
      $pdo->commit();
    } catch (Throwable $e) {
      if ($pdo->inTransaction()) {
        $pdo->rollBack();
      }
      ll_error('Publish failed: ' . $e->getMessage(), 500);
    }

    try {
      ll_notify_dashboard_publish($created, $user);
    } catch (Throwable $e) {
      // Boards are saved; notification failure must not fail the publish response.
    }
    ll_ok(['published' => $created], 201);
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

    // One board per TeleCaller (latest only — publish replaces, never merges history).
    $byName = [];
    foreach ($rows as $row) {
      $tc = (string) $row['telecaller_name'];
      $byName[$tc] = [
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
    $rows = ll_pdo()->query(
      'SELECT DISTINCT telecaller_name
       FROM published_dashboards
       WHERE telecaller_name IS NOT NULL AND telecaller_name <> \'\'
       ORDER BY telecaller_name ASC'
    )->fetchAll();
    $names = [];
    foreach ($rows as $row) {
      $names[] = $row['telecaller_name'];
    }
    ll_ok(['names' => $names]);
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
    // Remove the whole TeleCaller board (all legacy rows for that name).
    ll_pdo()->prepare('DELETE FROM published_dashboards WHERE telecaller_name = ?')->execute([$rowName !== '' ? $rowName : $row['telecaller_name']]);
    ll_ok(['deleted' => true, 'telecaller_name' => $rowName]);
  }

  ll_error('Not found', 404);
}

/**
 * After publish/replace: notify matching TeleCaller users + view_all/Admin/Super.
 */
function ll_notify_dashboard_publish(array $created, array $actor): void
{
  if (!$created) {
    return;
  }
  $names = [];
  foreach ($created as $row) {
    $n = trim((string) ($row['telecaller_name'] ?? ''));
    if ($n !== '') {
      $names[$n] = true;
    }
  }
  $names = array_keys($names);
  if (!$names) {
    return;
  }

  $pdo = ll_pdo();
  $ins = $pdo->prepare(
    'INSERT INTO notifications (user_id, type, title, body, meta, is_read)
     VALUES (?, \'dashboard_update\', ?, ?, ?, 0)'
  );
  $notified = [];

  // TeleCaller-linked users whose name matches a published board.
  $placeholders = implode(',', array_fill(0, count($names), '?'));
  $stmt = $pdo->prepare(
    "SELECT u.id, u.telecaller_name
     FROM users u
     WHERE u.is_active = 1
       AND u.telecaller_name IS NOT NULL
       AND u.telecaller_name <> ''
       AND u.telecaller_name IN ($placeholders)"
  );
  $stmt->execute($names);
  foreach ($stmt->fetchAll() as $row) {
    $uid = (int) $row['id'];
    if (isset($notified[$uid])) {
      continue;
    }
    $tc = (string) $row['telecaller_name'];
    $ins->execute([
      $uid,
      'Dashboard has been updated',
      'Your dashboard for ' . $tc . ' was replaced with a new upload.',
      json_encode(['telecaller_name' => $tc, 'kind' => 'owner'], JSON_UNESCAPED_UNICODE),
    ]);
    $notified[$uid] = true;
  }

  // Admins / Super / view_all — one summary notification each.
  $count = count($names);
  $summaryBody = $count === 1
    ? ('Updated board: ' . $names[0])
    : ('Updated ' . $count . ' TeleCaller boards: ' . implode(', ', array_slice($names, 0, 5)) . ($count > 5 ? '…' : ''));
  $users = $pdo->query(
    "SELECT u.id, u.role_id, r.permissions, r.role_key, r.rank AS role_rank
     FROM users u
     INNER JOIN roles r ON r.id = u.role_id
     WHERE u.is_active = 1"
  )->fetchAll();
  $actorId = (int) ($actor['id'] ?? 0);
  foreach ($users as $row) {
    $uid = (int) $row['id'];
    if (isset($notified[$uid]) || ($actorId > 0 && $uid === $actorId)) {
      continue;
    }
    $public = [
      'permissions' => ll_normalize_permissions($row['permissions']),
      'role_key' => $row['role_key'],
      'role_rank' => (int) $row['role_rank'],
      'is_super' => (($row['role_key'] ?? '') === 'super') || ((int) ($row['role_rank'] ?? 0) >= 100),
    ];
    if (!ll_dashboard_can_view_all($public)) {
      continue;
    }
    $ins->execute([
      $uid,
      'Dashboard has been updated',
      $summaryBody,
      json_encode([
        'telecaller_names' => $names,
        'count' => $count,
        'kind' => 'viewer',
        'uploaded_by' => (int) ($actor['id'] ?? 0),
      ], JSON_UNESCAPED_UNICODE),
    ]);
    $notified[$uid] = true;
  }
}

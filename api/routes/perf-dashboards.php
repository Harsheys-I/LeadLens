<?php

declare(strict_types=1);

function ll_perf_dashboards_ensure_table(): void
{
  ll_pdo()->exec("CREATE TABLE IF NOT EXISTS perf_published_dashboards (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    telecaller_name VARCHAR(120) NOT NULL,
    title VARCHAR(200) NOT NULL DEFAULT '',
    payload LONGTEXT NOT NULL,
    meta JSON NULL,
    uploaded_by INT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_perf_pub_telecaller (telecaller_name),
    KEY idx_perf_pub_uploaded (uploaded_by),
    CONSTRAINT fk_perf_pub_user FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
}

function ll_perf_dashboard_can_view_all(array $user): bool
{
  return ll_user_has_permission($user, 'dashboards.view_all')
    || ll_user_has_permission($user, 'admin.users')
    || !empty($user['is_super']);
}

function ll_perf_dashboard_decode_meta($meta): array
{
  if (is_string($meta)) {
    $decoded = json_decode($meta, true);
    return is_array($decoded) ? $decoded : [];
  }
  return is_array($meta) ? $meta : [];
}

function ll_perf_dashboard_decode_payload($payload): array
{
  if (is_string($payload)) {
    $decoded = json_decode($payload, true);
  } else {
    $decoded = $payload;
  }
  if (!is_array($decoded)) {
    return [];
  }
  return $decoded;
}

function ll_perf_empty_summary(): array
{
  return [
    'totalLeads' => 0,
    'activeLeads' => 0,
    'siteVisited' => 0,
    'siteVisitScheduled' => 0,
    'siteVisitCancelled' => 0,
    'notInterested' => 0,
    'overdue' => 0,
  ];
}

function ll_perf_empty_pie(): array
{
  return [
    'notInterested' => 0,
    'siteVisitScheduled' => 0,
    'siteVisitCancelled' => 0,
    'siteVisited' => 0,
    'overdue' => 0,
  ];
}

function ll_perf_sum_summaries(array $summaries): array
{
  $out = ll_perf_empty_summary();
  foreach ($summaries as $summary) {
    if (!is_array($summary)) {
      continue;
    }
    foreach ($out as $key => $_) {
      $out[$key] += (int) ($summary[$key] ?? 0);
    }
  }
  return $out;
}

function ll_perf_normalize_tc_bucket(array $metrics): array
{
  $out = array_merge(ll_perf_empty_summary(), array_intersect_key($metrics, ll_perf_empty_summary()));
  $pie = is_array($metrics['pie'] ?? null) ? $metrics['pie'] : [];
  $out['pie'] = array_merge(ll_perf_empty_pie(), array_intersect_key($pie, ll_perf_empty_pie()));
  return $out;
}

function ll_perf_sum_pies(array $pies): array
{
  $out = ll_perf_empty_pie();
  foreach ($pies as $pie) {
    if (!is_array($pie)) {
      continue;
    }
    foreach ($out as $key => $_) {
      $out[$key] += (int) ($pie[$key] ?? 0);
    }
  }
  return $out;
}

function ll_route_perf_dashboards(string $action, ?int $id): void
{
  ll_perf_dashboards_ensure_table();
  $method = ll_method();

  if ($method === 'POST' && ($action === 'publish' || $action === '')) {
    $user = ll_require_permission('telecaller.perf_upload');
    $body = ll_read_json_body();
    $items = $body['dashboards'] ?? null;
    if (!is_array($items) || !$items) {
      ll_error('dashboards array is required');
    }
    $pdo = ll_pdo();
    $ins = $pdo->prepare(
      'INSERT INTO perf_published_dashboards (telecaller_name, title, payload, meta, uploaded_by)
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
      $title = trim((string) ($item['title'] ?? ($telecaller . ' · Performance')));
      $summary = is_array($item['summary'] ?? null) ? $item['summary'] : [];
      $byTelecaller = is_array($item['byTelecaller'] ?? null) ? $item['byTelecaller'] : [];
      $pie = is_array($item['pie'] ?? null) ? $item['pie'] : [];
      $dateMin = $item['date_min'] ?? $item['dateMin'] ?? null;
      $dateMax = $item['date_max'] ?? $item['dateMax'] ?? null;

      $payload = json_encode([
        'summary' => array_merge(ll_perf_empty_summary(), array_intersect_key($summary, ll_perf_empty_summary())),
        'byTelecaller' => $byTelecaller,
        'pie' => array_merge(ll_perf_empty_pie(), array_intersect_key($pie, ll_perf_empty_pie())),
        'date_min' => $dateMin,
        'date_max' => $dateMax,
        'telecaller_name' => $telecaller,
      ], JSON_UNESCAPED_UNICODE);
      if ($payload === false) {
        ll_error('Failed to encode performance dashboard payload');
      }

      $meta = [
        'uploaded_at' => gmdate('c'),
        'uploaded_by_name' => $user['display_name'] ?: $user['username'],
        'replaced' => true,
        'date_min' => $dateMin,
        'date_max' => $dateMax,
      ];
      if (isset($item['meta']) && is_array($item['meta'])) {
        $meta = array_merge($meta, $item['meta']);
        $meta['replaced'] = true;
      }
      $metaJson = json_encode($meta, JSON_UNESCAPED_UNICODE);
      if ($metaJson === false) {
        ll_error('Failed to encode performance dashboard meta');
      }

      $pending[] = [
        'telecaller' => $telecaller,
        'title' => $title,
        'payload' => $payload,
        'metaJson' => $metaJson,
      ];
    }
    if (!$pending) {
      ll_error('No valid performance dashboards to publish');
    }

    $cleared = 0;
    $pdo->beginTransaction();
    try {
      $cleared = (int) $pdo->query('SELECT COUNT(*) FROM perf_published_dashboards')->fetchColumn();
      $pdo->exec('DELETE FROM perf_published_dashboards');
      foreach ($pending as $row) {
        $ins->execute([$row['telecaller'], $row['title'], $row['payload'], $row['metaJson'], (int) $user['id']]);
        $created[] = [
          'id' => (int) $pdo->lastInsertId(),
          'telecaller_name' => $row['telecaller'],
          'title' => $row['title'],
          'replaced' => $cleared > 0,
          'prior_deleted' => $cleared,
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
      ll_notify_perf_dashboard_publish($created, $user);
    } catch (Throwable $e) {
      // Boards saved; notification failure must not fail publish.
    }
    ll_ok(['published' => $created, 'cleared' => $cleared], 201);
  }

  if ($method === 'GET' && ($action === 'list' || $action === '')) {
    $user = ll_require_permission('telecaller.perf_dashboard');
    $pdo = ll_pdo();
    $viewAll = ll_perf_dashboard_can_view_all($user);

    if ($viewAll) {
      $rows = $pdo->query(
        'SELECT d.id, d.telecaller_name, d.title, d.meta, d.uploaded_by, d.created_at, d.updated_at,
                u.display_name AS uploaded_by_name
         FROM perf_published_dashboards d
         INNER JOIN (
           SELECT telecaller_name, MAX(id) AS max_id
           FROM perf_published_dashboards
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
         FROM perf_published_dashboards d
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
      $meta = ll_perf_dashboard_decode_meta($row['meta']);
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
    $user = ll_require_permission('telecaller.perf_dashboard');
    $pdo = ll_pdo();
    $viewAll = ll_perf_dashboard_can_view_all($user);

    if ($viewAll) {
      $rows = $pdo->query(
        'SELECT d.id, d.telecaller_name, d.title, d.payload, d.meta, d.uploaded_by, d.created_at, d.updated_at
         FROM perf_published_dashboards d
         INNER JOIN (
           SELECT telecaller_name, MAX(id) AS max_id
           FROM perf_published_dashboards
           GROUP BY telecaller_name
         ) latest ON latest.max_id = d.id
         ORDER BY d.telecaller_name ASC'
      )->fetchAll();
    } else {
      $name = $user['telecaller_name'] ?? '';
      if ($name === null || $name === '') {
        ll_ok([
          'summary' => ll_perf_empty_summary(),
          'byTelecaller' => new stdClass(),
          'pie' => ll_perf_empty_pie(),
          'date_min' => null,
          'date_max' => null,
          'dashboards' => [],
          'title' => 'Performance Dashboard',
          'updated_at' => null,
          'view_all' => false,
        ]);
      }
      $stmt = $pdo->prepare(
        'SELECT d.id, d.telecaller_name, d.title, d.payload, d.meta, d.uploaded_by, d.created_at, d.updated_at
         FROM perf_published_dashboards d
         WHERE d.telecaller_name = ?
         ORDER BY d.id DESC
         LIMIT 1'
      );
      $stmt->execute([$name]);
      $rows = $stmt->fetchAll();
    }

    $byName = [];
    $summaries = [];
    $mergedByTc = [];
    $pie = ll_perf_empty_pie();
    $dateMin = null;
    $dateMax = null;
    $latestUpdated = null;

    foreach ($rows as $row) {
      $tc = trim((string) $row['telecaller_name']);
      $key = strtolower($tc);
      if (isset($byName[$key]) && (int) $byName[$key]['id'] > (int) $row['id']) {
        continue;
      }
      $payload = ll_perf_dashboard_decode_payload($row['payload']);
      $summary = is_array($payload['summary'] ?? null) ? $payload['summary'] : [];
      $byTc = is_array($payload['byTelecaller'] ?? null) ? $payload['byTelecaller'] : [];
      $rowPie = is_array($payload['pie'] ?? null) ? $payload['pie'] : [];

      if ($viewAll) {
        foreach ($byTc as $name => $metrics) {
          if (is_array($metrics)) {
            $mergedByTc[$name] = ll_perf_normalize_tc_bucket($metrics);
          }
        }
      } else {
        $normalized = [];
        foreach ($byTc as $name => $metrics) {
          if (is_array($metrics)) {
            $normalized[$name] = ll_perf_normalize_tc_bucket($metrics);
          }
        }
        $mergedByTc = $normalized;
        $pie = array_merge(ll_perf_empty_pie(), array_intersect_key($rowPie, ll_perf_empty_pie()));
      }

      $summaries[] = array_merge(ll_perf_empty_summary(), array_intersect_key($summary, ll_perf_empty_summary()));
      $dMin = $payload['date_min'] ?? null;
      $dMax = $payload['date_max'] ?? null;
      if ($dMin && ($dateMin === null || strcmp((string) $dMin, (string) $dateMin) < 0)) {
        $dateMin = $dMin;
      }
      if ($dMax && ($dateMax === null || strcmp((string) $dMax, (string) $dateMax) > 0)) {
        $dateMax = $dMax;
      }

      $byName[$key] = [
        'id' => (int) $row['id'],
        'telecaller_name' => $tc,
        'title' => $row['title'],
        'uploaded_by' => $row['uploaded_by'] !== null ? (int) $row['uploaded_by'] : null,
        'created_at' => $row['created_at'],
        'updated_at' => $row['updated_at'],
      ];
      $stamp = $row['updated_at'] ?: $row['created_at'];
      if ($stamp && ($latestUpdated === null || strcmp((string) $stamp, (string) $latestUpdated) > 0)) {
        $latestUpdated = $stamp;
      }
    }

    if ($viewAll && $mergedByTc) {
      $globalSummary = ll_perf_sum_summaries(array_values($mergedByTc));
      $pie = ll_perf_sum_pies(array_map(
        static fn (array $bucket): array => is_array($bucket['pie'] ?? null) ? $bucket['pie'] : [],
        array_values($mergedByTc)
      ));
    } else {
      $globalSummary = ll_perf_sum_summaries($summaries);
    }

    $first = reset($byName);
    $title = $viewAll ? 'All TeleCallers · Performance' : (($first['title'] ?? null) ?: ($user['telecaller_name'] ?? 'Performance Dashboard'));
    ll_ok([
      'summary' => $globalSummary,
      'byTelecaller' => $mergedByTc ?: new stdClass(),
      'pie' => $pie,
      'date_min' => $dateMin,
      'date_max' => $dateMax,
      'dashboards' => array_values($byName),
      'title' => $title,
      'updated_at' => $latestUpdated,
      'view_all' => $viewAll,
    ]);
  }

  if ($method === 'DELETE' && ($action === 'all' || $action === 'delete-all')) {
    $user = ll_require_user();
    if (!ll_perf_dashboard_can_view_all($user)) {
      ll_error('Forbidden', 403);
    }
    $pdo = ll_pdo();
    $count = (int) $pdo->query('SELECT COUNT(*) FROM perf_published_dashboards')->fetchColumn();
    $pdo->exec('DELETE FROM perf_published_dashboards');
    ll_ok(['deleted' => true, 'count' => $count]);
  }

  if ($method === 'POST' && ($action === 'delete-all')) {
    $user = ll_require_user();
    if (!ll_perf_dashboard_can_view_all($user)) {
      ll_error('Forbidden', 403);
    }
    $pdo = ll_pdo();
    $count = (int) $pdo->query('SELECT COUNT(*) FROM perf_published_dashboards')->fetchColumn();
    $pdo->exec('DELETE FROM perf_published_dashboards');
    ll_ok(['deleted' => true, 'count' => $count]);
  }

  ll_error('Not found', 404);
}

function ll_notify_perf_dashboard_publish(array $created, array $actor): void
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
     VALUES (?, \'perf_dashboard_update\', ?, ?, ?, 0)'
  );
  $notified = [];

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
      'Performance dashboard updated',
      'Your performance report for ' . $tc . ' was replaced with a new upload.',
      json_encode(['telecaller_name' => $tc, 'kind' => 'owner'], JSON_UNESCAPED_UNICODE),
    ]);
    $notified[$uid] = true;
  }

  $count = count($names);
  $summaryBody = $count === 1
    ? ('Updated performance board: ' . $names[0])
    : ('Updated ' . $count . ' TeleCaller performance boards: ' . implode(', ', array_slice($names, 0, 5)) . ($count > 5 ? '…' : ''));
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
    if (!ll_perf_dashboard_can_view_all($public)) {
      continue;
    }
    $ins->execute([
      $uid,
      'Performance dashboard updated',
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

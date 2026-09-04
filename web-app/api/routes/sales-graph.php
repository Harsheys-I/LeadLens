<?php

declare(strict_types=1);

function ll_sales_graph_ensure_table(): void
{
  ll_pdo()->exec("CREATE TABLE IF NOT EXISTS sales_graph_published (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(200) NOT NULL DEFAULT '',
    payload LONGTEXT NOT NULL,
    meta JSON NULL,
    uploaded_by INT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_sg_pub_uploaded (uploaded_by),
    CONSTRAINT fk_sg_pub_user FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
}

function ll_sales_graph_can_clear(array $user): bool
{
  return ll_user_has_permission($user, 'dashboards.view_all')
    || ll_user_has_permission($user, 'admin.users')
    || !empty($user['is_super']);
}

function ll_sales_graph_decode_meta($meta): array
{
  if (is_string($meta)) {
    $decoded = json_decode($meta, true);
    return is_array($decoded) ? $decoded : [];
  }
  return is_array($meta) ? $meta : [];
}

function ll_sales_graph_decode_payload($payload): array
{
  if (is_string($payload)) {
    $decoded = json_decode($payload, true);
  } else {
    $decoded = $payload;
  }
  return is_array($decoded) ? $decoded : [];
}

function ll_route_sales_graph(string $action, ?int $id): void
{
  ll_sales_graph_ensure_table();
  $method = ll_method();

  if ($method === 'POST' && ($action === 'publish' || $action === '')) {
    $user = ll_require_permission('sales_graph.publish');
    $body = ll_read_json_body();
    $payloadIn = $body['payload'] ?? null;
    if (!is_array($payloadIn)) {
      ll_error('payload object is required');
    }
    $leads = is_array($payloadIn['leads'] ?? null) ? $payloadIn['leads'] : null;
    $visits = is_array($payloadIn['visits'] ?? null) ? $payloadIn['visits'] : null;
    if (!$leads || !$visits) {
      ll_error('payload.leads and payload.visits are required');
    }

    $title = trim((string) ($body['title'] ?? $payloadIn['title'] ?? 'Sales Graph'));
    if ($title === '') {
      $title = 'Sales Graph';
    }

    $payload = [
      'title' => $title,
      'uploaded_at' => $payloadIn['uploaded_at'] ?? gmdate('c'),
      'months' => is_array($payloadIn['months'] ?? null) ? array_values($payloadIn['months']) : [],
      'leads' => $leads,
      'visits' => $visits,
      'booked' => $payloadIn['booked'] ?? null,
    ];
    $payloadJson = json_encode($payload, JSON_UNESCAPED_UNICODE);
    if ($payloadJson === false) {
      ll_error('Failed to encode Sales Graph payload');
    }

    $meta = [
      'uploaded_at' => gmdate('c'),
      'uploaded_by_name' => $user['display_name'] ?: $user['username'],
      'replaced' => true,
      'leads_file' => (string) ($leads['fileName'] ?? ''),
      'visits_file' => (string) ($visits['fileName'] ?? ''),
    ];
    if (isset($body['meta']) && is_array($body['meta'])) {
      $meta = array_merge($meta, $body['meta']);
      $meta['replaced'] = true;
    }
    $metaJson = json_encode($meta, JSON_UNESCAPED_UNICODE);
    if ($metaJson === false) {
      ll_error('Failed to encode Sales Graph meta');
    }

    $pdo = ll_pdo();
    $cleared = 0;
    $created = null;
    $pdo->beginTransaction();
    try {
      $cleared = (int) $pdo->query('SELECT COUNT(*) FROM sales_graph_published')->fetchColumn();
      $pdo->exec('DELETE FROM sales_graph_published');
      $ins = $pdo->prepare(
        'INSERT INTO sales_graph_published (title, payload, meta, uploaded_by)
         VALUES (?, ?, ?, ?)'
      );
      $ins->execute([$title, $payloadJson, $metaJson, (int) $user['id']]);
      $created = [
        'id' => (int) $pdo->lastInsertId(),
        'title' => $title,
        'replaced' => $cleared > 0,
        'prior_deleted' => $cleared,
      ];
      $pdo->commit();
    } catch (Throwable $e) {
      if ($pdo->inTransaction()) {
        $pdo->rollBack();
      }
      ll_error('Publish failed: ' . $e->getMessage(), 500);
    }

    try {
      ll_notify_sales_graph_publish($created, $user);
    } catch (Throwable $e) {
      // Board saved; notification failure must not fail publish.
    }

    ll_ok(['published' => $created, 'cleared' => $cleared], 201);
  }

  if ($method === 'GET' && ($action === 'latest' || $action === '')) {
    $user = ll_require_permission('sales_graph.dashboard');
    $pdo = ll_pdo();
    $row = $pdo->query(
      'SELECT d.id, d.title, d.payload, d.meta, d.uploaded_by, d.created_at, d.updated_at,
              u.display_name AS uploaded_by_name
       FROM sales_graph_published d
       LEFT JOIN users u ON u.id = d.uploaded_by
       ORDER BY d.id DESC
       LIMIT 1'
    )->fetch();

    if (!$row) {
      ll_ok([
        'dashboard' => null,
        'payload' => null,
        'meta' => null,
      ]);
    }

    $meta = ll_sales_graph_decode_meta($row['meta']);
    $payload = ll_sales_graph_decode_payload($row['payload']);
    ll_ok([
      'dashboard' => [
        'id' => (int) $row['id'],
        'title' => $row['title'],
        'uploaded_by' => $row['uploaded_by'] !== null ? (int) $row['uploaded_by'] : null,
        'uploaded_by_name' => $row['uploaded_by_name'],
        'created_at' => $row['created_at'],
        'updated_at' => $row['updated_at'],
      ],
      'payload' => $payload ?: null,
      'meta' => $meta ?: null,
    ]);
  }

  if ($method === 'DELETE' && ($action === 'all' || $action === 'delete-all')) {
    $user = ll_require_user();
    if (!ll_sales_graph_can_clear($user)) {
      ll_error('Forbidden', 403);
    }
    $pdo = ll_pdo();
    $count = (int) $pdo->query('SELECT COUNT(*) FROM sales_graph_published')->fetchColumn();
    $pdo->exec('DELETE FROM sales_graph_published');
    ll_ok(['deleted' => true, 'count' => $count]);
  }

  if ($method === 'POST' && $action === 'delete-all') {
    $user = ll_require_user();
    if (!ll_sales_graph_can_clear($user)) {
      ll_error('Forbidden', 403);
    }
    $pdo = ll_pdo();
    $count = (int) $pdo->query('SELECT COUNT(*) FROM sales_graph_published')->fetchColumn();
    $pdo->exec('DELETE FROM sales_graph_published');
    ll_ok(['deleted' => true, 'count' => $count]);
  }

  ll_error('Not found', 404);
}

function ll_notify_sales_graph_publish(?array $created, array $actor): void
{
  if (!$created) {
    return;
  }
  $pdo = ll_pdo();
  $ins = $pdo->prepare(
    'INSERT INTO notifications (user_id, type, title, body, meta, is_read)
     VALUES (?, \'sales_graph_update\', ?, ?, ?, 0)'
  );
  $users = $pdo->query(
    "SELECT u.id, u.role_id, r.permissions, r.role_key, r.rank AS role_rank
     FROM users u
     INNER JOIN roles r ON r.id = u.role_id
     WHERE u.is_active = 1"
  )->fetchAll();
  $actorId = (int) ($actor['id'] ?? 0);
  $title = (string) ($created['title'] ?? 'Sales Graph');
  $body = 'Sales Graph dashboard was replaced with a new upload.';
  $metaJson = json_encode([
    'kind' => 'viewer',
    'title' => $title,
    'uploaded_by' => $actorId,
  ], JSON_UNESCAPED_UNICODE);

  foreach ($users as $row) {
    $uid = (int) $row['id'];
    if ($actorId > 0 && $uid === $actorId) {
      continue;
    }
    $public = [
      'permissions' => ll_normalize_permissions($row['permissions']),
      'role_key' => $row['role_key'],
      'role_rank' => (int) $row['role_rank'],
      'is_super' => (($row['role_key'] ?? '') === 'super') || ((int) ($row['role_rank'] ?? 0) >= 100),
    ];
    if (!ll_user_has_permission($public, 'sales_graph.dashboard') && empty($public['is_super'])) {
      continue;
    }
    $ins->execute([$uid, 'Sales Graph updated', $body, $metaJson]);
  }
}

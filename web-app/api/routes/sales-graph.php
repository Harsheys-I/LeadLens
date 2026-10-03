<?php

declare(strict_types=1);

require_once __DIR__ . '/../lib/upload-files.php';

/**
 * Terminal Sales Graph upload (no session):
 *   POST sales-graph/upload
 *
 * Auth: multipart username + password, or JSON body with username + password.
 *
 * Payload (pick one):
 *   - application/json: { username, password, payload: { leads, visits, booked, months?, title?, uploaded_at? } }
 *     or the same fields at the top level (leads, visits, booked, …).
 *   - multipart: username, password, and either
 *       • file field "payload" (.json) with the publish payload object, or
 *       • file fields "leads", "visits", "booked" (.json) — each a Sales Graph sheet object
 *         (byMonth, byProject, bySource, totals, rows; Booked may include byStatus / leadDeclaration).
 *
 * Requires sales_graph.publish (or super). Responds 201 with { published, cleared }.
 */

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

/**
 * @param array<string, mixed> $payloadIn Raw publish input (leads, visits, booked, optional months/title/uploaded_at)
 * @param array<string, mixed> $user Authenticated user row (public shape)
 * @param array<string, mixed> $opts title override, meta merge
 * @return array{published: array<string, mixed>, cleared: int, payload: array<string, mixed>}
 */
function ll_sales_graph_publish_replace(array $payloadIn, array $user, array $opts = []): array
{
  $leads = is_array($payloadIn['leads'] ?? null) ? $payloadIn['leads'] : null;
  $visits = is_array($payloadIn['visits'] ?? null) ? $payloadIn['visits'] : null;
  $booked = is_array($payloadIn['booked'] ?? null) ? $payloadIn['booked'] : null;
  if (!$leads || !$visits || !$booked) {
    ll_error('payload.leads, payload.visits, and payload.booked are required');
  }

  $title = trim((string) ($opts['title'] ?? $payloadIn['title'] ?? 'Sales Graph'));
  if ($title === '') {
    $title = 'Sales Graph';
  }

  $payload = [
    'title' => $title,
    'uploaded_at' => $payloadIn['uploaded_at'] ?? gmdate('c'),
    'months' => is_array($payloadIn['months'] ?? null) ? array_values($payloadIn['months']) : [],
    'leads' => $leads,
    'visits' => $visits,
    'booked' => $booked,
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
    'booked_file' => (string) ($booked['fileName'] ?? ''),
  ];
  if (isset($opts['meta']) && is_array($opts['meta'])) {
    $meta = array_merge($meta, $opts['meta']);
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
    error_log('LeadLens sales-graph publish failed: ' . $e->getMessage());
    ll_error('Publish failed', 500);
  }

  try {
    ll_notify_sales_graph_publish($created, $user);
  } catch (Throwable $e) {
    // Board saved; notification failure must not fail publish.
  }

  return ['published' => $created, 'cleared' => $cleared, 'payload' => $payload];
}

function ll_sales_graph_upload_authenticate(?array $jsonBody = null): array
{
  if ($jsonBody !== null) {
    $username = trim((string) ($jsonBody['username'] ?? ''));
    $password = (string) ($jsonBody['password'] ?? '');
  } else {
    $username = trim((string) ($_POST['username'] ?? ''));
    $password = (string) ($_POST['password'] ?? '');
  }
  if ($username === '' || $password === '') {
    ll_error('username and password are required');
  }
  $row = ll_find_user_by_username($username);
  if (!$row || !(int) $row['is_active']) {
    ll_error('Invalid username or password', 401);
  }
  if (!password_verify($password, (string) $row['password_hash'])) {
    ll_error('Invalid username or password', 401);
  }
  return ll_public_user($row);
}

function ll_sales_graph_upload_require_publish(array $user): void
{
  if (!empty($user['is_super']) || ll_user_has_permission($user, 'sales_graph.publish')) {
    return;
  }
  ll_error('This account needs Sales Graph · Publish to MySQL access', 403);
}

/** @return array<string, mixed> */
function ll_sales_graph_upload_decode_sheet_json(string $raw, string $fieldLabel, string $fileName = ''): array
{
  $decoded = json_decode($raw, true);
  if (!is_array($decoded)) {
    ll_error($fieldLabel . ': invalid JSON');
  }
  if ($decoded === [] || (function_exists('array_is_list') ? array_is_list($decoded) : isset($decoded[0]))) {
    ll_error(
      $fieldLabel . ': expected a Sales Graph sheet object (byMonth, byProject, bySource, totals, rows), '
      . 'not a Strategic ERP row list — build the publish payload in the browser or paste shaped JSON'
    );
  }
  if (!is_array($decoded['byMonth'] ?? null)) {
    ll_error($fieldLabel . ': missing byMonth (Sales Graph sheet object required)');
  }
  if ($fileName !== '') {
    $decoded['fileName'] = (string) ($decoded['fileName'] ?? $fileName);
  }
  return $decoded;
}

/** @return array<string, mixed> */
function ll_sales_graph_upload_read_payload_file(): array
{
  [$bytes, $name, $_kind] = ll_upload_read_file('payload', ['json']);
  $decoded = json_decode($bytes, true);
  if (!is_array($decoded)) {
    ll_error('payload: invalid JSON');
  }
  if (isset($decoded['payload']) && is_array($decoded['payload'])) {
    return $decoded['payload'];
  }
  return $decoded;
}

function ll_sales_graph_upload_route(): void
{
  ll_require_method('POST');
  if (!$_POST && !$_FILES && (int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 0) {
    ll_error('Request is larger than the server limit (' . (string) ini_get('post_max_size') . ')', 413);
  }

  $contentType = strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? ''));
  $isJson = str_contains($contentType, 'application/json');
  $startedAt = gmdate('c');
  $log = [
    'kind' => 'sales_graph',
    'started_at' => $startedAt,
    'source_file' => '',
    'row_count' => 0,
    'lead_count' => 0,
    'uploaded_by' => '',
    'status' => 'failed',
    'error' => null,
    'published_at' => null,
    'published_count' => null,
  ];

  if ($isJson) {
    $body = ll_read_json_body();
    $user = ll_sales_graph_upload_authenticate($body);
    ll_sales_graph_upload_require_publish($user);
    $log['uploaded_by'] = (string) (($user['display_name'] ?? '') ?: ($user['username'] ?? ''));
    $payloadIn = $body['payload'] ?? null;
    if (!is_array($payloadIn)) {
      if (is_array($body['leads'] ?? null) && is_array($body['visits'] ?? null) && is_array($body['booked'] ?? null)) {
        $payloadIn = $body;
      } else {
        ll_error('payload object is required (or leads, visits, and booked at the top level)');
      }
    }
    $title = trim((string) ($body['title'] ?? ''));
    $meta = isset($body['meta']) && is_array($body['meta']) ? $body['meta'] : [];
  } else {
    $user = ll_sales_graph_upload_authenticate();
    ll_sales_graph_upload_require_publish($user);
    $log['uploaded_by'] = (string) (($user['display_name'] ?? '') ?: ($user['username'] ?? ''));
    $title = trim((string) ($_POST['title'] ?? ''));
    $meta = [];
    if (isset($_FILES['payload'])) {
      $payloadIn = ll_sales_graph_upload_read_payload_file();
      $log['source_file'] = 'payload.json';
    } elseif (isset($_FILES['leads']) || isset($_FILES['visits']) || isset($_FILES['booked'])) {
      [$leadsBytes, $leadsName] = array_slice(ll_upload_read_file('leads', ['json']), 0, 2);
      [$visitsBytes, $visitsName] = array_slice(ll_upload_read_file('visits', ['json']), 0, 2);
      [$bookedBytes, $bookedName] = array_slice(ll_upload_read_file('booked', ['json']), 0, 2);
      $log['source_file'] = $leadsName . ' + ' . $visitsName . ' + ' . $bookedName;
      $payloadIn = [
        'leads' => ll_sales_graph_upload_decode_sheet_json($leadsBytes, 'leads', $leadsName),
        'visits' => ll_sales_graph_upload_decode_sheet_json($visitsBytes, 'visits', $visitsName),
        'booked' => ll_sales_graph_upload_decode_sheet_json($bookedBytes, 'booked', $bookedName),
      ];
    } else {
      ll_error('Attach publish payload as "payload", or leads + visits + booked JSON files');
    }
  }

  $opts = ['meta' => $meta];
  if ($title !== '') {
    $opts['title'] = $title;
  }
  $out = ll_sales_graph_publish_replace($payloadIn, $user, $opts);
  $log['status'] = 'published';
  $log['published_at'] = gmdate('c');
  $log['published_count'] = 1;
  $log['source_file'] = $log['source_file'] !== '' ? $log['source_file'] : 'sales-graph';
  ll_audit_upload_log_record($log);
  ll_ok(['published' => $out['published'], 'cleared' => $out['cleared']], 201);
}

function ll_route_sales_graph(string $action, ?int $id): void
{
  ll_sales_graph_ensure_table();
  $method = ll_method();

  if ($method === 'POST' && $action === 'upload') {
    ll_sales_graph_upload_route();
  }

  if ($method === 'POST' && ($action === 'publish' || $action === '')) {
    $user = ll_require_permission('sales_graph.publish');
    $body = ll_read_json_body();
    $payloadIn = $body['payload'] ?? null;
    if (!is_array($payloadIn)) {
      ll_error('payload object is required');
    }
    $title = trim((string) ($body['title'] ?? ''));
    $opts = ['meta' => isset($body['meta']) && is_array($body['meta']) ? $body['meta'] : []];
    if ($title !== '') {
      $opts['title'] = $title;
    }
    $out = ll_sales_graph_publish_replace($payloadIn, $user, $opts);
    ll_ok(['published' => $out['published'], 'cleared' => $out['cleared']], 201);
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

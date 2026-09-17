<?php

declare(strict_types=1);

/**
 * Shared TeleCaller dashboard publish (replace-all) used by HTTP route + ERP sync.
 *
 * @param list<array{telecaller_name?:string,title?:string,results?:mixed,source_file?:mixed,meta?:array}> $items
 * @return array{published: list<array>, cleared: int}
 */
function ll_publish_telecaller_dashboards(array $items, array $actor): array
{
  if (!$items) {
    ll_error('dashboards array is required');
  }

  $pdo = ll_pdo();
  $ins = $pdo->prepare(
    'INSERT INTO published_dashboards (telecaller_name, title, payload, meta, uploaded_by)
     VALUES (?, ?, ?, ?, ?)'
  );
  $created = [];
  $pending = [];
  $actorId = (int) ($actor['id'] ?? 0);
  $actorName = (string) ($actor['display_name'] ?? $actor['username'] ?? 'system');

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
      'uploaded_by_name' => $actorName,
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

  $cleared = 0;
  $pdo->beginTransaction();
  try {
    $cleared = (int) $pdo->query('SELECT COUNT(*) FROM published_dashboards')->fetchColumn();
    $pdo->exec('DELETE FROM published_dashboards');
    foreach ($pending as $row) {
      $ins->execute([
        $row['telecaller'],
        $row['title'],
        $row['payload'],
        $row['metaJson'],
        $actorId > 0 ? $actorId : null,
      ]);
      $created[] = [
        'id' => (int) $pdo->lastInsertId(),
        'telecaller_name' => $row['telecaller'],
        'title' => $row['title'],
        'replaced' => $cleared > 0,
        'prior_deleted' => $cleared,
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
    ll_notify_dashboard_publish($created, $actor);
  } catch (Throwable $e) {
    // Boards are saved; notification failure must not fail the publish.
  }

  return ['published' => $created, 'cleared' => $cleared];
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
    $canViewAll = ll_user_has_permission($public, 'dashboards.view_all')
      || ll_user_has_permission($public, 'admin.users')
      || !empty($public['is_super']);
    if (!$canViewAll) {
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

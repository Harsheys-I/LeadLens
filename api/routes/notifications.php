<?php

declare(strict_types=1);

function ll_notifications_recover_path(string $action, ?int $id): array
{
  if ($action !== '' && $id !== null) {
    return [$action, $id];
  }
  $uri = (string) (parse_url((string) ($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH) ?: '');
  if (preg_match('#/notifications/([^/]+)(?:/([^/]+))?#', $uri, $m)) {
    if ($action === '' && ($m[1] ?? '') !== '' && $m[1] !== 'index.php') {
      $action = $m[1];
    }
    if ($id === null && isset($m[2]) && ctype_digit($m[2])) {
      $id = (int) $m[2];
    }
  }
  return [$action, $id];
}

function ll_route_notifications(string $action, ?int $id): void
{
  $user = ll_require_user();
  $pdo = ll_pdo();
  $method = ll_method();
  [$action, $id] = ll_notifications_recover_path($action, $id);

  if ($method === 'GET' && ($action === '' || $action === 'list')) {
    $stmt = $pdo->prepare(
      'SELECT id, type, title, body, meta, is_read, created_at
       FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100'
    );
    $stmt->execute([(int) $user['id']]);
    $rows = $stmt->fetchAll();
    $unread = 0;
    foreach ($rows as &$row) {
      $row['id'] = (int) $row['id'];
      $row['is_read'] = (int) $row['is_read'] === 1;
      if (is_string($row['meta'])) {
        $decoded = json_decode($row['meta'], true);
        $row['meta'] = is_array($decoded) ? $decoded : null;
      }
      if (!$row['is_read']) {
        $unread++;
      }
    }
    unset($row);
    ll_ok(['notifications' => $rows, 'unread' => $unread]);
  }

  if ($method === 'POST') {
    $body = ll_read_json_body();
    if ($action === '') {
      $action = trim((string) ($body['action'] ?? ''));
    }
    if ($id === null) {
      $rawId = $body['id'] ?? $body['notification_id'] ?? 0;
      if (is_numeric($rawId) && (int) $rawId > 0) {
        $id = (int) $rawId;
      }
    }

    // Hostinger/shared hosts often drop extra path segments or block DELETE/PUT.
    if (in_array($action, ['read-all', 'read_all', 'mark-all-read', 'mark_all_read'], true)) {
      $pdo->prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0')
        ->execute([(int) $user['id']]);
      ll_ok(['marked' => true]);
    }

    if (in_array($action, ['clear-all', 'clear_all'], true)) {
      $pdo->prepare('DELETE FROM notifications WHERE user_id = ?')
        ->execute([(int) $user['id']]);
      ll_ok(['cleared' => true]);
    }

    if (in_array($action, ['clear', 'dismiss', 'delete'], true)) {
      $nid = $id ?? 0;
      if ($nid < 1) {
        ll_error('Notification id required');
      }
      $pdo->prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?')
        ->execute([$nid, (int) $user['id']]);
      ll_ok(['cleared' => true]);
    }

    if ($action === 'read' || ($action === '' && $id !== null)) {
      $nid = $id ?? 0;
      if ($nid < 1) {
        ll_error('Notification id required');
      }
      $pdo->prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?')
        ->execute([$nid, (int) $user['id']]);
      ll_ok(['marked' => true]);
    }
  }

  ll_error('Not found', 404);
}

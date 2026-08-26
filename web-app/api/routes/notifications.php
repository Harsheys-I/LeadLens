<?php

declare(strict_types=1);

function ll_route_notifications(string $action, ?int $id): void
{
  $user = ll_require_user();
  $pdo = ll_pdo();
  $method = ll_method();

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

  if ($method === 'POST' && $action === 'read-all') {
    $pdo->prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0')
      ->execute([(int) $user['id']]);
    ll_ok(['marked' => true]);
  }

  if ($method === 'POST' && $action === 'clear-all') {
    $pdo->prepare('DELETE FROM notifications WHERE user_id = ?')
      ->execute([(int) $user['id']]);
    ll_ok(['cleared' => true]);
  }

  if ($method === 'POST' && $action === 'clear') {
    $nid = $id ?? (int) (ll_read_json_body()['id'] ?? 0);
    if ($nid < 1) {
      ll_error('Notification id required');
    }
    $pdo->prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?')
      ->execute([$nid, (int) $user['id']]);
    ll_ok(['cleared' => true]);
  }

  if ($method === 'POST' && ($action === 'read' || ($action === '' && $id !== null))) {
    $nid = $id ?? (int) (ll_read_json_body()['id'] ?? 0);
    if ($nid < 1) {
      ll_error('Notification id required');
    }
    $pdo->prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?')
      ->execute([$nid, (int) $user['id']]);
    ll_ok(['marked' => true]);
  }

  ll_error('Not found', 404);
}

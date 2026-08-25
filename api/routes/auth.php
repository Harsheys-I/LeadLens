<?php

declare(strict_types=1);

function ll_route_auth(string $action): void
{
  switch ($action) {
    case 'login':
      ll_require_method('POST');
      $body = ll_read_json_body();
      $username = trim((string) ($body['username'] ?? ''));
      $password = (string) ($body['password'] ?? '');
      if ($username === '' || $password === '') {
        ll_error('Username and password are required');
      }
      $row = ll_find_user_by_username($username);
      if (!$row || !(int) $row['is_active']) {
        ll_error('Invalid username or password', 401);
      }
      if (!password_verify($password, (string) $row['password_hash'])) {
        ll_error('Invalid username or password', 401);
      }
      ll_create_session((int) $row['id']);
      ll_ok(['user' => ll_public_user($row)]);
      break;

    case 'logout':
      ll_require_method('POST');
      ll_destroy_session();
      ll_ok();
      break;

    case 'me':
      ll_require_method('GET');
      $user = ll_current_user();
      if (!$user) {
        ll_error('Authentication required', 401);
      }
      ll_ok(['user' => $user]);
      break;

    case 'change-password':
      ll_require_method('POST');
      $user = ll_require_user();
      $body = ll_read_json_body();
      $current = (string) ($body['current_password'] ?? '');
      $next = (string) ($body['new_password'] ?? '');
      if (strlen($next) < 5) {
        ll_error('New password must be at least 5 characters');
      }
      $row = ll_find_user_by_id((int) $user['id']);
      if (!$row || !password_verify($current, (string) $row['password_hash'])) {
        ll_error('Current password is incorrect', 400);
      }
      $hash = password_hash($next, PASSWORD_BCRYPT);
      ll_pdo()->prepare(
        'UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = UTC_TIMESTAMP() WHERE id = ?'
      )->execute([$hash, (int) $user['id']]);
      $fresh = ll_find_user_by_id((int) $user['id']);
      ll_ok(['user' => ll_public_user($fresh)]);
      break;

    case 'request-access':
      ll_require_method('POST');
      $body = ll_read_json_body();
      $fullName = trim((string) ($body['full_name'] ?? ''));
      $email = trim((string) ($body['email'] ?? ''));
      $requestedUsername = trim((string) ($body['requested_username'] ?? ''));
      $reason = trim((string) ($body['reason'] ?? ''));
      $preferred = trim((string) ($body['preferred_module'] ?? ''));
      if ($fullName === '') {
        ll_error('Full name is required');
      }
      if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        ll_error('A valid email is required');
      }

      $pdo = ll_pdo();
      $pdo->prepare(
        'INSERT INTO access_requests (full_name, email, requested_username, reason, preferred_module, status)
         VALUES (?, ?, ?, ?, ?, \'pending\')'
      )->execute([$fullName, $email, $requestedUsername, $reason, $preferred]);
      $requestId = (int) $pdo->lastInsertId();

      // Notify all Admin+ users with access_requests permission
      $admins = $pdo->query(
        "SELECT u.id, r.permissions FROM users u
         INNER JOIN roles r ON r.id = u.role_id
         WHERE u.is_active = 1"
      )->fetchAll();
      $ins = $pdo->prepare(
        'INSERT INTO notifications (user_id, type, title, body, meta, is_read)
         VALUES (?, \'access_request\', ?, ?, ?, 0)'
      );
      foreach ($admins as $admin) {
        $perms = ll_normalize_permissions($admin['permissions']);
        if (!in_array('admin.access_requests', $perms, true) && !in_array('admin.users', $perms, true)) {
          continue;
        }
        $ins->execute([
          (int) $admin['id'],
          'New access request',
          $fullName . ' requested access' . ($preferred !== '' ? " ({$preferred})" : ''),
          json_encode(['access_request_id' => $requestId], JSON_UNESCAPED_UNICODE),
        ]);
      }

      ll_ok(['message' => 'Request submitted. An admin will review it.']);
      break;

    default:
      ll_error('Not found', 404);
  }
}

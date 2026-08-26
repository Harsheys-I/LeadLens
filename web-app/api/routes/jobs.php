<?php

declare(strict_types=1);

function ll_ensure_audit_jobs_table(): void
{
  static $done = false;
  if ($done) {
    return;
  }
  $done = true;
  ll_pdo()->exec(
    "CREATE TABLE IF NOT EXISTS audit_jobs (
      job_id CHAR(36) NOT NULL PRIMARY KEY,
      owner_user_id INT UNSIGNED NULL,
      owner_name VARCHAR(120) NOT NULL DEFAULT '',
      file_name VARCHAR(255) NOT NULL DEFAULT '',
      status VARCHAR(40) NOT NULL DEFAULT '',
      mode VARCHAR(60) NOT NULL DEFAULT '',
      payload LONGTEXT NOT NULL,
      client_updated_at VARCHAR(40) NOT NULL DEFAULT '',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_audit_jobs_client_updated (client_updated_at),
      KEY idx_audit_jobs_owner (owner_user_id),
      CONSTRAINT fk_audit_jobs_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
  );
}

function ll_jobs_is_uuid(string $value): bool
{
  return (bool) preg_match(
    '/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i',
    $value
  );
}

function ll_jobs_meta_row(array $row): array
{
  return [
    'job_id' => (string) $row['job_id'],
    'owner_user_id' => $row['owner_user_id'] !== null ? (int) $row['owner_user_id'] : null,
    'owner_name' => (string) ($row['owner_name'] ?? ''),
    'file_name' => (string) ($row['file_name'] ?? ''),
    'status' => (string) ($row['status'] ?? ''),
    'mode' => (string) ($row['mode'] ?? ''),
    'client_updated_at' => (string) ($row['client_updated_at'] ?? ''),
    'created_at' => $row['created_at'] ?? null,
    'updated_at' => $row['updated_at'] ?? null,
  ];
}

function ll_route_jobs(string $action, ?int $id, array $parts): void
{
  ll_ensure_audit_jobs_table();
  $user = ll_require_permission('telecaller.history');
  $pdo = ll_pdo();
  $method = ll_method();
  $jobKey = '';
  if (isset($parts[1]) && ll_jobs_is_uuid((string) $parts[1])) {
    $jobKey = (string) $parts[1];
  } elseif (isset($parts[2]) && ll_jobs_is_uuid((string) $parts[2])) {
    $jobKey = (string) $parts[2];
  }

  if ($method === 'GET' && ($action === '' || $action === 'list')) {
    $stmt = $pdo->query(
      'SELECT job_id, owner_user_id, owner_name, file_name, status, mode, client_updated_at, created_at, updated_at
       FROM audit_jobs
       ORDER BY client_updated_at DESC, updated_at DESC
       LIMIT 500'
    );
    $rows = $stmt->fetchAll();
    $out = [];
    foreach ($rows as $row) {
      $out[] = ll_jobs_meta_row($row);
    }
    ll_ok(['jobs' => $out]);
  }

  if ($method === 'GET' && ($action === 'get' || $jobKey !== '')) {
    $jobId = $jobKey !== '' ? $jobKey : trim((string) ($action === 'get' ? '' : $action));
    if (!ll_jobs_is_uuid($jobId)) {
      ll_error('Job id required');
    }
    $stmt = $pdo->prepare('SELECT * FROM audit_jobs WHERE job_id = ? LIMIT 1');
    $stmt->execute([$jobId]);
    $row = $stmt->fetch();
    if (!$row) {
      ll_error('Job not found', 404);
    }
    $payload = json_decode((string) $row['payload'], true);
    if (!is_array($payload)) {
      ll_error('Stored job payload is invalid', 500);
    }
    ll_ok([
      'job' => $payload,
      'meta' => ll_jobs_meta_row($row),
    ]);
  }

  if ($method === 'POST' && $action === 'upsert') {
    $body = ll_read_json_body();
    $job = $body['job'] ?? $body;
    if (!is_array($job)) {
      ll_error('Job payload required');
    }
    $jobId = trim((string) ($job['id'] ?? ''));
    if (!ll_jobs_is_uuid($jobId)) {
      ll_error('Valid job id required');
    }
    $clientUpdated = trim((string) ($job['updatedAt'] ?? ''));
    if ($clientUpdated === '') {
      ll_error('updatedAt is required');
    }

    $ownerName = trim((string) ($job['ownerName'] ?? ''));
    if ($ownerName === '') {
      $ownerName = trim((string) ($user['display_name'] ?? $user['username'] ?? ''));
    }
    $ownerUserId = isset($job['ownerUserId']) && is_numeric($job['ownerUserId'])
      ? (int) $job['ownerUserId']
      : (int) $user['id'];
    if (empty($job['ownerName'])) {
      $job['ownerName'] = $ownerName;
    }
    if (empty($job['ownerUserId'])) {
      $job['ownerUserId'] = $ownerUserId;
    }

    $fileName = trim((string) ($job['fileName'] ?? ''));
    $status = trim((string) ($job['status'] ?? ''));
    $mode = trim((string) ($job['mode'] ?? ''));

    $existing = $pdo->prepare('SELECT client_updated_at, owner_user_id, owner_name FROM audit_jobs WHERE job_id = ? LIMIT 1');
    $existing->execute([$jobId]);
    $prev = $existing->fetch();
    if ($prev) {
      $prevUpdated = (string) ($prev['client_updated_at'] ?? '');
      if ($prevUpdated !== '' && strcmp($clientUpdated, $prevUpdated) < 0) {
        ll_ok(['upserted' => false, 'reason' => 'stale', 'client_updated_at' => $prevUpdated]);
      }
      // Keep original owner when present.
      if ($prev['owner_user_id'] !== null) {
        $ownerUserId = (int) $prev['owner_user_id'];
      }
      if (trim((string) ($prev['owner_name'] ?? '')) !== '') {
        $ownerName = (string) $prev['owner_name'];
      }
      $job['ownerUserId'] = $ownerUserId;
      $job['ownerName'] = $ownerName;
      $payloadJson = json_encode($job, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
      if ($payloadJson === false) {
        ll_error('Could not encode job payload');
      }
      $pdo->prepare(
        'UPDATE audit_jobs
         SET owner_user_id = ?, owner_name = ?, file_name = ?, status = ?, mode = ?,
             payload = ?, client_updated_at = ?, updated_at = UTC_TIMESTAMP()
         WHERE job_id = ?'
      )->execute([$ownerUserId, $ownerName, $fileName, $status, $mode, $payloadJson, $clientUpdated, $jobId]);
    } else {
      $payloadJson = json_encode($job, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
      if ($payloadJson === false) {
        ll_error('Could not encode job payload');
      }
      $pdo->prepare(
        'INSERT INTO audit_jobs
          (job_id, owner_user_id, owner_name, file_name, status, mode, payload, client_updated_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())'
      )->execute([$jobId, $ownerUserId, $ownerName, $fileName, $status, $mode, $payloadJson, $clientUpdated]);
    }
    ll_ok(['upserted' => true, 'job_id' => $jobId]);
  }

  if ($method === 'POST' && $action === 'clear') {
    $count = (int) $pdo->query('SELECT COUNT(*) FROM audit_jobs')->fetchColumn();
    $pdo->exec('DELETE FROM audit_jobs');
    ll_ok(['cleared' => true, 'count' => $count]);
  }

  // Hostinger-friendly POST delete + DELETE
  if (
    ($method === 'DELETE' && ($jobKey !== '' || ll_jobs_is_uuid($action)))
    || ($method === 'POST' && ($action === 'delete' || ($action === 'remove')))
  ) {
    $jobId = $jobKey;
    if ($jobId === '') {
      $jobId = ll_jobs_is_uuid($action) ? $action : '';
    }
    if ($jobId === '') {
      $body = ll_read_json_body();
      $jobId = trim((string) ($body['job_id'] ?? $body['id'] ?? ''));
    }
    if (!ll_jobs_is_uuid($jobId)) {
      ll_error('Job id required');
    }
    $stmt = $pdo->prepare('DELETE FROM audit_jobs WHERE job_id = ?');
    $stmt->execute([$jobId]);
    ll_ok(['deleted' => true, 'job_id' => $jobId]);
  }

  ll_error('Not found', 404);
}

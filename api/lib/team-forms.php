<?php

declare(strict_types=1);

/** Valid per-group membership roles. */
function ll_tf_roles(): array
{
  return ['form_creator', 'reviewer', 'assignee'];
}

function ll_tf_task_statuses(): array
{
  return ['pending', 'in_progress', 'completed', 'submitted', 'approved', 'rework', 'closed'];
}

function ll_tf_field_types(): array
{
  return [
    'text', 'textarea', 'number', 'select', 'checkbox', 'date', 'url', 'document',
    'assign_to', 'status', 'reviewer',
    'readonly', 'calculated',
  ];
}

function ll_tf_system_field_types(): array
{
  return ['assign_to', 'status', 'reviewer'];
}

/** @return list<array{field_key:string,label:string,field_type:string}> */
function ll_tf_system_field_defs(): array
{
  return [
    ['field_key' => 'sys_assign_to', 'label' => 'Assign To', 'field_type' => 'assign_to'],
    ['field_key' => 'sys_status', 'label' => 'Status', 'field_type' => 'status'],
    ['field_key' => 'sys_reviewer', 'label' => 'Reviewer', 'field_type' => 'reviewer'],
  ];
}

function ll_tf_is_system_field(array $f): bool
{
  $key = (string) ($f['field_key'] ?? '');
  $type = (string) ($f['field_type'] ?? '');
  if (in_array($type, ll_tf_system_field_types(), true)) {
    return true;
  }
  return str_starts_with($key, 'sys_');
}

function ll_tf_ensure_system_fields(int $formId): void
{
  if ($formId < 1) {
    return;
  }
  $pdo = ll_pdo();
  $existing = $pdo->prepare('SELECT field_key, field_type FROM form_fields WHERE form_id = ?');
  $existing->execute([$formId]);
  $have = [];
  foreach ($existing->fetchAll() as $row) {
    $have[(string) $row['field_key']] = true;
    $have['type:' . (string) $row['field_type']] = true;
  }
  $missing = [];
  foreach (ll_tf_system_field_defs() as $def) {
    if (!empty($have[$def['field_key']]) || !empty($have['type:' . $def['field_type']])) {
      continue;
    }
    $missing[] = $def;
  }
  if (!$missing) {
    return;
  }
  $min = (int) $pdo->query(
    'SELECT COALESCE(MIN(sort_order), 0) FROM form_fields WHERE form_id = ' . (int) $formId
  )->fetchColumn();
  $sort = $min - count($missing);
  $ins = $pdo->prepare(
    'INSERT INTO form_fields
      (form_id, field_key, label, field_type, options_json, required, creator_only, sort_order)
     VALUES (?, ?, ?, ?, NULL, 1, 1, ?)'
  );
  foreach ($missing as $def) {
    $ins->execute([$formId, $def['field_key'], $def['label'], $def['field_type'], $sort]);
    $sort++;
  }
}

const LL_TF_DOC_MAX_BYTES = 10 * 1024 * 1024;

/** @return array<string, list<string>> */
function ll_tf_doc_allowed_map(): array
{
  return [
    'pdf' => ['application/pdf'],
    'png' => ['image/png'],
    'jpg' => ['image/jpeg'],
    'jpeg' => ['image/jpeg'],
    'gif' => ['image/gif'],
    'webp' => ['image/webp'],
    'txt' => ['text/plain'],
    'csv' => ['text/csv', 'text/plain', 'application/vnd.ms-excel'],
    'doc' => ['application/msword', 'application/octet-stream'],
    'docx' => ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/octet-stream'],
    'xls' => ['application/vnd.ms-excel', 'application/octet-stream'],
    'xlsx' => ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'],
    'ppt' => ['application/vnd.ms-powerpoint', 'application/octet-stream'],
    'pptx' => ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/octet-stream'],
    'odt' => ['application/vnd.oasis.opendocument.text', 'application/octet-stream'],
    'ods' => ['application/vnd.oasis.opendocument.spreadsheet', 'application/octet-stream'],
  ];
}

function ll_tf_is_valid_url_answer($value): bool
{
  if ($value === null) {
    return true;
  }
  if (!is_scalar($value)) {
    return false;
  }
  $s = trim((string) $value);
  if ($s === '') {
    return true;
  }
  if (strlen($s) > 2048) {
    return false;
  }
  if (filter_var($s, FILTER_VALIDATE_URL) === false) {
    return false;
  }
  $scheme = strtolower((string) (parse_url($s, PHP_URL_SCHEME) ?? ''));
  return $scheme === 'http' || $scheme === 'https';
}

/** @return array{name:string,size:int,mime:string,stored:string}|null */
function ll_tf_parse_document_answer($value): ?array
{
  if ($value === null || $value === '') {
    return null;
  }
  $decoded = is_array($value) ? $value : json_decode((string) $value, true);
  if (!is_array($decoded)) {
    return null;
  }
  $stored = trim((string) ($decoded['stored'] ?? ''));
  $name = trim((string) ($decoded['name'] ?? ''));
  if ($stored === '' || $name === '') {
    return null;
  }
  return [
    'name' => $name,
    'size' => (int) ($decoded['size'] ?? 0),
    'mime' => (string) ($decoded['mime'] ?? ''),
    'stored' => $stored,
  ];
}

function ll_tf_doc_storage_dir(): string
{
  $dir = __DIR__ . '/../storage/team-forms';
  if (!is_dir($dir)) {
    @mkdir($dir, 0750, true);
  }
  $deny = $dir . '/.htaccess';
  if (!is_file($deny)) {
    @file_put_contents($deny, "Require all denied\n");
  }
  return $dir;
}

function ll_tf_doc_abs_path(string $stored): ?string
{
  $stored = str_replace('\\', '/', $stored);
  if ($stored === '' || str_contains($stored, '..')) {
    return null;
  }
  if (!preg_match('#^\d+/[A-Za-z0-9._-]+$#', $stored)) {
    return null;
  }
  $base = realpath(ll_tf_doc_storage_dir());
  $abs = realpath(ll_tf_doc_storage_dir() . '/' . $stored);
  if ($base === false || $abs === false) {
    return null;
  }
  $prefix = $base . DIRECTORY_SEPARATOR;
  if (!str_starts_with($abs, $prefix)) {
    return null;
  }
  return $abs;
}

function ll_tf_doc_unlink_stored(?string $stored): void
{
  if (!$stored) {
    return;
  }
  $abs = ll_tf_doc_abs_path($stored);
  if ($abs && is_file($abs)) {
    @unlink($abs);
  }
}

function ll_tf_doc_delete_task_dir(int $taskId): void
{
  if ($taskId < 1) {
    return;
  }
  $dir = ll_tf_doc_storage_dir() . '/' . $taskId;
  if (!is_dir($dir)) {
    return;
  }
  foreach (glob($dir . '/*') ?: [] as $f) {
    if (is_file($f)) {
      @unlink($f);
    }
  }
  @rmdir($dir);
}

function ll_tf_doc_cleanup_field(int $fieldId): void
{
  if ($fieldId < 1) {
    return;
  }
  $stmt = ll_pdo()->prepare('SELECT value_text FROM form_answers WHERE field_id = ?');
  $stmt->execute([$fieldId]);
  foreach ($stmt->fetchAll() as $row) {
    $meta = ll_tf_parse_document_answer($row['value_text'] ?? null);
    if ($meta) {
      ll_tf_doc_unlink_stored($meta['stored']);
    }
  }
}

/**
 * Hostinger DBs created before comment snapshots/attachments.
 */
function ll_tf_ensure_comment_schema(PDO $pdo): void
{
  $add = [
    'status_at_time' => 'VARCHAR(40) NULL',
    'attachments_json' => 'LONGTEXT NULL',
    'time_spent_minutes' => 'INT UNSIGNED NULL',
  ];
  foreach ($add as $name => $ddl) {
    try {
      $has = $pdo->query('SHOW COLUMNS FROM form_comments LIKE ' . $pdo->quote($name))->fetch();
      if (!$has) {
        $pdo->exec("ALTER TABLE form_comments ADD COLUMN `$name` $ddl");
      }
    } catch (Throwable $e) {
      /* concurrent migrate */
    }
  }
}

/**
 * Validate one $_FILES entry (same rules as document fields).
 *
 * @return array{tmp:string,orig:string,ext:string,mime:string,size:int,safe_name:string}
 */
function ll_tf_accept_upload(array $file): array
{
  $err = (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE);
  if ($err === UPLOAD_ERR_INI_SIZE || $err === UPLOAD_ERR_FORM_SIZE) {
    ll_error('File must be 10 MB or smaller');
  }
  if ($err !== UPLOAD_ERR_OK) {
    ll_error('Upload failed');
  }
  $size = (int) ($file['size'] ?? 0);
  if ($size < 1) {
    ll_error('File is empty');
  }
  if ($size > LL_TF_DOC_MAX_BYTES) {
    ll_error('File must be 10 MB or smaller');
  }
  $tmp = (string) ($file['tmp_name'] ?? '');
  if ($tmp === '' || !is_uploaded_file($tmp)) {
    ll_error('Upload failed');
  }
  $orig = (string) ($file['name'] ?? 'document');
  $origBase = basename(str_replace('\\', '/', $orig));
  $ext = strtolower(pathinfo($origBase, PATHINFO_EXTENSION));
  $allowed = ll_tf_doc_allowed_map();
  if ($ext === '' || !isset($allowed[$ext])) {
    ll_error('File type not allowed');
  }
  $mime = '';
  if (class_exists('finfo')) {
    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $detected = $finfo->file($tmp);
    $mime = is_string($detected) ? strtolower($detected) : '';
  }
  if ($mime === '' || $mime === 'application/octet-stream') {
    $mime = $allowed[$ext][0];
  } elseif (!in_array($mime, $allowed[$ext], true)) {
    ll_error('File type not allowed');
  }
  $safeName = preg_replace('/[^\w.\- ()]+/u', '_', $origBase) ?: ('document.' . $ext);
  if (strlen($safeName) > 180) {
    $safeName = substr($safeName, 0, 160) . '.' . $ext;
  }
  return [
    'tmp' => $tmp,
    'orig' => $origBase,
    'ext' => $ext,
    'mime' => $mime,
    'size' => $size,
    'safe_name' => $safeName,
  ];
}

/**
 * @return list<array{name:string,type:string,tmp_name:string,error:int,size:int}>
 */
function ll_tf_collect_upload_files(): array
{
  $out = [];
  if (!empty($_FILES['files']) && is_array($_FILES['files'])) {
    $bag = $_FILES['files'];
    if (is_array($bag['name'] ?? null)) {
      $n = count($bag['name']);
      for ($i = 0; $i < $n; $i++) {
        $out[] = [
          'name' => (string) ($bag['name'][$i] ?? ''),
          'type' => (string) ($bag['type'][$i] ?? ''),
          'tmp_name' => (string) ($bag['tmp_name'][$i] ?? ''),
          'error' => (int) ($bag['error'][$i] ?? UPLOAD_ERR_NO_FILE),
          'size' => (int) ($bag['size'][$i] ?? 0),
        ];
      }
    } else {
      $out[] = $bag;
    }
  }
  if (!empty($_FILES['file']) && is_array($_FILES['file']) && is_string($_FILES['file']['name'] ?? null)) {
    $out[] = $_FILES['file'];
  }
  return array_values(array_filter($out, static function ($f) {
    return (int) ($f['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE;
  }));
}

function ll_tf_store_task_file(int $taskId, string $storedName, string $tmp): string
{
  $dir = ll_tf_doc_storage_dir() . '/' . $taskId;
  if (!is_dir($dir) && !@mkdir($dir, 0750, true)) {
    ll_error('Could not store file', 500);
  }
  $dest = $dir . '/' . $storedName;
  if (!move_uploaded_file($tmp, $dest)) {
    ll_error('Could not store file', 500);
  }
  return $taskId . '/' . $storedName;
}

/**
 * @param mixed $links
 * @return list<array{type:string,url:string,label:string}>
 */
function ll_tf_normalize_comment_links($links): array
{
  if (!is_array($links)) {
    return [];
  }
  $out = [];
  foreach ($links as $item) {
    if (count($out) >= 10) {
      break;
    }
    $url = '';
    $label = '';
    if (is_string($item)) {
      $url = trim($item);
    } elseif (is_array($item)) {
      $url = trim((string) ($item['url'] ?? $item['href'] ?? ''));
      $label = trim((string) ($item['label'] ?? $item['name'] ?? ''));
    }
    if ($url === '' || !ll_tf_is_valid_url_answer($url)) {
      continue;
    }
    if (strlen($label) > 200) {
      $label = substr($label, 0, 200);
    }
    $out[] = [
      'type' => 'link',
      'url' => $url,
      'label' => $label,
    ];
  }
  return $out;
}

/**
 * @return list<array<string,mixed>>
 */
function ll_tf_parse_comment_attachments($json): array
{
  if ($json === null || $json === '') {
    return [];
  }
  $decoded = is_array($json) ? $json : json_decode((string) $json, true);
  if (!is_array($decoded)) {
    return [];
  }
  $out = [];
  foreach ($decoded as $raw) {
    if (!is_array($raw)) {
      continue;
    }
    $type = (string) ($raw['type'] ?? '');
    if ($type === 'file') {
      $stored = trim((string) ($raw['stored'] ?? ''));
      $name = trim((string) ($raw['name'] ?? ''));
      if ($stored === '' || $name === '') {
        continue;
      }
      $out[] = [
        'type' => 'file',
        'name' => $name,
        'size' => (int) ($raw['size'] ?? 0),
        'mime' => (string) ($raw['mime'] ?? ''),
        'stored' => $stored,
      ];
      continue;
    }
    if ($type === 'link') {
      $url = trim((string) ($raw['url'] ?? ''));
      if ($url === '' || !ll_tf_is_valid_url_answer($url)) {
        continue;
      }
      $out[] = [
        'type' => 'link',
        'url' => $url,
        'label' => trim((string) ($raw['label'] ?? '')),
      ];
    }
  }
  return $out;
}

/**
 * Public attachment payload — no stored path.
 *
 * @return list<array<string,mixed>>
 */
function ll_tf_comment_attachments_public($json): array
{
  $out = [];
  foreach (ll_tf_parse_comment_attachments($json) as $i => $att) {
    if (($att['type'] ?? '') === 'file') {
      $out[] = [
        'type' => 'file',
        'index' => $i,
        'name' => (string) $att['name'],
        'size' => (int) ($att['size'] ?? 0),
        'mime' => (string) ($att['mime'] ?? ''),
      ];
      continue;
    }
    if (($att['type'] ?? '') === 'link') {
      $out[] = [
        'type' => 'link',
        'index' => $i,
        'url' => (string) $att['url'],
        'label' => (string) ($att['label'] ?? ''),
      ];
    }
  }
  return $out;
}

function ll_tf_parse_time_spent_minutes($raw): ?int
{
  if ($raw === null || $raw === '' || is_bool($raw)) {
    return null;
  }
  if (is_int($raw) || is_float($raw)) {
    $mins = (int) round((float) $raw);
  } else {
    $s = trim((string) $raw);
    if ($s === '') {
      return null;
    }
    if (preg_match('/^(\d+)\s*:\s*(\d{1,2})$/', $s, $m)) {
      $minutes = (int) $m[2];
      if ($minutes > 59) {
        return null;
      }
      $mins = ((int) $m[1]) * 60 + $minutes;
    } elseif (preg_match('/^\d+$/', $s)) {
      $mins = (int) $s;
    } elseif (preg_match('/^\d+\.\d+$/', $s)) {
      $mins = (int) round(((float) $s) * 60);
    } else {
      return null;
    }
  }
  if ($mins < 1 || $mins > 10080) {
    return null;
  }
  return $mins;
}

function ll_tf_insert_comment(
  int $taskId,
  int $userId,
  string $body,
  ?string $statusAtTime,
  array $attachments = [],
  ?int $timeSpentMinutes = null
): void {
  if ($statusAtTime !== null && $statusAtTime !== '' && !in_array($statusAtTime, ll_tf_task_statuses(), true)) {
    $statusAtTime = null;
  }
  if ($statusAtTime === '') {
    $statusAtTime = null;
  }
  if ($timeSpentMinutes !== null && ($timeSpentMinutes < 1 || $timeSpentMinutes > 10080)) {
    $timeSpentMinutes = null;
  }
  $json = $attachments
    ? json_encode(array_values($attachments), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
    : null;
  ll_pdo()->prepare(
    'INSERT INTO form_comments (task_id, user_id, body, status_at_time, attachments_json, time_spent_minutes)
     VALUES (?, ?, ?, ?, ?, ?)'
  )->execute([$taskId, $userId, $body, $statusAtTime, $json, $timeSpentMinutes]);
}

function ll_tf_log_task_event(
  int $taskId,
  ?int $userId,
  string $type,
  ?string $fromStatus = null,
  ?string $toStatus = null,
  ?string $detail = null
): void {
  if ($taskId < 1 || $type === '') {
    return;
  }
  try {
    ll_pdo()->prepare(
      'INSERT INTO form_task_events (task_id, user_id, event_type, from_status, to_status, detail)
       VALUES (?, ?, ?, ?, ?, ?)'
    )->execute([
      $taskId,
      $userId && $userId > 0 ? $userId : null,
      $type,
      $fromStatus !== '' ? $fromStatus : null,
      $toStatus !== '' ? $toStatus : null,
      $detail !== '' ? $detail : null,
    ]);
  } catch (Throwable $e) {
    /* history must not fail the primary action */
  }
}

/** @return list<array<string,mixed>> */
function ll_tf_load_task_events(int $taskId): array
{
  if ($taskId < 1) {
    return [];
  }
  try {
    $stmt = ll_pdo()->prepare(
      'SELECT e.id, e.task_id, e.user_id, e.event_type, e.from_status, e.to_status, e.detail, e.created_at,
              u.display_name, u.username
       FROM form_task_events e
       LEFT JOIN users u ON u.id = e.user_id
       WHERE e.task_id = ?
       ORDER BY e.created_at ASC, e.id ASC'
    );
    $stmt->execute([$taskId]);
  } catch (Throwable $e) {
    return [];
  }
  $out = [];
  foreach ($stmt->fetchAll() as $row) {
    $out[] = [
      'id' => (int) $row['id'],
      'task_id' => (int) $row['task_id'],
      'user_id' => $row['user_id'] !== null ? (int) $row['user_id'] : null,
      'event_type' => (string) $row['event_type'],
      'from_status' => $row['from_status'] !== null && $row['from_status'] !== '' ? (string) $row['from_status'] : null,
      'to_status' => $row['to_status'] !== null && $row['to_status'] !== '' ? (string) $row['to_status'] : null,
      'detail' => $row['detail'] !== null && $row['detail'] !== '' ? (string) $row['detail'] : null,
      'created_at' => $row['created_at'],
      'display_name' => (string) (($row['display_name'] ?? '') !== '' ? $row['display_name'] : ($row['username'] ?? 'System')),
    ];
  }
  return $out;
}

/** @return list<int> */
function ll_tf_read_reviewer_ids(array $body): array
{
  $raw = $body['reviewer_ids'] ?? $body['reviewers'] ?? null;
  $ids = [];
  if (is_array($raw)) {
    foreach ($raw as $item) {
      if (is_array($item)) {
        $ids[] = (int) ($item['id'] ?? $item['user_id'] ?? 0);
      } else {
        $ids[] = (int) $item;
      }
    }
  }
  $single = (int) ($body['reviewer_id'] ?? 0);
  if ($single > 0) {
    array_unshift($ids, $single);
  }
  $out = [];
  $seen = [];
  foreach ($ids as $id) {
    if ($id < 1 || isset($seen[$id])) {
      continue;
    }
    $seen[$id] = true;
    $out[] = $id;
  }
  return $out;
}

/** @return list<int> */
function ll_tf_task_reviewer_id_list(int $taskId): array
{
  if ($taskId < 1) {
    return [];
  }
  try {
    $stmt = ll_pdo()->prepare('SELECT user_id FROM form_task_reviewers WHERE task_id = ? ORDER BY user_id ASC');
    $stmt->execute([$taskId]);
    return array_values(array_map('intval', $stmt->fetchAll(PDO::FETCH_COLUMN)));
  } catch (Throwable $e) {
    return [];
  }
}

/** @return list<array{id:int,display_name:string}> */
function ll_tf_load_task_reviewers(int $taskId): array
{
  if ($taskId < 1) {
    return [];
  }
  try {
    $stmt = ll_pdo()->prepare(
      'SELECT r.user_id, u.display_name, u.username
       FROM form_task_reviewers r
       INNER JOIN users u ON u.id = r.user_id
       WHERE r.task_id = ?
       ORDER BY u.display_name ASC, u.username ASC'
    );
    $stmt->execute([$taskId]);
  } catch (Throwable $e) {
    return [];
  }
  $out = [];
  foreach ($stmt->fetchAll() as $row) {
    $out[] = [
      'id' => (int) $row['user_id'],
      'display_name' => (string) ($row['display_name'] ?: $row['username']),
    ];
  }
  return $out;
}

/** @param list<int> $reviewerIds */
function ll_tf_replace_task_reviewers(int $taskId, array $reviewerIds): void
{
  if ($taskId < 1) {
    return;
  }
  $pdo = ll_pdo();
  try {
    $pdo->prepare('DELETE FROM form_task_reviewers WHERE task_id = ?')->execute([$taskId]);
    $ins = $pdo->prepare('INSERT INTO form_task_reviewers (task_id, user_id) VALUES (?, ?)');
    foreach ($reviewerIds as $uid) {
      $uid = (int) $uid;
      if ($uid > 0) {
        $ins->execute([$taskId, $uid]);
      }
    }
  } catch (Throwable $e) {
    /* table may be mid-migrate */
  }
  $first = null;
  foreach ($reviewerIds as $uid) {
    $uid = (int) $uid;
    if ($uid > 0) {
      $first = $uid;
      break;
    }
  }
  try {
    $pdo->prepare('UPDATE form_tasks SET reviewer_id = ? WHERE id = ?')->execute([$first, $taskId]);
  } catch (Throwable $e) {
    /* reviewer_id still optional */
  }
}

function ll_tf_user_is_assignee(array $user, array $task): bool
{
  $uid = (int) ($user['id'] ?? 0);
  $aid = (int) ($task['assignee_id'] ?? 0);
  return $uid > 0 && $aid > 0 && $uid === $aid;
}

function ll_tf_user_display_name(?array $user): string
{
  if (!$user) {
    return '';
  }
  $name = trim((string) ($user['display_name'] ?? ''));
  if ($name !== '') {
    return $name;
  }
  return trim((string) ($user['username'] ?? ''));
}

/** Empty is allowed; reject letters / scientific notation / non-finite values. */
function ll_tf_is_valid_number_answer($value): bool
{
  if ($value === null) {
    return true;
  }
  if (!is_scalar($value)) {
    return false;
  }
  $s = trim((string) $value);
  if ($s === '') {
    return true;
  }
  if (!preg_match('/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/', $s)) {
    return false;
  }
  return is_finite((float) $s);
}

function ll_tf_calc_ops(): array
{
  return ['add', 'subtract', 'multiply', 'divide'];
}

/**
 * Create Team Forms tables on first API hit (Hostinger upgrade without reinstall).
 */
function ll_team_forms_ensure_tables(): void
{
  static $done = false;
  if ($done) {
    return;
  }
  $done = true;
  $pdo = ll_pdo();

  $pdo->exec("CREATE TABLE IF NOT EXISTS departments (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    description TEXT NULL,
    created_by INT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_departments_name (name),
    KEY idx_departments_created (created_by),
    CONSTRAINT fk_departments_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

  $pdo->exec("CREATE TABLE IF NOT EXISTS org_groups (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    department_id INT UNSIGNED NOT NULL,
    name VARCHAR(120) NOT NULL,
    description TEXT NULL,
    created_by INT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_org_groups_dept_name (department_id, name),
    KEY idx_org_groups_dept (department_id),
    KEY idx_org_groups_created (created_by),
    CONSTRAINT fk_org_groups_dept FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
    CONSTRAINT fk_org_groups_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

  $pdo->exec("CREATE TABLE IF NOT EXISTS group_members (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    group_id INT UNSIGNED NOT NULL,
    user_id INT UNSIGNED NOT NULL,
    role ENUM('form_creator','reviewer','assignee') NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_group_members_role (group_id, user_id, role),
    KEY idx_group_members_user (user_id),
    CONSTRAINT fk_group_members_group FOREIGN KEY (group_id) REFERENCES org_groups(id) ON DELETE CASCADE,
    CONSTRAINT fk_group_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

  $pdo->exec("CREATE TABLE IF NOT EXISTS form_templates (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    group_id INT UNSIGNED NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT NULL,
    created_by INT UNSIGNED NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_form_templates_group (group_id),
    KEY idx_form_templates_created (created_by),
    CONSTRAINT fk_form_templates_group FOREIGN KEY (group_id) REFERENCES org_groups(id) ON DELETE CASCADE,
    CONSTRAINT fk_form_templates_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

  $pdo->exec("CREATE TABLE IF NOT EXISTS form_fields (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    form_id INT UNSIGNED NOT NULL,
    field_key VARCHAR(80) NOT NULL,
    label VARCHAR(200) NOT NULL,
    field_type VARCHAR(40) NOT NULL,
    options_json JSON NULL,
    readonly_value TEXT NULL,
    calc_op VARCHAR(20) NULL,
    calc_left_field_id INT UNSIGNED NULL,
    calc_right_field_id INT UNSIGNED NULL,
    required TINYINT(1) NOT NULL DEFAULT 0,
    creator_only TINYINT(1) NOT NULL DEFAULT 0,
    sort_order INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_form_fields_key (form_id, field_key),
    KEY idx_form_fields_form (form_id, sort_order),
    CONSTRAINT fk_form_fields_form FOREIGN KEY (form_id) REFERENCES form_templates(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

  $pdo->exec("CREATE TABLE IF NOT EXISTS form_tasks (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    form_id INT UNSIGNED NOT NULL,
    assignee_id INT UNSIGNED NOT NULL,
    assigned_by INT UNSIGNED NULL,
    reviewer_id INT UNSIGNED NULL,
    reviewer_scope ENUM('group','department') NOT NULL DEFAULT 'group',
    status ENUM('pending','in_progress','completed','submitted','approved','rework','closed') NOT NULL DEFAULT 'pending',
    title VARCHAR(200) NULL,
    due_on DATE NULL,
    field_snapshot_json LONGTEXT NULL,
    submitted_at DATETIME NULL,
    approved_at DATETIME NULL,
    closed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_form_tasks_form (form_id),
    KEY idx_form_tasks_assignee (assignee_id, status),
    KEY idx_form_tasks_status (status, updated_at),
    KEY idx_form_tasks_reviewer (reviewer_id),
    CONSTRAINT fk_form_tasks_form FOREIGN KEY (form_id) REFERENCES form_templates(id) ON DELETE CASCADE,
    CONSTRAINT fk_form_tasks_assignee FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_form_tasks_assigned_by FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_form_tasks_reviewer FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

  $pdo->exec("CREATE TABLE IF NOT EXISTS form_answers (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    task_id INT UNSIGNED NOT NULL,
    field_id INT UNSIGNED NOT NULL,
    value_text TEXT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_form_answers_task_field (task_id, field_id),
    KEY idx_form_answers_field (field_id),
    CONSTRAINT fk_form_answers_task FOREIGN KEY (task_id) REFERENCES form_tasks(id) ON DELETE CASCADE,
    CONSTRAINT fk_form_answers_field FOREIGN KEY (field_id) REFERENCES form_fields(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

  $pdo->exec("CREATE TABLE IF NOT EXISTS form_comments (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    task_id INT UNSIGNED NOT NULL,
    user_id INT UNSIGNED NOT NULL,
    body TEXT NOT NULL,
    status_at_time VARCHAR(40) NULL,
    attachments_json LONGTEXT NULL,
    time_spent_minutes INT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_form_comments_task (task_id, created_at),
    CONSTRAINT fk_form_comments_task FOREIGN KEY (task_id) REFERENCES form_tasks(id) ON DELETE CASCADE,
    CONSTRAINT fk_form_comments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

  ll_tf_ensure_comment_schema($pdo);
  ll_tf_ensure_task_instance_schema($pdo);
  ll_tf_ensure_completed_status($pdo);
  ll_tf_ensure_task_events_schema($pdo);
  ll_tf_ensure_task_reviewers_schema($pdo);
  ll_tf_ensure_field_creator_only_schema($pdo);
}

/** Per-field: only Form Creator / Task Builder can edit answers when set. */
function ll_tf_ensure_field_creator_only_schema(PDO $pdo): void
{
  try {
    $has = $pdo->query("SHOW COLUMNS FROM form_fields LIKE 'creator_only'")->fetch();
    if (!$has) {
      $pdo->exec(
        'ALTER TABLE form_fields
         ADD COLUMN creator_only TINYINT(1) NOT NULL DEFAULT 0 AFTER required'
      );
    }
  } catch (Throwable $e) {
    /* concurrent migrate */
  }
  try {
    $pdo->exec(
      "UPDATE form_fields SET creator_only = 1
       WHERE field_type IN ('assign_to','status','reviewer')
          OR field_key LIKE 'sys\\_%'"
    );
  } catch (Throwable $e) {
    /* best-effort backfill */
  }
}

/**
 * Templates may spawn many task instances for the same assignee.
 * Snapshot field defs onto each task; drop the old one-open-per-form+assignee unique.
 */
function ll_tf_ensure_task_instance_schema(PDO $pdo): void
{
  try {
    $idx = $pdo->query("SHOW INDEX FROM form_tasks WHERE Key_name = 'uq_form_tasks_open_assignee'")->fetch();
    if ($idx) {
      $pdo->exec('ALTER TABLE form_tasks DROP INDEX uq_form_tasks_open_assignee');
    }
  } catch (Throwable $e) {
    /* index may already be gone */
  }
  try {
    $col = $pdo->query("SHOW COLUMNS FROM form_tasks LIKE 'open_assignee_guard'")->fetch();
    if ($col) {
      $pdo->exec('ALTER TABLE form_tasks DROP COLUMN open_assignee_guard');
    }
  } catch (Throwable $e) {
    /* generated column may already be gone */
  }
  $add = [
    'title' => 'VARCHAR(200) NULL',
    'due_on' => 'DATE NULL',
    'field_snapshot_json' => 'LONGTEXT NULL',
    'reviewer_id' => 'INT UNSIGNED NULL',
  ];
  foreach ($add as $name => $ddl) {
    try {
      $has = $pdo->query("SHOW COLUMNS FROM form_tasks LIKE " . $pdo->quote($name))->fetch();
      if (!$has) {
        $pdo->exec("ALTER TABLE form_tasks ADD COLUMN `$name` $ddl");
      }
    } catch (Throwable $e) {
      /* concurrent migrate */
    }
  }
  try {
    $fk = $pdo->query(
      "SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'form_answers'
         AND CONSTRAINT_NAME = 'fk_form_answers_field'
         AND CONSTRAINT_TYPE = 'FOREIGN KEY'
       LIMIT 1"
    )->fetch();
    if ($fk) {
      $pdo->exec('ALTER TABLE form_answers DROP FOREIGN KEY fk_form_answers_field');
    }
  } catch (Throwable $e) {
    /* answers stay keyed by snapshot field id even if template field is later deleted */
  }
  try {
    $revFk = $pdo->query(
      "SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'form_tasks'
         AND CONSTRAINT_NAME = 'fk_form_tasks_reviewer'
         AND CONSTRAINT_TYPE = 'FOREIGN KEY'
       LIMIT 1"
    )->fetch();
    if (!$revFk) {
      $hasRev = $pdo->query("SHOW COLUMNS FROM form_tasks LIKE 'reviewer_id'")->fetch();
      if ($hasRev) {
        $pdo->exec(
          'ALTER TABLE form_tasks
           ADD CONSTRAINT fk_form_tasks_reviewer FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE SET NULL'
        );
      }
    }
  } catch (Throwable $e) {
    /* reviewer_id still usable without FK */
  }
  try {
    ll_tf_backfill_task_field_snapshots($pdo);
  } catch (Throwable $e) {
    /* first-hit migrate should not block the module */
  }
  ll_tf_ensure_draft_assignee_nullable($pdo);
}

/** Draft tasks exist before Assign To is chosen. */
function ll_tf_ensure_draft_assignee_nullable(PDO $pdo): void
{
  try {
    $col = $pdo->query("SHOW COLUMNS FROM form_tasks LIKE 'assignee_id'")->fetch();
    if (!$col || strtoupper((string) ($col['Null'] ?? '')) === 'YES') {
      return;
    }
    try {
      $pdo->exec('ALTER TABLE form_tasks DROP FOREIGN KEY fk_form_tasks_assignee');
    } catch (Throwable $e) {
      /* constraint name may differ */
    }
    $pdo->exec('ALTER TABLE form_tasks MODIFY assignee_id INT UNSIGNED NULL');
    try {
      $pdo->exec(
        'ALTER TABLE form_tasks
         ADD CONSTRAINT fk_form_tasks_assignee FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE CASCADE'
      );
    } catch (Throwable $e) {
      /* column is usable without the FK */
    }
  } catch (Throwable $e) {
    /* first-hit migrate should not block the module */
  }
}

function ll_tf_ensure_completed_status(PDO $pdo): void
{
  try {
    $col = $pdo->query("SHOW COLUMNS FROM form_tasks LIKE 'status'")->fetch();
    if (!$col) {
      return;
    }
    $type = strtolower((string) ($col['Type'] ?? ''));
    if (str_contains($type, "'completed'")) {
      return;
    }
    if (str_starts_with($type, 'enum(')) {
      $pdo->exec(
        "ALTER TABLE form_tasks MODIFY status ENUM('pending','in_progress','completed','submitted','approved','rework','closed') NOT NULL DEFAULT 'pending'"
      );
    }
  } catch (Throwable $e) {
    /* concurrent migrate */
  }
}

function ll_tf_ensure_task_events_schema(PDO $pdo): void
{
  try {
    $pdo->exec(
      "CREATE TABLE IF NOT EXISTS form_task_events (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        task_id INT UNSIGNED NOT NULL,
        user_id INT UNSIGNED NULL,
        event_type VARCHAR(40) NOT NULL,
        from_status VARCHAR(40) NULL,
        to_status VARCHAR(40) NULL,
        detail VARCHAR(255) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_form_task_events_task (task_id, created_at, id),
        CONSTRAINT fk_form_task_events_task FOREIGN KEY (task_id) REFERENCES form_tasks(id) ON DELETE CASCADE,
        CONSTRAINT fk_form_task_events_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
  } catch (Throwable $e) {
    /* concurrent migrate */
  }
}

function ll_tf_ensure_task_reviewers_schema(PDO $pdo): void
{
  try {
    $pdo->exec(
      "CREATE TABLE IF NOT EXISTS form_task_reviewers (
        task_id INT UNSIGNED NOT NULL,
        user_id INT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (task_id, user_id),
        KEY idx_form_task_reviewers_user (user_id),
        CONSTRAINT fk_form_task_reviewers_task FOREIGN KEY (task_id) REFERENCES form_tasks(id) ON DELETE CASCADE,
        CONSTRAINT fk_form_task_reviewers_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
  } catch (Throwable $e) {
    /* concurrent migrate */
  }
  try {
    $pdo->exec(
      'INSERT IGNORE INTO form_task_reviewers (task_id, user_id)
       SELECT id, reviewer_id FROM form_tasks
       WHERE reviewer_id IS NOT NULL AND reviewer_id > 0'
    );
  } catch (Throwable $e) {
    /* backfill is best-effort */
  }
}

function ll_tf_fields_snapshot(array $fields): array
{
  $out = [];
  foreach ($fields as $f) {
    $out[] = [
      'id' => (int) ($f['id'] ?? 0),
      'form_id' => (int) ($f['form_id'] ?? 0),
      'field_key' => (string) ($f['field_key'] ?? ''),
      'label' => (string) ($f['label'] ?? ''),
      'field_type' => (string) ($f['field_type'] ?? 'text'),
      'options' => is_array($f['options'] ?? null) ? array_values($f['options']) : [],
      'readonly_value' => $f['readonly_value'] ?? null,
      'calc_op' => $f['calc_op'] ?? null,
      'calc_left_field_id' => isset($f['calc_left_field_id']) ? (int) $f['calc_left_field_id'] : null,
      'calc_right_field_id' => isset($f['calc_right_field_id']) ? (int) $f['calc_right_field_id'] : null,
      'required' => !empty($f['required']),
      'creator_only' => ll_tf_field_is_creator_only($f),
      'is_system' => ll_tf_is_system_field($f),
      'sort_order' => (int) ($f['sort_order'] ?? 0),
    ];
  }
  return $out;
}

function ll_tf_fields_from_snapshot($raw): array
{
  if (is_array($raw)) {
    $decoded = $raw;
  } else {
    $decoded = json_decode((string) $raw, true);
  }
  if (!is_array($decoded) || !$decoded) {
    return [];
  }
  $fields = [];
  foreach ($decoded as $f) {
    if (!is_array($f) || (int) ($f['id'] ?? 0) < 1) {
      continue;
    }
    $fields[] = [
      'id' => (int) $f['id'],
      'form_id' => (int) ($f['form_id'] ?? 0),
      'field_key' => (string) ($f['field_key'] ?? ''),
      'label' => (string) ($f['label'] ?? ''),
      'field_type' => (string) ($f['field_type'] ?? 'text'),
      'options' => is_array($f['options'] ?? null) ? array_values($f['options']) : [],
      'readonly_value' => array_key_exists('readonly_value', $f) && $f['readonly_value'] !== null
        ? (string) $f['readonly_value'] : null,
      'calc_op' => !empty($f['calc_op']) ? (string) $f['calc_op'] : null,
      'calc_left_field_id' => !empty($f['calc_left_field_id']) ? (int) $f['calc_left_field_id'] : null,
      'calc_right_field_id' => !empty($f['calc_right_field_id']) ? (int) $f['calc_right_field_id'] : null,
      'required' => !empty($f['required']),
      'creator_only' => !empty($f['creator_only']),
      'sort_order' => (int) ($f['sort_order'] ?? 0),
    ];
    $fields[array_key_last($fields)]['is_system'] = ll_tf_is_system_field($fields[array_key_last($fields)]);
    if ($fields[array_key_last($fields)]['is_system']) {
      $fields[array_key_last($fields)]['creator_only'] = true;
    }
  }
  usort($fields, static fn ($a, $b) => ($a['sort_order'] <=> $b['sort_order']) ?: ($a['id'] <=> $b['id']));
  return $fields;
}

function ll_tf_backfill_task_field_snapshots(PDO $pdo): void
{
  $has = $pdo->query("SHOW COLUMNS FROM form_tasks LIKE 'field_snapshot_json'")->fetch();
  if (!$has) {
    return;
  }
  $rows = $pdo->query(
    "SELECT id, form_id FROM form_tasks
     WHERE field_snapshot_json IS NULL OR field_snapshot_json = ''"
  )->fetchAll();
  if (!$rows) {
    return;
  }
  $cache = [];
  $upd = $pdo->prepare('UPDATE form_tasks SET field_snapshot_json = ? WHERE id = ?');
  $load = $pdo->prepare('SELECT * FROM form_fields WHERE form_id = ? ORDER BY sort_order ASC, id ASC');
  foreach ($rows as $row) {
    $formId = (int) $row['form_id'];
    if (!isset($cache[$formId])) {
      $load->execute([$formId]);
      $cache[$formId] = ll_tf_fields_snapshot(array_map('ll_tf_row_field', $load->fetchAll()));
    }
    $upd->execute([
      json_encode($cache[$formId], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
      (int) $row['id'],
    ]);
  }
}

function ll_tf_task_display_title(?string $taskTitle, ?string $templateTitle): string
{
  $custom = trim((string) $taskTitle);
  if ($custom !== '') {
    return $custom;
  }
  return trim((string) $templateTitle);
}

function ll_tf_can_manage_org(array $user): bool
{
  return !empty($user['is_super']) || ll_user_has_permission($user, 'team_forms.manage_org');
}

/** Form creator of this task instance, template created_by, or super. */
function ll_tf_is_task_form_creator(array $user, array $task): bool
{
  if (!empty($user['is_super'])) {
    return true;
  }
  $uid = (int) ($user['id'] ?? 0);
  if ($uid < 1) {
    return false;
  }
  $assignedBy = (int) ($task['assigned_by'] ?? 0);
  if ($assignedBy > 0 && $uid === $assignedBy) {
    return true;
  }
  $createdBy = (int) ($task['form_created_by'] ?? 0);
  if ($createdBy > 0 && $uid === $createdBy) {
    return true;
  }
  return false;
}

function ll_tf_can_edit_task_answers(array $user, array $task): bool
{
  if (in_array((string) ($task['status'] ?? ''), ['approved', 'closed'], true)) {
    return false;
  }
  if (ll_tf_is_task_form_creator($user, $task)) {
    return true;
  }
  return ll_tf_user_is_assignee($user, $task);
}

/** System fields and creator_only custom fields are Task Builder / creator-editable only. */
function ll_tf_field_is_creator_only(array $f): bool
{
  if (ll_tf_is_system_field($f)) {
    return true;
  }
  return !empty($f['creator_only']);
}

function ll_tf_can_edit_field_answer(array $user, array $task, array $f): bool
{
  if (in_array((string) ($task['status'] ?? ''), ['approved', 'closed'], true)) {
    return false;
  }
  $type = (string) ($f['field_type'] ?? '');
  if (in_array($type, ['readonly', 'calculated', 'assign_to', 'status', 'reviewer'], true)) {
    return false;
  }
  if (ll_tf_is_task_form_creator($user, $task)) {
    return true;
  }
  if (ll_tf_user_is_assignee($user, $task)) {
    return !ll_tf_field_is_creator_only($f);
  }
  return false;
}

function ll_tf_can_delete_task(array $user, array $task): bool
{
  if (!empty($user['is_super']) || ll_tf_can_manage_org($user)) {
    return true;
  }
  $uid = (int) ($user['id'] ?? 0);
  $assignedBy = (int) ($task['assigned_by'] ?? 0);
  return $uid > 0 && $assignedBy > 0 && $uid === $assignedBy;
}

function ll_tf_delete_task_cascade(int $taskId): void
{
  if ($taskId < 1) {
    return;
  }
  $pdo = ll_pdo();
  ll_tf_doc_delete_task_dir($taskId);
  $pdo->prepare('DELETE FROM form_answers WHERE task_id = ?')->execute([$taskId]);
  $pdo->prepare('DELETE FROM form_comments WHERE task_id = ?')->execute([$taskId]);
  try {
    $pdo->prepare('DELETE FROM form_task_events WHERE task_id = ?')->execute([$taskId]);
  } catch (Throwable $e) {
    /* table may not exist yet */
  }
  try {
    $pdo->prepare('DELETE FROM form_task_reviewers WHERE task_id = ?')->execute([$taskId]);
  } catch (Throwable $e) {
    /* table may not exist yet */
  }
  $pdo->prepare('DELETE FROM form_tasks WHERE id = ?')->execute([$taskId]);
}

function ll_tf_can_set_task_status(array $user, array $task): bool
{
  if (in_array((string) ($task['status'] ?? ''), ['submitted', 'approved', 'closed'], true)) {
    return false;
  }
  if (!empty($user['is_super'])) {
    return true;
  }
  $uid = (int) ($user['id'] ?? 0);
  $assigneeId = (int) ($task['assignee_id'] ?? 0);
  if ($assigneeId > 0 && $uid === $assigneeId) {
    return true;
  }
  return ll_tf_is_task_form_creator($user, $task);
}

function ll_tf_require_module(array $user): void
{
  if (
    !ll_user_has_permission($user, 'module.team_forms')
    && !ll_user_has_permission($user, 'team_forms.use')
    && empty($user['is_super'])
  ) {
    ll_error('Forbidden', 403);
  }
}

/** @return list<string> */
function ll_user_group_roles(int $userId, int $groupId): array
{
  ll_team_forms_ensure_tables();
  $stmt = ll_pdo()->prepare(
    'SELECT role FROM group_members WHERE user_id = ? AND group_id = ?'
  );
  $stmt->execute([$userId, $groupId]);
  return array_values(array_map('strval', $stmt->fetchAll(PDO::FETCH_COLUMN)));
}

function ll_tf_user_has_group_role(int $userId, int $groupId, string $role): bool
{
  return in_array($role, ll_user_group_roles($userId, $groupId), true);
}

/**
 * Compact memberships for auth/me.
 * @return list<array{department_id:int,department_name:string,group_id:int,group_name:string,roles:list<string>}>
 */
function ll_tf_org_memberships(int $userId): array
{
  try {
    ll_team_forms_ensure_tables();
  } catch (Throwable $e) {
    return [];
  }
  $stmt = ll_pdo()->prepare(
    'SELECT g.id AS group_id, g.name AS group_name,
            d.id AS department_id, d.name AS department_name,
            gm.role
     FROM group_members gm
     INNER JOIN org_groups g ON g.id = gm.group_id
     INNER JOIN departments d ON d.id = g.department_id
     WHERE gm.user_id = ?
     ORDER BY d.name ASC, g.name ASC, gm.role ASC'
  );
  $stmt->execute([$userId]);
  $byGroup = [];
  foreach ($stmt->fetchAll() as $row) {
    $gid = (int) $row['group_id'];
    if (!isset($byGroup[$gid])) {
      $byGroup[$gid] = [
        'department_id' => (int) $row['department_id'],
        'department_name' => (string) $row['department_name'],
        'group_id' => $gid,
        'group_name' => (string) $row['group_name'],
        'roles' => [],
      ];
    }
    $byGroup[$gid]['roles'][] = (string) $row['role'];
  }
  return array_values($byGroup);
}

/**
 * @param list<array{department_id?:int,group_id?:int}> $memberships
 * @return array{department_ids:list<int>,group_ids:list<int>}
 */
function ll_tf_org_ids_from_memberships(array $memberships): array
{
  $groupIds = [];
  $deptIds = [];
  foreach ($memberships as $m) {
    $gid = (int) ($m['group_id'] ?? 0);
    $did = (int) ($m['department_id'] ?? 0);
    if ($gid > 0) {
      $groupIds[$gid] = true;
    }
    if ($did > 0) {
      $deptIds[$did] = true;
    }
  }
  return [
    'department_ids' => array_map('intval', array_keys($deptIds)),
    'group_ids' => array_map('intval', array_keys($groupIds)),
  ];
}

/**
 * Batch department/group ids for Admin user list.
 * @param list<int> $userIds
 * @return array<int,array{department_ids:list<int>,group_ids:list<int>}>
 */
function ll_tf_org_ids_map_for_users(array $userIds): array
{
  $out = [];
  $ids = [];
  foreach ($userIds as $uid) {
    $id = (int) $uid;
    if ($id > 0) {
      $ids[$id] = true;
      $out[$id] = ['department_ids' => [], 'group_ids' => []];
    }
  }
  $ids = array_map('intval', array_keys($ids));
  if (!$ids) {
    return $out;
  }
  try {
    ll_team_forms_ensure_tables();
  } catch (Throwable $e) {
    return $out;
  }
  $placeholders = implode(',', array_fill(0, count($ids), '?'));
  $stmt = ll_pdo()->prepare(
    "SELECT gm.user_id, gm.group_id, g.department_id
     FROM group_members gm
     INNER JOIN org_groups g ON g.id = gm.group_id
     WHERE gm.user_id IN ($placeholders)"
  );
  $stmt->execute($ids);
  $groups = [];
  $depts = [];
  foreach ($stmt->fetchAll() as $row) {
    $uid = (int) $row['user_id'];
    $groups[$uid][(int) $row['group_id']] = true;
    $depts[$uid][(int) $row['department_id']] = true;
  }
  foreach ($ids as $uid) {
    $out[$uid] = [
      'department_ids' => array_map('intval', array_keys($depts[$uid] ?? [])),
      'group_ids' => array_map('intval', array_keys($groups[$uid] ?? [])),
    ];
  }
  return $out;
}

/** @return array{departments:list<array>,groups:list<array>} */
function ll_tf_org_catalog(): array
{
  ll_team_forms_ensure_tables();
  $pdo = ll_pdo();
  $depts = $pdo->query(
    'SELECT id, name, description, created_by, created_at, updated_at
     FROM departments ORDER BY name ASC'
  )->fetchAll();
  $groups = $pdo->query(
    'SELECT g.*, d.name AS department_name
     FROM org_groups g INNER JOIN departments d ON d.id = g.department_id
     ORDER BY d.name ASC, g.name ASC'
  )->fetchAll();
  return [
    'departments' => array_map('ll_tf_row_department', $depts),
    'groups' => array_map('ll_tf_row_group', $groups),
  ];
}

/**
 * Normalize and validate group_ids from Admin user save.
 * @return list<int>
 */
function ll_tf_normalize_group_ids(mixed $raw): array
{
  if (!is_array($raw)) {
    ll_error('group_ids must be an array');
  }
  $ids = [];
  foreach ($raw as $v) {
    $id = (int) $v;
    if ($id > 0) {
      $ids[$id] = true;
    }
  }
  $wanted = array_map('intval', array_keys($ids));
  if (!$wanted) {
    return [];
  }
  ll_team_forms_ensure_tables();
  $placeholders = implode(',', array_fill(0, count($wanted), '?'));
  $stmt = ll_pdo()->prepare("SELECT id FROM org_groups WHERE id IN ($placeholders)");
  $stmt->execute($wanted);
  $found = array_map('intval', $stmt->fetchAll(PDO::FETCH_COLUMN));
  if (count($found) !== count($wanted)) {
    ll_error('One or more groups were not found');
  }
  return $wanted;
}

/**
 * Checkbox semantics: member of this group.
 * New membership → assignee only. Kept groups retain form_creator/reviewer.
 * Unchecked groups → delete all group_members rows for that user+group.
 * @param list<int> $groupIds
 */
function ll_tf_sync_user_group_memberships(int $userId, array $groupIds): void
{
  ll_team_forms_ensure_tables();
  $pdo = ll_pdo();
  $wanted = [];
  foreach ($groupIds as $gid) {
    $id = (int) $gid;
    if ($id > 0) {
      $wanted[$id] = true;
    }
  }
  $wantedIds = array_map('intval', array_keys($wanted));

  $stmt = $pdo->prepare('SELECT DISTINCT group_id FROM group_members WHERE user_id = ?');
  $stmt->execute([$userId]);
  $existing = array_map('intval', $stmt->fetchAll(PDO::FETCH_COLUMN));
  $wantedSet = array_flip($wantedIds);

  $del = $pdo->prepare('DELETE FROM group_members WHERE user_id = ? AND group_id = ?');
  foreach ($existing as $gid) {
    if (!isset($wantedSet[$gid])) {
      $del->execute([$userId, $gid]);
    }
  }

  $chk = $pdo->prepare('SELECT id FROM group_members WHERE user_id = ? AND group_id = ? LIMIT 1');
  $ins = $pdo->prepare(
    'INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, \'assignee\')'
  );
  foreach ($wantedIds as $gid) {
    $chk->execute([$userId, $gid]);
    if ($chk->fetch()) {
      continue;
    }
    try {
      $ins->execute([$gid, $userId]);
    } catch (PDOException $e) {
      // Unique race: already a member.
    }
  }
}

function ll_tf_slug_key(string $label, string $fallback = 'field'): string
{
  $key = strtolower(trim($label));
  $key = preg_replace('/[^a-z0-9]+/', '_', $key) ?? '';
  $key = trim($key, '_');
  if ($key === '') {
    $key = $fallback;
  }
  return substr($key, 0, 60);
}

/** Allocate a unique, stable field_key for a form (label slug + short random suffix). */
function ll_tf_allocate_field_key(\PDO $pdo, int $formId, string $label, string $preferred = ''): string
{
  $base = $preferred !== '' ? ll_tf_slug_key($preferred) : ll_tf_slug_key($label);
  $chk = $pdo->prepare('SELECT id FROM form_fields WHERE form_id = ? AND field_key = ?');
  for ($i = 0; $i < 16; $i++) {
    $suffix = bin2hex(random_bytes(3));
    $key = substr($base, 0, 72) . '_' . $suffix;
    $key = substr($key, 0, 80);
    $chk->execute([$formId, $key]);
    if (!$chk->fetch()) {
      return $key;
    }
  }
  $fallback = 'f_' . bin2hex(random_bytes(8));
  $chk->execute([$formId, $fallback]);
  if (!$chk->fetch()) {
    return $fallback;
  }
  return 'f_' . bin2hex(random_bytes(10));
}

function ll_tf_eval_calc(string $op, $left, $right): ?string
{
  if ($left === null || $left === '' || $right === null || $right === '') {
    return null;
  }
  if (!is_numeric($left) || !is_numeric($right)) {
    return null;
  }
  $a = (float) $left;
  $b = (float) $right;
  $result = match ($op) {
    'add' => $a + $b,
    'subtract' => $a - $b,
    'multiply' => $a * $b,
    'divide' => $b == 0.0 ? null : $a / $b,
    default => null,
  };
  if ($result === null) {
    return null;
  }
  if (is_finite($result) === false) {
    return null;
  }
  // Trim trailing zeros for clean display.
  $formatted = rtrim(rtrim(sprintf('%.8F', $result), '0'), '.');
  return $formatted === '-0' ? '0' : $formatted;
}

/**
 * @param list<array> $fields
 * @param array<int,string|null> $answersByFieldId
 * @return array<int,string|null>
 */
function ll_tf_apply_calculated(array $fields, array $answersByFieldId): array
{
  $byId = [];
  foreach ($fields as $f) {
    $byId[(int) $f['id']] = $f;
  }
  // Multi-pass so calculated fields depending on other calculated fields resolve.
  for ($pass = 0; $pass < 8; $pass++) {
    $changed = false;
    foreach ($fields as $f) {
      if (($f['field_type'] ?? '') !== 'calculated') {
        continue;
      }
      $fid = (int) $f['id'];
      $leftId = (int) ($f['calc_left_field_id'] ?? 0);
      $rightId = (int) ($f['calc_right_field_id'] ?? 0);
      $op = (string) ($f['calc_op'] ?? '');
      $leftVal = $answersByFieldId[$leftId] ?? null;
      $rightVal = $answersByFieldId[$rightId] ?? null;
      if (($byId[$leftId]['field_type'] ?? '') === 'readonly') {
        $leftVal = $byId[$leftId]['readonly_value'] ?? $leftVal;
      }
      if (($byId[$rightId]['field_type'] ?? '') === 'readonly') {
        $rightVal = $byId[$rightId]['readonly_value'] ?? $rightVal;
      }
      $computed = ll_tf_eval_calc($op, $leftVal, $rightVal);
      $prev = $answersByFieldId[$fid] ?? null;
      if ($computed !== $prev) {
        $answersByFieldId[$fid] = $computed;
        $changed = true;
      }
    }
    if (!$changed) {
      break;
    }
  }
  return $answersByFieldId;
}

function ll_tf_row_department(array $row): array
{
  return [
    'id' => (int) $row['id'],
    'name' => (string) $row['name'],
    'description' => $row['description'] !== null ? (string) $row['description'] : null,
    'created_by' => $row['created_by'] !== null ? (int) $row['created_by'] : null,
    'created_at' => $row['created_at'] ?? null,
    'updated_at' => $row['updated_at'] ?? null,
  ];
}

function ll_tf_row_group(array $row): array
{
  return [
    'id' => (int) $row['id'],
    'department_id' => (int) $row['department_id'],
    'department_name' => isset($row['department_name']) ? (string) $row['department_name'] : null,
    'name' => (string) $row['name'],
    'description' => $row['description'] !== null ? (string) $row['description'] : null,
    'created_by' => $row['created_by'] !== null ? (int) $row['created_by'] : null,
    'created_at' => $row['created_at'] ?? null,
    'updated_at' => $row['updated_at'] ?? null,
  ];
}

function ll_tf_row_field(array $row): array
{
  $options = $row['options_json'] ?? null;
  if (is_string($options)) {
    $decoded = json_decode($options, true);
    $options = is_array($decoded) ? $decoded : [];
  } elseif (!is_array($options)) {
    $options = [];
  }
  $out = [
    'id' => (int) $row['id'],
    'form_id' => (int) $row['form_id'],
    'field_key' => (string) $row['field_key'],
    'label' => (string) $row['label'],
    'field_type' => (string) $row['field_type'],
    'options' => $options,
    'readonly_value' => $row['readonly_value'] !== null ? (string) $row['readonly_value'] : null,
    'calc_op' => $row['calc_op'] !== null ? (string) $row['calc_op'] : null,
    'calc_left_field_id' => $row['calc_left_field_id'] !== null ? (int) $row['calc_left_field_id'] : null,
    'calc_right_field_id' => $row['calc_right_field_id'] !== null ? (int) $row['calc_right_field_id'] : null,
    'required' => (int) ($row['required'] ?? 0) === 1,
    'creator_only' => (int) ($row['creator_only'] ?? 0) === 1,
    'sort_order' => (int) ($row['sort_order'] ?? 0),
  ];
  $out['is_system'] = ll_tf_is_system_field($out);
  if ($out['is_system']) {
    $out['creator_only'] = true;
  }
  return $out;
}

function ll_tf_progress(array $fields, array $answersByFieldId): array
{
  $writable = 0;
  $filled = 0;
  foreach ($fields as $f) {
    $type = $f['field_type'] ?? '';
    if ($type === 'readonly' || $type === 'calculated' || ll_tf_is_system_field($f)) {
      continue;
    }
    $writable++;
    $val = $answersByFieldId[(int) $f['id']] ?? null;
    if ($val !== null && trim((string) $val) !== '') {
      $filled++;
    }
  }
  $pct = $writable > 0 ? (int) round(($filled / $writable) * 100) : 0;
  return ['filled' => $filled, 'total' => $writable, 'percent' => $pct];
}

/**
 * Reviewers who can see this task on the review board (group or department scope).
 *
 * @return list<int>
 */
function ll_tf_reviewer_user_ids_for_task(array $task): array
{
  $taskId = (int) ($task['id'] ?? 0);
  $fromTable = $taskId > 0 ? ll_tf_task_reviewer_id_list($taskId) : [];
  if ($fromTable) {
    return $fromTable;
  }
  $fromPayload = $task['reviewer_ids'] ?? null;
  if (is_array($fromPayload) && $fromPayload) {
    $ids = [];
    foreach ($fromPayload as $id) {
      $id = (int) $id;
      if ($id > 0) {
        $ids[] = $id;
      }
    }
    if ($ids) {
      return array_values(array_unique($ids));
    }
  }
  $designated = (int) ($task['reviewer_id'] ?? 0);
  if ($designated > 0) {
    return [$designated];
  }
  $scope = (string) ($task['reviewer_scope'] ?? 'group');
  $groupId = (int) ($task['group_id'] ?? 0);
  $deptId = (int) ($task['department_id'] ?? 0);
  $pdo = ll_pdo();
  if ($scope === 'department' && $deptId > 0) {
    $stmt = $pdo->prepare(
      'SELECT DISTINCT gm.user_id
       FROM group_members gm
       INNER JOIN org_groups g ON g.id = gm.group_id
       INNER JOIN users u ON u.id = gm.user_id
       WHERE gm.role = \'reviewer\' AND g.department_id = ? AND u.is_active = 1'
    );
    $stmt->execute([$deptId]);
  } else {
    $stmt = $pdo->prepare(
      'SELECT DISTINCT gm.user_id
       FROM group_members gm
       INNER JOIN users u ON u.id = gm.user_id
       WHERE gm.role = \'reviewer\' AND gm.group_id = ? AND u.is_active = 1'
    );
    $stmt->execute([$groupId]);
  }
  $ids = [];
  foreach ($stmt->fetchAll() as $row) {
    $ids[] = (int) $row['user_id'];
  }
  return $ids;
}

/**
 * In-app notifications when an assignee marks a task completed (submitted).
 * Recipients: scoped reviewers + form template creator. Never the assignee.
 */
function ll_tf_notify_task_completed(array $task, array $actor): void
{
  $assigneeId = (int) ($task['assignee_id'] ?? 0);
  $actorId = (int) ($actor['id'] ?? 0);
  $recipients = [];

  foreach (ll_tf_reviewer_user_ids_for_task($task) as $uid) {
    if ($uid > 0) {
      $recipients[$uid] = true;
    }
  }

  $createdBy = (int) ($task['form_created_by'] ?? 0);
  if ($createdBy > 0) {
    $creator = ll_find_user_by_id($createdBy);
    if ($creator && (int) ($creator['is_active'] ?? 0) === 1) {
      $recipients[$createdBy] = true;
    }
  }

  unset($recipients[$assigneeId], $recipients[$actorId]);
  if (!$recipients) {
    return;
  }

  $formTitle = trim((string) ($task['form_title'] ?? ''));
  if ($formTitle === '') {
    $formTitle = 'a team form';
  }
  $assigneeName = trim((string) ($task['assignee_name'] ?? ''));
  if ($assigneeName === '') {
    $assigneeName = 'An assignee';
  }
  $title = 'Team form completed';
  $body = $assigneeName . ' marked "' . $formTitle . '" completed';
  $meta = json_encode([
    'kind' => 'task_completed',
    'task_id' => (int) ($task['id'] ?? 0),
    'form_id' => (int) ($task['form_id'] ?? 0),
    'assignee_id' => $assigneeId,
  ], JSON_UNESCAPED_UNICODE);

  $ins = ll_pdo()->prepare(
    'INSERT INTO notifications (user_id, type, title, body, meta, is_read)
     VALUES (?, \'team_forms_task\', ?, ?, ?, 0)'
  );
  foreach (array_keys($recipients) as $uid) {
    $ins->execute([$uid, $title, $body, $meta]);
  }
}

<?php

declare(strict_types=1);

require_once __DIR__ . '/../lib/erp-sync.php';

/**
 * Terminal Bucket 1 (no session, no cron secret):
 *   POST audit/upload  multipart: username, password, file (.xlsx), optional batch_size, concurrency
 * Parses the first sheet, audits with saved audit_settings + server OpenAI key, then publishes
 * TeleCaller dashboards. Responds once the audit has started; the server finishes via the
 * one-time self-chain continue.
 */
function ll_route_audit(string $action): void
{
  switch ($action) {
    case 'upload':
      ll_audit_route_upload();
      break;
    default:
      ll_error('Not found', 404);
  }
}

function ll_audit_route_upload(): void
{
  ll_require_method('POST');
  if (!$_POST && !$_FILES && (int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 0) {
    ll_error('Request is larger than the server limit (' . (string) ini_get('post_max_size') . ')', 413);
  }
  $user = ll_audit_upload_authenticate();

  if (!ll_openai_key_configured()) {
    ll_error('Server OpenAI API key is not configured — a Super User must save it in Settings', 503);
  }

  $settings = ll_erp_sync_audit_settings();
  $savedRow = ll_setting_get('audit_settings');
  $saved = $savedRow && $savedRow['setting_value'] ? json_decode((string) $savedRow['setting_value'], true) : null;
  $saved = is_array($saved) ? $saved : [];
  $batchSize = ll_audit_upload_int_field(
    'batch_size',
    (int) ($saved['batchSize'] ?? 0) ?: LL_AUDIT_UPLOAD_DEFAULT_BATCH,
    LL_AUDIT_UPLOAD_MAX_BATCH
  );
  $concurrency = ll_audit_upload_int_field(
    'concurrency',
    (int) ($saved['concurrency'] ?? 0) ?: LL_AUDIT_UPLOAD_DEFAULT_CONCURRENCY,
    LL_AUDIT_UPLOAD_MAX_CONCURRENCY
  );

  $busy = ll_audit_upload_busy_response(ll_erp_sync_load_job());
  if ($busy !== null) {
    ll_error('Another Bucket 1 server audit is already running — try again when it finishes', 409, $busy);
  }

  [$binary, $sourceFile] = ll_audit_upload_read_file();
  $cfg = ll_erp_sync_load_config();
  $fieldMap = (array) ($cfg['field_map'] ?? ll_erp_sync_default_field_map());
  try {
    $rows = ll_erp_sync_parse_xlsx_rows($binary, $fieldMap);
  } catch (Throwable $e) {
    ll_error('Could not read the workbook: ' . $e->getMessage(), 400);
  }
  unset($binary);
  if (!$rows) {
    ll_error('The first sheet has no data rows', 400);
  }

  $mapped = ll_erp_sync_map_to_leads($rows, $fieldMap);
  if (!empty($mapped['missing_required'])) {
    ll_error('Missing required column(s): ' . implode(', ', $mapped['missing_required']), 400, [
      'mapped_columns' => $mapped['mapped_columns'],
    ]);
  }
  if (!$mapped['leads']) {
    ll_error('No leads found — every row needs a valid Mobile and Project', 400);
  }

  $start = ll_erp_sync_start_upload_job($user, $mapped, $sourceFile, $batchSize, $concurrency);
  if (!empty($start['busy'])) {
    ll_error(
      'Another Bucket 1 server audit is already running — try again when it finishes',
      409,
      ll_audit_upload_busy_response($start['job'] ?? null) ?? ['busy' => true]
    );
  }
  if (empty($start['ok'])) {
    ll_error((string) ($start['error'] ?? 'Could not start the audit'), 502);
  }

  $leadCount = (int) $mapped['lead_count'];
  ll_ok([
    'status' => 'auditing',
    'message' => 'Audit started for ' . $leadCount . ' lead(s). The server finishes the audit and publishes the TeleCaller dashboards.',
    'source_file' => $sourceFile,
    'row_count' => (int) $mapped['row_count'],
    'lead_count' => $leadCount,
    'batch_size' => $batchSize,
    'concurrency' => $concurrency,
    'total_batches' => (int) ceil($leadCount / $batchSize),
    'model' => (string) ($settings['model'] ?? ''),
    'uploaded_by' => $start['job']['uploaded_by_name'] ?? null,
  ], 202);
}

/**
 * Same password check as auth/login, plus Bucket 1 + Upload Dashboard permission.
 * @return array<string, mixed>
 */
function ll_audit_upload_authenticate(): array
{
  $username = trim((string) ($_POST['username'] ?? ''));
  $password = (string) ($_POST['password'] ?? '');
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
  $user = ll_public_user($row);
  $canAudit = ll_user_has_permission($user, 'telecaller.bucket1')
    || ll_user_has_permission($user, 'module.telecaller_audit');
  $canPublish = ll_user_has_permission($user, 'telecaller.upload_dashboard');
  if (empty($user['is_super']) && !($canAudit && $canPublish)) {
    ll_error('This account needs Bucket 1 and Upload Dashboard access', 403);
  }
  return $user;
}

/**
 * Optional integer form field clamped to 1..$max like the website; blank uses $default.
 */
function ll_audit_upload_int_field(string $name, int $default, int $max): int
{
  $raw = trim((string) ($_POST[$name] ?? ''));
  if ($raw === '') {
    return max(1, min($max, $default));
  }
  if (!preg_match('/^-?\d+$/', $raw)) {
    ll_error($name . ' must be a whole number (1-' . $max . ')');
  }
  return max(1, min($max, (int) $raw));
}

/**
 * @param ?array<string, mixed> $job
 * @return ?array<string, mixed>
 */
function ll_audit_upload_busy_response(?array $job): ?array
{
  if (!is_array($job) || ($job['status'] ?? '') !== 'auditing') {
    return null;
  }
  $total = $job['lead_count'] ?? (isset($job['leads']) && is_array($job['leads']) ? count($job['leads']) : null);
  return [
    'busy' => true,
    'running' => [
      'pipeline' => $job['pipeline'] ?? null,
      'source_file' => $job['source_file'] ?? null,
      'started_at' => $job['started_at'] ?? null,
      'audited' => isset($job['results']) && is_array($job['results']) ? count($job['results']) : 0,
      'total' => $total,
    ],
  ];
}

/**
 * @return array{0: string, 1: string} Workbook bytes and a safe display name
 */
function ll_audit_upload_read_file(): array
{
  $file = $_FILES['file'] ?? null;
  if (!is_array($file) || !isset($file['error']) || is_array($file['error'])) {
    ll_error('Attach the workbook as form field "file" (e.g. -F "file=@leads.xlsx")');
  }
  $err = (int) $file['error'];
  if ($err === UPLOAD_ERR_INI_SIZE || $err === UPLOAD_ERR_FORM_SIZE) {
    ll_error('File is larger than the server upload limit (' . (string) ini_get('upload_max_filesize') . ')', 413);
  }
  if ($err === UPLOAD_ERR_NO_FILE) {
    ll_error('Attach the workbook as form field "file" (e.g. -F "file=@leads.xlsx")');
  }
  if ($err !== UPLOAD_ERR_OK) {
    ll_error('File upload failed (code ' . $err . ')', 400);
  }
  $name = basename(str_replace('\\', '/', (string) ($file['name'] ?? '')));
  if (strtolower((string) pathinfo($name, PATHINFO_EXTENSION)) !== 'xlsx') {
    ll_error('Only .xlsx files are supported');
  }
  $size = (int) ($file['size'] ?? 0);
  if ($size <= 0) {
    ll_error('The uploaded file is empty');
  }
  if ($size > LL_ERP_SYNC_MAX_BYTES) {
    ll_error('File is too large (max ' . (int) (LL_ERP_SYNC_MAX_BYTES / 1_000_000) . ' MB)', 413);
  }
  $tmp = (string) ($file['tmp_name'] ?? '');
  if ($tmp === '' || !is_uploaded_file($tmp)) {
    ll_error('File upload failed', 400);
  }
  $binary = file_get_contents($tmp);
  if ($binary === false || $binary === '') {
    ll_error('Could not read the uploaded file', 400);
  }
  if (strncmp($binary, "PK", 2) !== 0) {
    ll_error('That file is not a valid .xlsx workbook');
  }
  $safeName = preg_replace('/[^\w .()\-]+/u', '_', $name) ?? 'upload.xlsx';
  return [$binary, $safeName !== '' ? $safeName : 'upload.xlsx'];
}

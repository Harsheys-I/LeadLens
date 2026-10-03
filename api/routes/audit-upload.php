<?php

declare(strict_types=1);

require_once __DIR__ . '/../lib/erp-sync.php';

/**
 * Terminal Bucket 1 (no session, no cron secret):
 *   POST audit/upload  multipart: username, password, file (.xlsx or ERP .json), optional batch_size, concurrency
 * .xlsx: first sheet. .json: Strategic ERP report rows A1–A13.
 * Audits with saved audit_settings + server OpenAI key, then publishes
 * TeleCaller dashboards. Responds once the audit has started; the server finishes via the
 * one-time self-chain continue.
 *   GET  audit/status  session: progress of the background audit
 *   POST audit/cancel  session: stop that audit
 */
function ll_route_audit(string $action): void
{
  switch ($action) {
    case 'upload':
      ll_audit_route_upload();
      break;
    case 'status':
      ll_audit_route_status();
      break;
    case 'cancel':
      ll_audit_route_cancel();
      break;
    default:
      ll_error('Not found', 404);
  }
}

function ll_audit_route_session_actor(): array
{
  $user = ll_require_user();
  if (
    empty($user['is_super'])
    && !ll_user_has_permission($user, 'module.telecaller_audit')
    && !ll_user_has_permission($user, 'telecaller.bucket1')
  ) {
    ll_error('Not allowed', 403);
  }
  return $user;
}

function ll_audit_route_status(): void
{
  ll_require_method('GET');
  ll_audit_route_session_actor();
  $progress = ll_erp_sync_public_progress(ll_erp_sync_load_job());
  ll_ok(['progress' => $progress]);
}

function ll_audit_route_cancel(): void
{
  ll_require_method('POST');
  $user = ll_audit_route_session_actor();
  $job = ll_erp_sync_load_job();
  if (is_array($job) && ($job['status'] ?? '') === 'auditing') {
    $pipeline = (string) ($job['pipeline'] ?? '');
    $uploadedBy = isset($job['uploaded_by_id']) ? (int) $job['uploaded_by_id'] : 0;
    $isSuper = !empty($user['is_super']);
    $ownsUpload = $pipeline === 'upload' && $uploadedBy > 0 && $uploadedBy === (int) $user['id'];
    // Daily / advanced (and orphan uploads) — Super only. Upload jobs — Super or uploader.
    if (!$isSuper && !$ownsUpload) {
      ll_error('Only Super User (or the uploader of an API audit) can stop this audit', 403);
    }
  }
  $progress = ll_erp_sync_request_cancel();
  ll_ok(['progress' => $progress, 'message' => $progress['message'] ?? 'Audit stopped']);
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

  [$binary, $sourceFile, $kind] = ll_audit_upload_read_file();
  $cfg = ll_erp_sync_load_config();
  $fieldMap = (array) ($cfg['field_map'] ?? ll_erp_sync_default_field_map());
  try {
    if ($kind === 'json') {
      $rows = ll_audit_upload_rows_from_erp_json($binary, $fieldMap);
    } else {
      $rows = ll_erp_sync_parse_xlsx_rows($binary, $fieldMap);
    }
  } catch (Throwable $e) {
    error_log('LeadLens audit upload read failed: ' . $e->getMessage());
    ll_error('Could not read the file', 400);
  }
  unset($binary);
  if (!$rows) {
    ll_error($kind === 'json' ? 'The JSON report has no data rows' : 'The first sheet has no data rows', 400);
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
 * Strategic ERP getreportjsondata columns, in Bucket 1 field order.
 * A1 mobile, A2 project, A3 registration, A4 telecaller, A5 source,
 * A6 lead update, A7 status, A8 comments, A9 next follow-up,
 * A10 location, A11 requirement, A12 analysis parameter, A13 budget.
 *
 * @return array<string, string>
 */
function ll_audit_upload_erp_json_codes(): array
{
  return [
    'A1' => 'mobile',
    'A2' => 'project',
    'A3' => 'registration',
    'A4' => 'telecaller',
    'A5' => 'source',
    'A6' => 'update',
    'A7' => 'status',
    'A8' => 'comments',
    'A9' => 'next',
    'A10' => 'location',
    'A11' => 'requirement',
    'A12' => 'parameter',
    'A13' => 'budget',
  ];
}

/** Drop fractional seconds so "2024-01-29 10:10:00.0" parses as a date. */
function ll_audit_upload_normalize_erp_value(string $value): string
{
  if (preg_match('/^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})\.\d+$/', $value, $m)) {
    return $m[1];
  }
  return $value;
}

/**
 * ERP report JSON (a list of A1–A13 objects) → rows keyed by the active field-map headers.
 *
 * @param array<string, mixed> $fieldMap
 * @return list<array<string, string>>
 */
function ll_audit_upload_rows_from_erp_json(string $raw, array $fieldMap): array
{
  $decoded = json_decode($raw, true);
  if (!is_array($decoded)) {
    throw new RuntimeException('Invalid JSON');
  }
  $list = $decoded;
  if (!isset($decoded[0]) || !is_array($decoded[0])) {
    foreach (['data', 'rows', 'records', 'result', 'results', 'reportData', 'jsondata'] as $key) {
      if (isset($decoded[$key]) && is_array($decoded[$key]) && isset($decoded[$key][0]) && is_array($decoded[$key][0])) {
        $list = $decoded[$key];
        break;
      }
    }
  }
  if (!isset($list[0]) || !is_array($list[0])) {
    throw new RuntimeException('JSON report has no rows');
  }
  $sample = $list[0];
  $hasCode = false;
  foreach (ll_audit_upload_erp_json_codes() as $code => $_field) {
    if (array_key_exists($code, $sample)) {
      $hasCode = true;
      break;
    }
  }
  if (!$hasCode) {
    throw new RuntimeException('JSON report is missing A1–A13 columns');
  }

  $headerFor = [];
  foreach (ll_audit_upload_erp_json_codes() as $code => $fieldId) {
    $aliases = $fieldMap[$fieldId] ?? [$fieldId];
    if (!is_array($aliases) || !$aliases) {
      $aliases = [$fieldId];
    }
    $headerFor[$code] = (string) $aliases[0];
  }

  $rows = [];
  foreach ($list as $item) {
    if (!is_array($item)) {
      continue;
    }
    $assoc = [];
    $empty = true;
    foreach (ll_audit_upload_erp_json_codes() as $code => $_field) {
      $val = $item[$code] ?? '';
      if (is_array($val) || is_object($val)) {
        $val = '';
      }
      $val = ll_audit_upload_normalize_erp_value(trim((string) $val));
      if ($val !== '') {
        $empty = false;
      }
      $assoc[$headerFor[$code]] = $val;
    }
    if (!$empty) {
      $rows[] = $assoc;
    }
  }
  return $rows;
}

/**
 * @return array{0: string, 1: string, 2: string} Bytes, display name, and "xlsx" or "json"
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
  $ext = strtolower((string) pathinfo($name, PATHINFO_EXTENSION));
  if (!in_array($ext, ['xlsx', 'json'], true)) {
    ll_error('Only .xlsx or Strategic ERP .json reports are supported');
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
  if (strncmp($binary, "\xEF\xBB\xBF", 3) === 0) {
    $binary = substr($binary, 3);
  }
  $isZip = strncmp($binary, "PK", 2) === 0;
  $trim = ltrim($binary);
  $isJson = $trim !== '' && ($trim[0] === '[' || $trim[0] === '{');
  if ($ext === 'xlsx' || ($ext === '' && $isZip)) {
    if (!$isZip) {
      ll_error('That file is not a valid .xlsx workbook');
    }
    $safeName = preg_replace('/[^\w .()\-]+/u', '_', $name) ?? 'upload.xlsx';
    return [$binary, $safeName !== '' ? $safeName : 'upload.xlsx', 'xlsx'];
  }
  if (!$isJson) {
    ll_error('That file is not a JSON report');
  }
  $safeName = preg_replace('/[^\w .()\-]+/u', '_', $name) ?? 'upload.json';
  return [$binary, $safeName !== '' ? $safeName : 'upload.json', 'json'];
}

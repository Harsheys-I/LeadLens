<?php

declare(strict_types=1);

require_once __DIR__ . '/../lib/erp-sync.php';
require_once __DIR__ . '/../lib/upload-files.php';

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

  // Keep the request alive after 202 so LiteSpeed deferred continue can run.
  ignore_user_abort(true);
  $maxExec = (int) ini_get('max_execution_time');
  if ($maxExec <= 0) {
    $maxExec = 240;
  }
  @set_time_limit(max(60, min($maxExec, 420)));

  $leadCount = (int) $mapped['lead_count'];
  $chainToken = trim((string) (($start['job']['chain_token'] ?? '')));
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
    // GHA uses this to POST erp-sync/continue reliably (Hostinger fire-and-forget is flaky).
    'chain_token' => $chainToken !== '' ? $chainToken : null,
    'continue_url' => ll_erp_sync_continue_self_url(),
  ], 202);
}

/**
 * Same password check as auth/login, plus Bucket 1 + Upload Dashboard permission.
 * @return array<string, mixed>
 */
function ll_audit_upload_authenticate(): array
{
  $user = ll_upload_authenticate_password();
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

/**
 * ERP report JSON (a list of A1–A13 objects) → rows keyed by the active field-map headers.
 *
 * @param array<string, mixed> $fieldMap
 * @return list<array<string, string>>
 */
function ll_audit_upload_rows_from_erp_json(string $raw, array $fieldMap): array
{
  $fieldRows = ll_erp_json_rows($raw, ll_audit_upload_erp_json_codes(), true);

  $headerFor = [];
  foreach (ll_audit_upload_erp_json_codes() as $fieldId) {
    $aliases = $fieldMap[$fieldId] ?? [$fieldId];
    if (!is_array($aliases) || !$aliases) {
      $aliases = [$fieldId];
    }
    $headerFor[$fieldId] = (string) $aliases[0];
  }

  $rows = [];
  foreach ($fieldRows as $row) {
    $assoc = [];
    foreach ($row as $fieldId => $val) {
      $assoc[$headerFor[$fieldId]] = $val;
    }
    $rows[] = $assoc;
  }
  return $rows;
}

/**
 * @return array{0: string, 1: string, 2: string} Bytes, display name, and "xlsx" or "json"
 */
function ll_audit_upload_read_file(): array
{
  return ll_upload_read_file('file');
}

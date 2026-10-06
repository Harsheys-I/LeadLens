<?php

declare(strict_types=1);

require_once __DIR__ . '/../lib/erp-sync.php';
require_once __DIR__ . '/../lib/upload-files.php';

/**
 * Terminal Bucket 1 (no session, no cron secret):
 *   POST audit/upload  multipart: username, password, file (.xlsx or ERP .json)
 *   POST audit/stage   same multipart. Stages only — no OpenAI, no PHP audit pool.
 *   GET  audit/stage?id=&offset=&limit=   lead slices (default limit 20) for browser-style auditBatch
 *   GET  audit/stage/{id}/batch?offset=&limit=   same slices
 *   POST audit/publish-results  JSON: stage_id, results, usage, elapsed_seconds
 *   GET/POST audit/checkpoint   resume state for an unattended run (no publish)
 *   POST audit/stop-log         record a stopped/failed upload log without publishing
 * .xlsx: first sheet. .json: Strategic ERP report rows A1–A13.
 * GitHub Actions audits via short OpenAI proxy calls, then one publish request.
 *   GET  audit/status  session: progress of a legacy background audit
 *   POST audit/cancel  session: stop that audit
 */
function ll_route_audit(string $action, array $parts = []): void
{
  switch ($action) {
    case 'upload':
      ll_audit_route_upload();
      break;
    case 'stage':
      ll_audit_route_stage($parts);
      break;
    case 'publish-results':
      ll_audit_route_publish_results();
      break;
    case 'checkpoint':
      ll_audit_route_checkpoint();
      break;
    case 'stop-log':
      ll_audit_route_stop_log();
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
  $user = ll_audit_route_session_actor();
  $autoKick = null;
  if (!empty($user['is_super'])) {
    $autoKick = ll_erp_sync_maybe_auto_kick($user);
  }
  $progress = ll_erp_sync_public_progress(ll_erp_sync_load_job());
  ll_ok(['progress' => $progress, 'auto_kick' => $autoKick]);
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

/**
 * POST audit/upload — stage only.
 * Contract: 202 {ok, staged:true, stage_id, lead_count, source_file}.
 * Does not start OpenAI or ll_erp_sync_audit_pool. GHA pulls slices with
 * GET audit/stage?id=&offset=&limit= (default limit 20) and publishes with
 * POST audit/publish-results. Full lead objects stay on disk keyed by stage_id.
 */
function ll_audit_route_upload(): void
{
  ll_require_method('POST');
  $staged = ll_audit_stage_accept_upload();
  $leadCount = (int) $staged['lead_count'];
  ll_ok([
    'staged' => true,
    'status' => 'staged',
    'stage_id' => $staged['stage_id'],
    'message' => 'Staged ' . $leadCount . ' lead(s). Audit them with the OpenAI proxy, then POST audit/publish-results.',
    'source_file' => $staged['source_file'],
    'row_count' => (int) $staged['row_count'],
    'lead_count' => $leadCount,
    'batch_size' => LL_AUDIT_UPLOAD_DEFAULT_BATCH,
    'concurrency' => LL_AUDIT_UPLOAD_DEFAULT_CONCURRENCY,
    'leads_url' => 'audit/stage?id=' . rawurlencode($staged['stage_id']) . '&offset=0&limit=' . LL_AUDIT_UPLOAD_DEFAULT_BATCH,
  ], 202);
}

/**
 * POST audit/stage — same auth and file parse as audit/upload.
 * Response: {ok, stage_id, lead_count, source_file}. Leads are NOT returned.
 * GET audit/stage?id=&offset=&limit= (or GET audit/stage/{id}/batch) returns
 * the lead objects auditBatch expects, default limit 20.
 *
 * @param list<string> $parts
 */
function ll_audit_route_stage(array $parts): void
{
  if (ll_method() === 'GET') {
    ll_audit_route_stage_get($parts);
    return;
  }
  ll_require_method('POST');
  if (($parts[2] ?? '') !== '') {
    ll_error('Not found', 404);
  }
  $staged = ll_audit_stage_accept_upload();
  ll_ok([
    'stage_id' => $staged['stage_id'],
    'lead_count' => (int) $staged['lead_count'],
    'source_file' => $staged['source_file'],
    'row_count' => (int) $staged['row_count'],
  ]);
}

/**
 * GET audit/stage?id=&offset=&limit=
 * GET audit/stage/{stage_id}/batch?offset=&limit=
 * Auth: username/password (query, Basic, or form). Returns one lead slice.
 *
 * @param list<string> $parts
 */
function ll_audit_route_stage_get(array $parts): void
{
  ll_require_method('GET');
  ll_audit_upload_authenticate();
  $fromPath = trim((string) ($parts[2] ?? ''));
  $stageId = $fromPath !== '' ? $fromPath : trim((string) ($_GET['id'] ?? ''));
  $stage = ll_audit_stage_load($stageId);
  $offset = ll_audit_stage_nonneg_int($_GET['offset'] ?? 0);
  $limit = ll_audit_stage_limit($_GET['limit'] ?? null);
  $leads = $stage['leads'];
  $slice = array_slice($leads, $offset, $limit);
  ll_ok([
    'stage_id' => $stage['stage_id'],
    'source_file' => $stage['source_file'],
    'lead_count' => (int) $stage['lead_count'],
    'offset' => $offset,
    'limit' => $limit,
    'returned' => count($slice),
    'leads' => $slice,
  ]);
}

/**
 * POST audit/publish-results — one short request after GHA finishes auditing.
 * Body JSON: username, password, stage_id, results (audited lead rows),
 * usage {input, cached, output}, elapsed_seconds.
 * Publishes via ll_publish_telecaller_dashboards and writes a bucket1 upload log
 * row with status published. Does not start the PHP audit pool.
 */
function ll_audit_route_publish_results(): void
{
  ll_require_method('POST');
  $body = ll_read_json_body();
  $user = ll_audit_upload_authenticate($body);
  $stageId = trim((string) ($body['stage_id'] ?? ''));
  $stage = ll_audit_stage_load($stageId);
  $results = $body['results'] ?? $body['leads'] ?? null;
  if (!is_array($results) || !$results) {
    ll_error('results must be a non-empty array of audited lead rows');
  }
  $rows = [];
  foreach ($results as $row) {
    if (!is_array($row)) {
      ll_error('Each result must be an object');
    }
    $rows[] = $row;
  }
  $usageIn = is_array($body['usage'] ?? null) ? $body['usage'] : [];
  $usage = [
    'input' => max(0, (int) ($usageIn['input'] ?? 0)),
    'cached' => max(0, (int) ($usageIn['cached'] ?? 0)),
    'output' => max(0, (int) ($usageIn['output'] ?? 0)),
  ];
  $elapsed = max(0, (int) ($body['elapsed_seconds'] ?? 0));
  $sourceFile = (string) ($stage['source_file'] ?? '');
  $dashboards = ll_erp_sync_build_dashboards($rows, $sourceFile);
  foreach ($dashboards as &$dash) {
    $dash['meta']['source'] = 'audit_upload';
    $dash['meta']['stage_id'] = $stage['stage_id'];
  }
  unset($dash);
  if (!$dashboards) {
    ll_error('No dashboards to publish — audited rows need a telecaller (or they group as Unassigned)');
  }
  $published = ll_publish_telecaller_dashboards($dashboards, $user);
  $publishedCount = count($published['published'] ?? []);
  $cost = ll_erp_sync_estimate_cost($usage);
  $startedAt = (string) ($stage['created_at'] ?? gmdate('c'));
  $name = (string) (($user['display_name'] ?? '') !== '' ? $user['display_name'] : ($user['username'] ?? ''));
  ll_audit_upload_log_record([
    'kind' => 'bucket1',
    'started_at' => $startedAt,
    'source_file' => $sourceFile,
    'row_count' => (int) ($stage['row_count'] ?? 0),
    'lead_count' => (int) ($stage['lead_count'] ?? 0),
    'uploaded_by' => $name,
    'batch_size' => LL_AUDIT_UPLOAD_DEFAULT_BATCH,
    'concurrency' => LL_AUDIT_UPLOAD_DEFAULT_CONCURRENCY,
    'status' => 'published',
    'error' => null,
    'published_at' => gmdate('c'),
    'published_count' => $publishedCount,
    'audited' => count($rows),
    'elapsed_seconds' => $elapsed,
    'usage' => $usage,
    'estimated_cost' => $cost,
  ]);
  ll_audit_stage_delete($stage['stage_id']);
  ll_ok([
    'status' => 'published',
    'stage_id' => $stage['stage_id'],
    'source_file' => $sourceFile,
    'lead_count' => (int) ($stage['lead_count'] ?? 0),
    'audited' => count($rows),
    'published_count' => $publishedCount,
    'elapsed_seconds' => $elapsed,
    'usage' => $usage,
    'estimated_cost' => $cost,
  ]);
}

/**
 * GET audit/checkpoint?sha256=  — resume blob for this file, or 404.
 * POST audit/checkpoint — JSON {file_sha256, checkpoint}. Does not publish dashboards.
 * GitHub Actions runners are ephemeral; this is what the next midnight run resumes from.
 */
function ll_audit_route_checkpoint(): void
{
  if (ll_method() === 'GET') {
    ll_audit_upload_authenticate();
    $sha = strtolower(trim((string) ($_GET['sha256'] ?? '')));
    $path = ll_audit_checkpoint_path($sha);
    if (!is_file($path)) {
      ll_error('No checkpoint for this file', 404);
    }
    $raw = file_get_contents($path);
    $decoded = is_string($raw) ? json_decode($raw, true) : null;
    if (!is_array($decoded)) {
      ll_error('Checkpoint is unreadable', 500);
    }
    ll_ok(['checkpoint' => $decoded]);
  }
  ll_require_method('POST');
  $body = ll_read_json_body();
  ll_audit_upload_authenticate($body);
  $sha = strtolower(trim((string) ($body['file_sha256'] ?? '')));
  $checkpoint = $body['checkpoint'] ?? null;
  if (!is_array($checkpoint)) {
    ll_error('checkpoint object is required');
  }
  $checkpoint['file_sha256'] = $sha;
  $json = json_encode($checkpoint, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  if ($json === false) {
    ll_error('Could not store the checkpoint', 500);
  }
  $path = ll_audit_checkpoint_path($sha);
  if (file_put_contents($path, $json, LOCK_EX) === false) {
    ll_error('Could not store the checkpoint', 500);
  }
  ll_ok(['stored' => true, 'file_sha256' => $sha]);
}

/**
 * POST audit/stop-log — write a stopped Bucket 1 upload-log row and do not publish.
 * Body: stage_id, message, usage, elapsed_seconds, audited.
 */
function ll_audit_route_stop_log(): void
{
  ll_require_method('POST');
  $body = ll_read_json_body();
  $user = ll_audit_upload_authenticate($body);
  $stageId = trim((string) ($body['stage_id'] ?? ''));
  $stage = ll_audit_stage_load($stageId);
  $message = trim((string) ($body['message'] ?? ''));
  if ($message === '') {
    $message = 'Stopped: estimated cost exceeded Rs 20';
  }
  $usageIn = is_array($body['usage'] ?? null) ? $body['usage'] : [];
  $usage = [
    'input' => max(0, (int) ($usageIn['input'] ?? 0)),
    'cached' => max(0, (int) ($usageIn['cached'] ?? 0)),
    'output' => max(0, (int) ($usageIn['output'] ?? 0)),
  ];
  $elapsed = max(0, (int) ($body['elapsed_seconds'] ?? 0));
  $audited = max(0, (int) ($body['audited'] ?? 0));
  $cost = ll_erp_sync_estimate_cost($usage);
  $startedAt = (string) ($stage['created_at'] ?? gmdate('c'));
  $name = (string) (($user['display_name'] ?? '') !== '' ? $user['display_name'] : ($user['username'] ?? ''));
  ll_audit_upload_log_record([
    'kind' => 'bucket1',
    'started_at' => $startedAt,
    'source_file' => (string) ($stage['source_file'] ?? ''),
    'row_count' => (int) ($stage['row_count'] ?? 0),
    'lead_count' => (int) ($stage['lead_count'] ?? 0),
    'uploaded_by' => $name,
    'batch_size' => LL_AUDIT_UPLOAD_DEFAULT_BATCH,
    'concurrency' => LL_AUDIT_UPLOAD_DEFAULT_CONCURRENCY,
    'status' => 'stopped',
    'error' => $message,
    'published_at' => null,
    'published_count' => null,
    'audited' => $audited,
    'elapsed_seconds' => $elapsed,
    'usage' => $usage,
    'estimated_cost' => $cost,
  ]);
  ll_ok([
    'status' => 'stopped',
    'message' => $message,
    'stage_id' => $stage['stage_id'],
    'audited' => $audited,
    'estimated_cost' => $cost,
  ]);
}

function ll_audit_checkpoint_path(string $sha): string
{
  if (!preg_match('/^[a-f0-9]{64}$/', $sha)) {
    ll_error('file_sha256 is required', 400);
  }
  $dir = ll_audit_stage_dir() . '/checkpoints';
  if (!is_dir($dir)) {
    @mkdir($dir, 0750, true);
  }
  return $dir . '/' . $sha . '.json';
}

/**
 * Parse multipart file the same way as the old audit/upload, store leads by stage_id.
 * @return array{stage_id: string, lead_count: int, row_count: int, source_file: string}
 */
function ll_audit_stage_accept_upload(): array
{
  if (!$_POST && !$_FILES && (int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 0) {
    ll_error('Request is larger than the server limit (' . (string) ini_get('post_max_size') . ')', 413);
  }
  $user = ll_audit_upload_authenticate();
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
    error_log('LeadLens audit stage read failed: ' . $e->getMessage());
    ll_error('Could not read the file', 400);
  }
  if (!$rows) {
    ll_error($kind === 'json' ? 'The JSON report has no data rows' : 'The first sheet has no data rows', 400);
  }
  $mapped = ll_erp_sync_map_to_leads($rows, $fieldMap);
  unset($rows);
  if (!empty($mapped['missing_required'])) {
    ll_error('Missing required column(s): ' . implode(', ', $mapped['missing_required']), 400, [
      'mapped_columns' => $mapped['mapped_columns'],
    ]);
  }
  if (!$mapped['leads']) {
    ll_error('No leads found — every row needs a valid Mobile and Project', 400);
  }
  $stageId = bin2hex(random_bytes(16));
  $name = (string) (($user['display_name'] ?? '') !== '' ? $user['display_name'] : ($user['username'] ?? 'user'));
  $meta = [
    'stage_id' => $stageId,
    'source_file' => $sourceFile,
    'kind' => $kind,
    'row_count' => (int) $mapped['row_count'],
    'lead_count' => (int) $mapped['lead_count'],
    'created_at' => gmdate('c'),
    'uploaded_by_id' => (int) ($user['id'] ?? 0),
    'uploaded_by_name' => $name,
    'leads' => $mapped['leads'],
  ];
  unset($mapped);
  ll_audit_stage_write($stageId, $meta, $binary, $sourceFile);
  unset($binary, $meta['leads']);
  return [
    'stage_id' => $stageId,
    'lead_count' => (int) $meta['lead_count'],
    'row_count' => (int) $meta['row_count'],
    'source_file' => $sourceFile,
  ];
}

function ll_audit_stage_dir(): string
{
  $dir = ll_erp_sync_storage_dir() . '/stages';
  if (!is_dir($dir)) {
    @mkdir($dir, 0750, true);
  }
  return $dir;
}

function ll_audit_stage_id_ok(string $id): bool
{
  return (bool) preg_match('/^[a-f0-9]{32}$/', $id);
}

/**
 * @param array<string, mixed> $meta Includes leads
 */
function ll_audit_stage_write(string $stageId, array $meta, string $binary, string $sourceFile): void
{
  if (!ll_audit_stage_id_ok($stageId)) {
    ll_error('Could not store the staged upload', 500);
  }
  $dir = ll_audit_stage_dir();
  $json = json_encode($meta, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  if ($json === false) {
    ll_error('Could not store the staged upload', 500);
  }
  $base = $dir . '/' . $stageId;
  if (file_put_contents($base . '.json', $json, LOCK_EX) === false) {
    ll_error('Could not store the staged upload', 500);
  }
  $safeName = str_replace(["\0", '/', '\\'], '', $sourceFile);
  file_put_contents($base . '.upload', $binary, LOCK_EX);
  file_put_contents($base . '.name', $safeName, LOCK_EX);
  ll_audit_stage_prune($dir);
}

/**
 * @return array<string, mixed>
 */
function ll_audit_stage_load(string $stageId): array
{
  $stageId = strtolower(trim($stageId));
  if (!ll_audit_stage_id_ok($stageId)) {
    ll_error('stage_id is required', 400);
  }
  $path = ll_audit_stage_dir() . '/' . $stageId . '.json';
  if (!is_file($path)) {
    ll_error('Staged upload not found', 404);
  }
  $raw = file_get_contents($path);
  $decoded = is_string($raw) ? json_decode($raw, true) : null;
  if (!is_array($decoded) || !is_array($decoded['leads'] ?? null)) {
    ll_error('Staged upload is unreadable', 500);
  }
  return $decoded;
}

function ll_audit_stage_delete(string $stageId): void
{
  if (!ll_audit_stage_id_ok($stageId)) {
    return;
  }
  $base = ll_audit_stage_dir() . '/' . $stageId;
  foreach (['.json', '.upload', '.name'] as $ext) {
    if (is_file($base . $ext)) {
      @unlink($base . $ext);
    }
  }
}

function ll_audit_stage_prune(string $dir): void
{
  $cutoff = time() - 7 * 86400;
  foreach (glob($dir . '/*.json') ?: [] as $path) {
    if (!is_string($path) || filemtime($path) === false || filemtime($path) >= $cutoff) {
      continue;
    }
    $id = basename($path, '.json');
    if (ll_audit_stage_id_ok($id)) {
      ll_audit_stage_delete($id);
    }
  }
}

function ll_audit_stage_nonneg_int(mixed $raw): int
{
  $n = (int) $raw;
  return $n > 0 ? $n : 0;
}

function ll_audit_stage_limit(mixed $raw): int
{
  if ($raw === null || trim((string) $raw) === '') {
    return LL_AUDIT_UPLOAD_DEFAULT_BATCH;
  }
  $n = (int) $raw;
  if ($n < 1) {
    return 1;
  }
  return min(200, $n);
}

/**
 * Same password check as auth/login, plus Bucket 1 + Upload Dashboard permission.
 * Multipart fields, JSON body, query string, or HTTP Basic.
 * @param ?array<string, mixed> $json
 * @return array<string, mixed>
 */
function ll_audit_upload_authenticate(?array $json = null): array
{
  $user = ll_audit_upload_authenticate_password($json);
  $canAudit = ll_user_has_permission($user, 'telecaller.bucket1')
    || ll_user_has_permission($user, 'module.telecaller_audit');
  $canPublish = ll_user_has_permission($user, 'telecaller.upload_dashboard');
  if (empty($user['is_super']) && !($canAudit && $canPublish)) {
    ll_error('This account needs Bucket 1 and Upload Dashboard access', 403);
  }
  return $user;
}

/**
 * Password check matching auth/login. Sources: multipart, JSON, query, HTTP Basic.
 * @param ?array<string, mixed> $json
 * @return array<string, mixed>
 */
function ll_audit_upload_authenticate_password(?array $json = null): array
{
  $username = trim((string) ($_POST['username'] ?? ''));
  $password = (string) ($_POST['password'] ?? '');
  if ($username === '' || $password === '') {
    $username = $username !== '' ? $username : trim((string) ($_GET['username'] ?? ''));
    $password = $password !== '' ? $password : (string) ($_GET['password'] ?? '');
  }
  if (($username === '' || $password === '') && is_array($json)) {
    if ($username === '') {
      $username = trim((string) ($json['username'] ?? ''));
    }
    if ($password === '') {
      $password = (string) ($json['password'] ?? '');
    }
  }
  if ($username === '' || $password === '') {
    $header = (string) ($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
    if (stripos($header, 'Basic ') === 0) {
      $decoded = base64_decode(substr($header, 6), true);
      if (is_string($decoded) && str_contains($decoded, ':')) {
        [$basicUser, $basicPass] = explode(':', $decoded, 2);
        if ($username === '') {
          $username = trim($basicUser);
        }
        if ($password === '') {
          $password = $basicPass;
        }
      }
    }
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

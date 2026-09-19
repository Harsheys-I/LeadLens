<?php

declare(strict_types=1);

require_once __DIR__ . '/../lib/erp-sync.php';

/**
 * Super User (or cron bearer). Routes (production `/` and `/dev`):
 *   GET|PUT|POST erp-sync/config
 *   POST erp-sync/test-fetch
 *   POST erp-sync/fetch-for-audit  (primary: fetch → store → map → latest-leads)
 *   GET  erp-sync/latest-leads
 *   POST erp-sync/run             (optional advanced: server OpenAI audit loop)
 *   POST erp-sync/daily           (cron: fresh fetch + audit + publish)
 *   POST erp-sync/continue        (cron: resume audit only if job needs_continue)
 *   POST|GET erp-sync/keepalive|ping  (session keep-alive; cron or Super User)
 *   POST erp-sync/publish
 *   GET erp-sync/status
 *   GET erp-sync/job
 */
function ll_route_erp_sync(string $action): void
{
  switch ($action) {
    case 'config':
      ll_erp_sync_route_config();
      break;
    case 'test-fetch':
      ll_erp_sync_route_test_fetch();
      break;
    case 'fetch-for-audit':
      ll_erp_sync_route_fetch_for_audit();
      break;
    case 'latest-leads':
      ll_erp_sync_route_latest_leads();
      break;
    case 'run':
      ll_erp_sync_route_run();
      break;
    case 'daily':
      ll_erp_sync_route_daily();
      break;
    case 'continue':
      ll_erp_sync_route_continue();
      break;
    case 'keepalive':
    case 'ping':
      ll_erp_sync_route_keepalive();
      break;
    case 'publish':
      ll_erp_sync_route_publish();
      break;
    case 'status':
      ll_erp_sync_route_status();
      break;
    case 'job':
      ll_erp_sync_route_job();
      break;
    default:
      ll_error('Not found', 404);
  }
}

function ll_erp_sync_route_config(): void
{
  $method = ll_method();
  if ($method === 'GET') {
    ll_erp_sync_require_actor(false);
    ll_ok(['config' => ll_erp_sync_public_config()]);
  }
  if ($method === 'PUT' || $method === 'POST') {
    $user = ll_erp_sync_require_actor(false);
    $body = ll_read_json_body();
    $config = ll_erp_sync_save_config($body, (int) $user['id']);
    ll_ok(['config' => $config, 'message' => 'ERP sync settings saved']);
  }
  ll_error('Method not allowed', 405);
}

function ll_erp_sync_route_test_fetch(): void
{
  ll_require_method('POST');
  ll_erp_sync_require_actor(false);
  $cfg = ll_erp_sync_load_config();
  $url = trim((string) ($cfg['report_url'] ?? ''));
  $cookie = ll_erp_sync_cookie_plaintext();
  if ($url === '') {
    ll_error('Save a report URL first');
  }
  if ($cookie === null) {
    ll_error('Save a Cookie header first');
  }
  $extra = $cfg['extra_headers'] ?? [];
  if ($extra instanceof stdClass) {
    $extra = (array) $extra;
  }
  $fetch = ll_erp_sync_http_fetch($url, (string) ($cfg['http_method'] ?? 'GET'), $cookie, (array) $extra);
  // Never include body in status logs beyond preview.
  if (!empty($fetch['session_expired'])) {
    ll_erp_sync_set_last_status([
      'ok' => false,
      'phase' => 'test-fetch',
      'session_expired' => true,
      'error' => $fetch['error'] ?? 'session_expired',
      'http_status' => $fetch['status'],
      'at' => gmdate('c'),
    ]);
    ll_error($fetch['error'] ?? 'ERP session expired — refresh Cookie', 401, [
      'session_expired' => true,
      'http_status' => $fetch['status'],
    ]);
  }
  if (empty($fetch['ok'])) {
    ll_erp_sync_set_last_status([
      'ok' => false,
      'phase' => 'test-fetch',
      'error' => $fetch['error'] ?? 'fetch failed',
      'http_status' => $fetch['status'],
      'at' => gmdate('c'),
    ]);
    ll_error($fetch['error'] ?? 'Fetch failed', 502, ['http_status' => $fetch['status']]);
  }

  $file = ll_erp_sync_store_payload($fetch['body'], $fetch['content_type']);
  $preview = ll_erp_sync_preview_payload($fetch['body'], $fetch['content_type'], (string) ($cfg['rows_path'] ?? ''));
  $mapped = null;
  if (($preview['row_count'] ?? 0) > 0 && empty($preview['error'])) {
    $format = $preview['format'] ?? '';
    $rows = [];
    if ($format === 'json') {
      $decoded = json_decode($fetch['body'], true);
      if (is_array($decoded)) {
        [$rows] = ll_erp_sync_extract_rows($decoded, (string) ($preview['rows_path'] ?? $cfg['rows_path'] ?? ''));
      }
    } elseif ($format === 'xlsx') {
      try {
        $rows = ll_erp_sync_parse_xlsx_rows($fetch['body']);
      } catch (Throwable $e) {
        $rows = [];
      }
    }
    if ($rows) {
      $mapped = ll_erp_sync_map_to_leads($rows, (array) ($cfg['field_map'] ?? ll_erp_sync_default_field_map()));
      // Shrink for response.
      unset($mapped['leads']);
    }
  }

  ll_erp_sync_set_last_status([
    'ok' => true,
    'phase' => 'test-fetch',
    'http_status' => $fetch['status'],
    'bytes' => $fetch['bytes'],
    'content_type' => $fetch['content_type'],
    'payload_file' => $file,
    'row_count' => $preview['row_count'] ?? 0,
    'keys' => $preview['keys'] ?? [],
    'at' => gmdate('c'),
  ]);

  ll_ok([
    'http_status' => $fetch['status'],
    'bytes' => $fetch['bytes'],
    'content_type' => $fetch['content_type'],
    'payload_file' => $file,
    'preview' => $preview,
    'mapping' => $mapped,
    'message' => 'Test fetch OK — use sample keys to refine field map, then Run sync',
  ]);
}

function ll_erp_sync_route_fetch_for_audit(): void
{
  ll_require_method('POST');
  ll_erp_sync_require_actor(false);
  try {
    $result = ll_erp_sync_fetch_for_audit();
  } catch (Throwable $e) {
    ll_error('ERP fetch failed: ' . $e->getMessage(), 500);
  }
  if (empty($result['ok'])) {
    $code = !empty($result['session_expired']) ? 401 : 400;
    ll_error((string) ($result['error'] ?? 'Fetch failed'), $code, $result);
  }
  ll_ok($result);
}

function ll_erp_sync_route_latest_leads(): void
{
  ll_require_method('GET');
  ll_erp_sync_require_actor(false);
  $doc = ll_erp_sync_load_latest_leads();
  if ($doc === null) {
    ll_error('No ERP fetch stored yet — use Fetch & send to Audit first', 404);
  }
  $metaOnly = isset($_GET['meta']) && (string) $_GET['meta'] === '1';
  if ($metaOnly) {
    ll_ok([
      'payload_file' => $doc['payload_file'] ?? null,
      'source_file' => $doc['source_file'] ?? null,
      'fetched_at' => $doc['fetched_at'] ?? null,
      'row_count' => $doc['row_count'] ?? 0,
      'lead_count' => $doc['lead_count'] ?? (isset($doc['leads']) && is_array($doc['leads']) ? count($doc['leads']) : 0),
      'mapped_columns' => $doc['mapped_columns'] ?? new stdClass(),
      'has_leads' => !empty($doc['leads']) && is_array($doc['leads']),
    ]);
  }
  // Full mapped leads for Audit UI (can be large — same shape as parseWorkbook leads).
  ll_ok([
    'source_file' => $doc['source_file'] ?? ('ERP:' . ($doc['payload_file'] ?? 'latest')),
    'payload_file' => $doc['payload_file'] ?? null,
    'fetched_at' => $doc['fetched_at'] ?? null,
    'row_count' => $doc['row_count'] ?? 0,
    'lead_count' => $doc['lead_count'] ?? (isset($doc['leads']) && is_array($doc['leads']) ? count($doc['leads']) : 0),
    'mapped_columns' => $doc['mapped_columns'] ?? new stdClass(),
    'leads' => array_values(is_array($doc['leads'] ?? null) ? $doc['leads'] : []),
  ]);
}

function ll_erp_sync_route_run(): void
{
  ll_require_method('POST');
  $actor = ll_erp_sync_require_actor(true);
  $body = ll_read_json_body();
  $forceFetch = !empty($body['force_fetch']);
  $dryRun = !empty($body['dry_run']);
  $cfg = ll_erp_sync_load_config();
  if ($actor['username'] === 'erp-sync-cron' && !ll_erp_sync_daily_is_enabled($cfg)) {
    ll_ok(['ok' => false, 'error' => 'ERP sync is disabled', 'status' => 'disabled']);
  }
  try {
    $result = ll_erp_sync_run($actor, $forceFetch, $dryRun, [
      'auto_publish_key' => 'auto_publish',
      'skip_enabled_check' => true,
    ]);
  } catch (Throwable $e) {
    ll_error('ERP sync failed: ' . $e->getMessage(), 500);
  }
  ll_ok($result);
}

function ll_erp_sync_route_daily(): void
{
  ll_require_method('POST');
  $actor = ll_erp_sync_require_actor(true);
  $cfg = ll_erp_sync_load_config();
  if ($actor['username'] === 'erp-sync-cron' && !ll_erp_sync_daily_is_enabled($cfg)) {
    ll_ok(['ok' => false, 'error' => 'Daily ERP pipeline is disabled', 'status' => 'disabled']);
  }
  try {
    $result = ll_erp_sync_daily_kickoff($actor);
  } catch (Throwable $e) {
    ll_error('ERP daily pipeline failed: ' . $e->getMessage(), 500);
  }
  ll_ok($result);
}

function ll_erp_sync_route_continue(): void
{
  ll_require_method('POST');
  $actor = ll_erp_sync_require_actor(true);
  try {
    $result = ll_erp_sync_continue_job($actor);
  } catch (Throwable $e) {
    ll_error('ERP continue failed: ' . $e->getMessage(), 500);
  }
  ll_ok($result);
}

function ll_erp_sync_route_keepalive(): void
{
  // Allow GET too — Hostinger cron "URL" jobs often cannot POST.
  ll_require_method('POST', 'GET');
  $actor = ll_erp_sync_require_actor(true);
  $cfg = ll_erp_sync_load_config();
  $source = ($actor['username'] === 'erp-sync-cron') ? 'cron' : 'manual';
  if ($actor['username'] === 'erp-sync-cron' && empty($cfg['keepalive_enabled'])) {
    $disabled = [
      'ok' => false,
      'result' => 'disabled',
      'error' => 'ERP keep-alive is disabled — enable in UI and Save',
      'status' => 'disabled',
      'source' => 'cron',
      'at' => gmdate('c'),
    ];
    ll_erp_sync_set_last_keepalive($disabled);
    ll_ok($disabled);
  }
  try {
    $result = ll_erp_sync_keepalive($source);
  } catch (Throwable $e) {
    ll_error('ERP keep-alive failed: ' . $e->getMessage(), 500);
  }
  ll_ok($result);
}

function ll_erp_sync_route_publish(): void
{
  ll_require_method('POST');
  $actor = ll_erp_sync_require_actor(false);
  try {
    $out = ll_erp_sync_publish_last($actor);
  } catch (Throwable $e) {
    ll_error($e->getMessage(), 400);
  }
  ll_ok(['published' => $out['published'], 'cleared' => $out['cleared'], 'message' => 'Published from last ERP sync']);
}

function ll_erp_sync_route_status(): void
{
  ll_require_method('GET');
  ll_erp_sync_require_actor(false);
  $cfg = ll_erp_sync_public_config();
  $job = ll_erp_sync_load_job();
  $jobMeta = null;
  $progress = null;
  if (is_array($job)) {
    $leadCount = $job['lead_count'] ?? (isset($job['leads']) && is_array($job['leads']) ? count($job['leads']) : null);
    $resultCount = isset($job['results']) && is_array($job['results']) ? count($job['results']) : 0;
    $jobStatus = (string) ($job['status'] ?? '');
    $needsContinue = $jobStatus === 'auditing';
    $complete = in_array($jobStatus, ['audited', 'ready', 'published'], true);
    $phaseMap = [
      'auditing' => 'audit',
      'audited' => 'done',
      'ready' => 'done',
      'published' => 'publish',
      'error' => 'error',
    ];
    $lastPhase = is_array($cfg['last_status'] ?? null) ? ($cfg['last_status']['phase'] ?? null) : null;
    $phase = $lastPhase ?: ($phaseMap[$jobStatus] ?? ($jobStatus !== '' ? $jobStatus : null));
    $jobMeta = [
      'status' => $job['status'] ?? null,
      'cursor' => $job['cursor'] ?? null,
      'lead_count' => $leadCount,
      'result_count' => $resultCount,
      'audited' => $resultCount,
      'total' => $leadCount,
      'phase' => $phase,
      'needs_continue' => $needsContinue,
      'complete' => $complete,
      'source_file' => $job['source_file'] ?? null,
      'started_at' => $job['started_at'] ?? null,
      'published_at' => $job['published_at'] ?? null,
      'error' => $job['error'] ?? null,
      'publish_skipped' => $job['publish_skipped'] ?? null,
    ];
    $progress = [
      'audited' => $resultCount,
      'total' => $leadCount,
      'phase' => $phase,
      'status' => $jobStatus !== '' ? $jobStatus : null,
      'needs_continue' => $needsContinue,
      'complete' => $complete,
      'error' => $job['error'] ?? null,
    ];
  }
  ll_ok([
    'config' => $cfg,
    'last_status' => $cfg['last_status'] ?? null,
    'last_keepalive' => $cfg['last_keepalive'] ?? null,
    'last_daily_status' => $cfg['last_daily_status'] ?? null,
    'keepalive' => ll_erp_sync_keepalive_diagnostics($cfg),
    'job' => $jobMeta,
    'progress' => $progress,
  ]);
}

function ll_erp_sync_route_job(): void
{
  ll_require_method('GET');
  ll_erp_sync_require_actor(false);
  $job = ll_erp_sync_load_job();
  if (!$job) {
    ll_ok(['job' => null]);
  }
  // Do not return full leads/results by default (can be huge); allow ?full=1 for Super User debug.
  $full = isset($_GET['full']) && (string) $_GET['full'] === '1';
  if (!$full) {
    $job = [
      'status' => $job['status'] ?? null,
      'cursor' => $job['cursor'] ?? null,
      'lead_count' => $job['lead_count'] ?? null,
      'result_count' => isset($job['results']) && is_array($job['results']) ? count($job['results']) : 0,
      'source_file' => $job['source_file'] ?? null,
      'started_at' => $job['started_at'] ?? null,
      'published_at' => $job['published_at'] ?? null,
      'error' => $job['error'] ?? null,
      'publish_skipped' => $job['publish_skipped'] ?? null,
      'sample_results' => array_slice(is_array($job['results'] ?? null) ? $job['results'] : [], 0, 3),
    ];
  }
  ll_ok(['job' => $job]);
}

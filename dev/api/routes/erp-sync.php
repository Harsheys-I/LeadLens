<?php

declare(strict_types=1);

require_once __DIR__ . '/../lib/erp-sync.php';

/**
 * Super User (or cron bearer for continue). Routes:
 *   POST erp-sync/trigger      → GitHub Actions workflow_dispatch
 *   GET  erp-sync/gha-status   → latest GHA runs + next schedules
 *   POST erp-sync/continue     → resume server audit (self-chain / Hostinger backup)
 *   POST erp-sync/publish      → publish last server-audit results
 *   GET  erp-sync/status       → audit job + api_uploads + GHA summary
 *   GET  erp-sync/job
 *   GET  erp-sync/diagnose     → Super User stuck-audit snapshot (copy/share)
 *   POST erp-sync/kick         → manually fire continue + return diagnose
 *   POST erp-sync/clear-lock   → clear stale (or force) run lock
 *
 * Retired (410): config, test-fetch, fetch-for-audit, latest-leads, run, daily, keepalive/ping
 */
function ll_route_erp_sync(string $action): void
{
  switch ($action) {
    case 'trigger':
      ll_erp_sync_route_trigger();
      break;
    case 'gha-status':
      ll_erp_sync_route_gha_status();
      break;
    case 'continue':
      ll_erp_sync_route_continue();
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
    case 'diagnose':
      ll_erp_sync_route_diagnose();
      break;
    case 'kick':
      ll_erp_sync_route_kick();
      break;
    case 'clear-lock':
      ll_erp_sync_route_clear_lock();
      break;
    case 'config':
    case 'test-fetch':
    case 'fetch-for-audit':
    case 'latest-leads':
    case 'run':
    case 'daily':
    case 'keepalive':
    case 'ping':
      ll_erp_sync_reject_cookie_path($action);
      break;
    default:
      ll_error('Not found', 404);
  }
}

function ll_erp_sync_route_trigger(): void
{
  ll_require_method('POST');
  ll_erp_sync_require_actor(false);
  $body = ll_read_json_body();
  $jobsRaw = $body['jobs'] ?? null;
  $jobs = [];
  if (is_string($jobsRaw)) {
    $jobs = array_filter(array_map('trim', explode(',', $jobsRaw)));
  } elseif (is_array($jobsRaw)) {
    $jobs = $jobsRaw;
  }
  $dryRun = !empty($body['dry_run']);
  $result = ll_erp_sync_gha_dispatch(array_values($jobs), $dryRun);
  if (empty($result['ok'])) {
    ll_error((string) ($result['error'] ?? 'Dispatch failed'), 400, $result);
  }
  ll_ok($result);
}

function ll_erp_sync_route_gha_status(): void
{
  ll_require_method('GET');
  ll_erp_sync_require_actor(false);
  ll_ok(ll_erp_sync_gha_status());
}

function ll_erp_sync_route_continue(): void
{
  ll_require_method('POST');
  $actor = ll_erp_sync_require_actor(true);
  try {
    $result = ll_erp_sync_continue_job($actor);
  } catch (Throwable $e) {
    error_log('LeadLens ERP continue failed: ' . $e->getMessage());
    ll_error('ERP continue failed', 500);
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
    error_log('LeadLens ERP route error: ' . $e->getMessage());
    ll_error('Request failed', 400);
  }
  ll_ok(['published' => $out['published'], 'cleared' => $out['cleared'], 'message' => 'Published from last ERP sync']);
}

function ll_erp_sync_route_status(): void
{
  ll_require_method('GET');
  $actor = ll_erp_sync_require_actor(false);
  $autoKick = ll_erp_sync_maybe_auto_kick($actor);
  $job = ll_erp_sync_load_job();
  $jobMeta = null;
  $progress = ll_erp_sync_public_progress(is_array($job) ? $job : null);
  if (is_array($job)) {
    $leadCount = $job['lead_count'] ?? (isset($job['leads']) && is_array($job['leads']) ? count($job['leads']) : null);
    $resultCount = isset($job['results']) && is_array($job['results']) ? count($job['results']) : 0;
    $jobStatus = (string) ($job['status'] ?? '');
    $needsContinue = $jobStatus === 'auditing';
    $complete = in_array($jobStatus, ['audited', 'ready', 'published'], true);
    $jobMeta = [
      'status' => $job['status'] ?? null,
      'cursor' => $job['cursor'] ?? null,
      'lead_count' => $leadCount,
      'result_count' => $resultCount,
      'audited' => $resultCount,
      'total' => $leadCount,
      'phase' => $progress['status'] ?? null,
      'needs_continue' => $needsContinue,
      'complete' => $complete,
      'pipeline' => $job['pipeline'] ?? null,
      'source_file' => $job['source_file'] ?? null,
      'started_at' => $job['started_at'] ?? null,
      'published_at' => $job['published_at'] ?? null,
      'error' => $job['error'] ?? null,
      'publish_skipped' => $job['publish_skipped'] ?? null,
      'usage' => $progress['usage'] ?? null,
      'elapsed_seconds' => $progress['elapsed_seconds'] ?? 0,
      'estimated_cost' => $progress['estimated_cost'] ?? 0,
    ];
  }
  $gha = ll_erp_sync_gha_status();
  ll_ok([
    'job' => $jobMeta,
    'progress' => $progress,
    'api_uploads' => ll_audit_upload_log_read(),
    'gha' => $gha,
    'last_dispatch' => $gha['last_dispatch'] ?? null,
    'next_runs' => $gha['next_runs'] ?? null,
    'auto_kick' => $autoKick,
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
  $full = isset($_GET['full']) && (string) $_GET['full'] === '1';
  if (!$full) {
    $progress = ll_erp_sync_public_progress($job);
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
      'usage' => $progress['usage'] ?? null,
      'elapsed_seconds' => $progress['elapsed_seconds'] ?? 0,
      'estimated_cost' => $progress['estimated_cost'] ?? 0,
      'sample_results' => array_slice(is_array($job['results'] ?? null) ? $job['results'] : [], 0, 3),
    ];
  }
  ll_ok(['job' => $job]);
}

function ll_erp_sync_route_diagnose(): void
{
  ll_require_method('GET');
  $actor = ll_erp_sync_require_actor(false);
  $autoKick = ll_erp_sync_maybe_auto_kick($actor);
  ll_ok(['diagnose' => ll_erp_sync_diagnose(), 'auto_kick' => $autoKick]);
}

function ll_erp_sync_route_kick(): void
{
  ll_require_method('POST');
  $actor = ll_erp_sync_require_actor(false);
  // If a dead worker left a stale lock, clear it so continue can start.
  $cleared = ll_erp_sync_clear_run_lock(false);
  try {
    $result = ll_erp_sync_continue_job($actor);
  } catch (Throwable $e) {
    error_log('LeadLens ERP kick failed: ' . $e->getMessage());
    ll_error('Kick continue failed: ' . $e->getMessage(), 500);
  }
  ll_ok([
    'ok' => true,
    'lock_cleared' => !empty($cleared['cleared']),
    'kick' => $result,
    'diagnose' => ll_erp_sync_diagnose(),
    'message' => !empty($cleared['cleared'])
      ? 'Cleared stale lock and kicked continue'
      : 'Kick continue dispatched',
  ]);
}

function ll_erp_sync_route_clear_lock(): void
{
  ll_require_method('POST');
  ll_erp_sync_require_actor(false);
  $body = ll_read_json_body();
  $force = !empty($body['force']);
  $out = ll_erp_sync_clear_run_lock($force);
  $out['diagnose'] = ll_erp_sync_diagnose();
  if (empty($out['ok'])) {
    ll_error((string) ($out['message'] ?? 'Could not clear lock'), 409, $out);
  }
  ll_ok($out);
}

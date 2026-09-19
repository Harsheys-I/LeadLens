<?php

declare(strict_types=1);

require_once __DIR__ . '/settings.php';
require_once __DIR__ . '/crypto.php';
require_once __DIR__ . '/dashboard-publish.php';

const LL_ERP_SYNC_CONFIG_KEY = 'erp_sync_config';
const LL_ERP_SYNC_COOKIE_KEY = 'erp_sync_cookie_encrypted';
const LL_ERP_SYNC_CRON_KEY = 'erp_sync_cron_secret_hash';
const LL_ERP_SYNC_JOB_KEY = 'erp_sync_job';
const LL_ERP_SYNC_MAX_BYTES = 25_000_000;
const LL_ERP_SYNC_TIMEOUT = 90;
const LL_ERP_SYNC_KEEPALIVE_TIMEOUT = 20;
const LL_ERP_SYNC_KEEPALIVE_MAX_BYTES = 65_536;
/** Seconds of headroom before max_execution_time when in-request chaining. */
const LL_ERP_SYNC_CHAIN_SAFETY_BUFFER = 18;
/** Stale running lock age (seconds) — allow takeover if a worker died. */
const LL_ERP_SYNC_RUNNING_STALE_SEC = 210;
/** Chain token TTL for fire-and-forget self-continue. */
const LL_ERP_SYNC_CHAIN_TOKEN_TTL = 600;
/** Inclusive IST minutes for cron daily kickoff (05:55–06:45). */
const LL_ERP_SYNC_DAILY_WINDOW_START_MIN = 5 * 60 + 55;
const LL_ERP_SYNC_DAILY_WINDOW_END_MIN = 6 * 60 + 45;

/** @return array<string, list<string>> */
function ll_erp_sync_default_field_map(): array
{
  return [
    'mobile' => ['Mobile', 'Mobile Number', 'Mobile No', 'mobile', 'phone', 'PHONE', 'MOBILE_NO'],
    'project' => ['Project Name', 'Project', 'project', 'PROJECT_NAME'],
    'registration' => ['Lead Registration Date', 'Registration Date', 'LRD', 'registration'],
    'telecaller' => ['Telecaller Name', 'Tele Caller Name', 'Agent Name', 'telecaller', 'EXECUTIVE_NAME'],
    'source' => ['Source', 'Source Name', 'source'],
    'update' => ['Lead Update Date', 'Call Date', 'Update Date', 'LUD', 'update'],
    'status' => ['Lead Status', 'Status', 'status', 'LEAD_STATUS'],
    'comments' => ['Comments', 'Comment', 'Remarks', 'remarks', 'comments'],
    'next' => ['Next Followup Date', 'Next Follow-up Date', 'NFD', 'next'],
    'location' => ['Customer Location', 'Location', 'location'],
    'requirement' => ['Customer Requirement', 'Requirement', 'requirement'],
    'parameter' => ['Analysis Parameter', 'Analysis Parameters', 'parameter'],
    'budget' => ['Estimated Budget', 'Budget', 'budget'],
  ];
}

function ll_erp_sync_storage_dir(): string
{
  $dir = __DIR__ . '/../storage/erp-sync';
  if (!is_dir($dir)) {
    @mkdir($dir, 0750, true);
  }
  $deny = $dir . '/.htaccess';
  if (!is_file($deny)) {
    @file_put_contents($deny, "Require all denied\n");
  }
  return $dir;
}

/** @return array<string, mixed> */
function ll_erp_sync_default_config(): array
{
  return [
    'report_url' => '',
    'http_method' => 'GET',
    'extra_headers' => new stdClass(),
    /** @deprecated Prefer daily_enabled — kept so older cron /run gates still work */
    'enabled' => false,
    /** Daily 6 AM IST kickoff: fetch → server AI audit → optional publish */
    'daily_enabled' => false,
    'keepalive_enabled' => false,
    'keepalive_url' => '',
    /** Manual / advanced server-audit path (defaults off) */
    'auto_publish' => false,
    /** Scheduled daily/continue path — defaults on so dashboards upload after audit */
    'cron_auto_publish' => true,
    'batch_size' => 10,
    'max_leads_per_run' => 40,
    'rows_path' => '',
    'field_map' => ll_erp_sync_default_field_map(),
    'cookie_configured' => false,
    'cron_secret_configured' => false,
    'last_status' => null,
    'last_keepalive' => null,
    'last_daily_status' => null,
  ];
}

/** @return array<string, mixed> */
function ll_erp_sync_load_config(): array
{
  $base = ll_erp_sync_default_config();
  $row = ll_setting_get(LL_ERP_SYNC_CONFIG_KEY);
  if ($row && $row['setting_value']) {
    $decoded = json_decode((string) $row['setting_value'], true);
    if (is_array($decoded)) {
      $base = array_merge($base, $decoded);
      // Migrate older configs that only had `enabled`.
      if (!array_key_exists('daily_enabled', $decoded) && !empty($decoded['enabled'])) {
        $base['daily_enabled'] = true;
      }
      if (!array_key_exists('cron_auto_publish', $decoded)) {
        $base['cron_auto_publish'] = true;
      }
    }
  }
  if (!isset($base['field_map']) || !is_array($base['field_map'])) {
    $base['field_map'] = ll_erp_sync_default_field_map();
  }
  if (!is_array($base['extra_headers'] ?? null) && !($base['extra_headers'] instanceof stdClass)) {
    $base['extra_headers'] = [];
  }
  $cookieRow = ll_setting_get(LL_ERP_SYNC_COOKIE_KEY);
  $base['cookie_configured'] = $cookieRow && trim((string) ($cookieRow['setting_value'] ?? '')) !== '';
  $cronRow = ll_setting_get(LL_ERP_SYNC_CRON_KEY);
  $base['cron_secret_configured'] = $cronRow && trim((string) ($cronRow['setting_value'] ?? '')) !== '';
  // Never expose secrets in public config.
  unset($base['cookie'], $base['cookie_header'], $base['cron_secret']);
  return $base;
}

/**
 * Public-safe config for GET responses (no secrets).
 * @return array<string, mixed>
 */
function ll_erp_sync_public_config(): array
{
  $cfg = ll_erp_sync_load_config();
  if ($cfg['extra_headers'] instanceof stdClass) {
    $cfg['extra_headers'] = (array) $cfg['extra_headers'];
  }
  // Strip any accidental Authorization / Cookie from extra headers listing values.
  $safeHeaders = [];
  foreach ((array) ($cfg['extra_headers'] ?? []) as $k => $v) {
    $lk = strtolower((string) $k);
    if ($lk === 'cookie' || $lk === 'authorization') {
      $safeHeaders[$k] = '(stored separately)';
      continue;
    }
    $safeHeaders[$k] = $v;
  }
  $cfg['extra_headers'] = $safeHeaders;
  unset($cfg['daily_chain_token'], $cfg['daily_chain_token_at']);
  return $cfg;
}

/**
 * Persist config. Body may include cookie / cron_secret which are stored encrypted/hashed.
 * @param array<string, mixed> $body
 */
function ll_erp_sync_save_config(array $body, int $userId): array
{
  $current = ll_erp_sync_load_config();
  $next = $current;

  if (array_key_exists('report_url', $body)) {
    $next['report_url'] = trim((string) $body['report_url']);
  }
  if (array_key_exists('http_method', $body)) {
    $method = strtoupper(trim((string) $body['http_method']));
    $next['http_method'] = in_array($method, ['GET', 'POST'], true) ? $method : 'GET';
  }
  if (array_key_exists('extra_headers', $body) && is_array($body['extra_headers'])) {
    $headers = [];
    foreach ($body['extra_headers'] as $k => $v) {
      $name = trim((string) $k);
      if ($name === '') {
        continue;
      }
      $lk = strtolower($name);
      if ($lk === 'cookie' || $lk === 'authorization') {
        continue;
      }
      $headers[$name] = trim((string) $v);
    }
    $next['extra_headers'] = $headers;
  }
  if (array_key_exists('enabled', $body)) {
    $next['enabled'] = (bool) $body['enabled'];
  }
  if (array_key_exists('daily_enabled', $body)) {
    $next['daily_enabled'] = (bool) $body['daily_enabled'];
    // Keep legacy `enabled` in sync so older /run cron jobs still gate correctly.
    $next['enabled'] = (bool) $body['daily_enabled'];
  } elseif (array_key_exists('enabled', $body)) {
    // Saving only legacy checkbox still drives daily_enabled.
    $next['daily_enabled'] = (bool) $body['enabled'];
  }
  if (array_key_exists('keepalive_enabled', $body)) {
    $next['keepalive_enabled'] = (bool) $body['keepalive_enabled'];
  }
  if (array_key_exists('keepalive_url', $body)) {
    $next['keepalive_url'] = trim((string) $body['keepalive_url']);
  }
  if (array_key_exists('auto_publish', $body)) {
    $next['auto_publish'] = (bool) $body['auto_publish'];
  }
  if (array_key_exists('cron_auto_publish', $body)) {
    $next['cron_auto_publish'] = (bool) $body['cron_auto_publish'];
  }
  if (array_key_exists('batch_size', $body)) {
    $next['batch_size'] = max(1, min(20, (int) $body['batch_size']));
  }
  if (array_key_exists('max_leads_per_run', $body)) {
    $next['max_leads_per_run'] = max(1, min(200, (int) $body['max_leads_per_run']));
  }
  if (array_key_exists('rows_path', $body)) {
    $next['rows_path'] = trim((string) $body['rows_path']);
  }
  if (array_key_exists('field_map', $body) && is_array($body['field_map'])) {
    $map = [];
    foreach ($body['field_map'] as $fieldId => $aliases) {
      $id = trim((string) $fieldId);
      if ($id === '') {
        continue;
      }
      if (is_string($aliases)) {
        $parts = array_values(array_filter(array_map('trim', explode(',', $aliases)), static fn ($s) => $s !== ''));
        $map[$id] = $parts;
      } elseif (is_array($aliases)) {
        $map[$id] = array_values(array_filter(array_map(static fn ($s) => trim((string) $s), $aliases), static fn ($s) => $s !== ''));
      }
    }
    if ($map) {
      $next['field_map'] = $map;
    }
  }

  // Secrets — never land in the JSON blob.
  $cookie = trim((string) ($body['cookie'] ?? $body['cookie_header'] ?? ''));
  if ($cookie !== '') {
    if (stripos($cookie, 'cookie:') === 0) {
      $cookie = trim(substr($cookie, 7));
    }
    ll_setting_set(LL_ERP_SYNC_COOKIE_KEY, ll_encrypt_secret($cookie), $userId);
  }
  if (!empty($body['clear_cookie'])) {
    ll_setting_delete(LL_ERP_SYNC_COOKIE_KEY);
  }

  $cronSecret = trim((string) ($body['cron_secret'] ?? ''));
  if ($cronSecret !== '') {
    ll_setting_set(LL_ERP_SYNC_CRON_KEY, password_hash($cronSecret, PASSWORD_DEFAULT), $userId);
  }
  if (!empty($body['clear_cron_secret'])) {
    ll_setting_delete(LL_ERP_SYNC_CRON_KEY);
  }

  unset($next['cookie_configured'], $next['cron_secret_configured'], $next['cookie'], $next['cron_secret']);
  $json = json_encode($next, JSON_UNESCAPED_UNICODE);
  if ($json === false) {
    ll_error('Could not encode ERP sync config');
  }
  ll_setting_set(LL_ERP_SYNC_CONFIG_KEY, $json, $userId);
  return ll_erp_sync_public_config();
}

function ll_erp_sync_cookie_plaintext(): ?string
{
  $row = ll_setting_get(LL_ERP_SYNC_COOKIE_KEY);
  if (!$row || trim((string) ($row['setting_value'] ?? '')) === '') {
    return null;
  }
  $plain = ll_decrypt_secret((string) $row['setting_value']);
  return ($plain !== null && $plain !== '') ? $plain : null;
}

function ll_erp_sync_verify_cron_secret(string $candidate): bool
{
  $row = ll_setting_get(LL_ERP_SYNC_CRON_KEY);
  if (!$row || trim((string) ($row['setting_value'] ?? '')) === '') {
    return false;
  }
  return password_verify($candidate, (string) $row['setting_value']);
}

/**
 * Super User session or cron Bearer / X-ERP-Sync-Secret.
 * @return array{id:int,display_name:string,username:string,is_super:bool}
 */
function ll_erp_sync_require_actor(bool $allowCron = false): array
{
  if ($allowCron) {
    $chain = ll_erp_sync_extract_chain_token();
    if ($chain !== null && $chain !== '') {
      if (!ll_erp_sync_verify_chain_token($chain)) {
        ll_error('Invalid or expired chain token', 401);
      }
      return [
        'id' => 0,
        'display_name' => 'ERP Sync Self-Chain',
        'username' => 'erp-sync-cron',
        'is_super' => true,
      ];
    }
    $secret = ll_erp_sync_extract_bearer();
    if ($secret !== null && $secret !== '') {
      if (!ll_erp_sync_verify_cron_secret($secret)) {
        ll_error('Invalid cron secret', 401);
      }
      return [
        'id' => 0,
        'display_name' => 'ERP Sync Cron',
        'username' => 'erp-sync-cron',
        'is_super' => true,
      ];
    }
  }
  $user = ll_require_user();
  if (empty($user['is_super'])) {
    ll_error('Only Super User can manage ERP sync', 403);
  }
  return $user;
}

/** One-time self-chain token (header only — never logged). */
function ll_erp_sync_extract_chain_token(): ?string
{
  $raw = trim((string) ($_SERVER['HTTP_X_ERP_SYNC_CHAIN'] ?? ''));
  return $raw !== '' ? $raw : null;
}

function ll_erp_sync_verify_chain_token(string $candidate): bool
{
  $job = ll_erp_sync_load_job();
  if (is_array($job) && ($job['status'] ?? '') === 'auditing') {
    $expected = (string) ($job['chain_token'] ?? '');
    $at = (int) ($job['chain_token_at'] ?? 0);
    if (
      $expected !== ''
      && hash_equals($expected, $candidate)
      && $at > 0
      && (time() - $at) <= LL_ERP_SYNC_CHAIN_TOKEN_TTL
    ) {
      return true;
    }
  }
  return ll_erp_sync_verify_daily_chain_token($candidate);
}

function ll_erp_sync_verify_daily_chain_token(string $candidate): bool
{
  $cfg = ll_erp_sync_load_config();
  $expected = (string) ($cfg['daily_chain_token'] ?? '');
  if ($expected === '' || !hash_equals($expected, $candidate)) {
    return false;
  }
  $at = (int) ($cfg['daily_chain_token_at'] ?? 0);
  return $at > 0 && (time() - $at) <= LL_ERP_SYNC_CHAIN_TOKEN_TTL;
}

function ll_erp_sync_extract_bearer(): ?string
{
  $candidates = [
    $_SERVER['HTTP_AUTHORIZATION'] ?? '',
    $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '',
    $_SERVER['HTTP_X_ERP_SYNC_SECRET'] ?? '',
  ];
  foreach ($candidates as $raw) {
    $raw = trim((string) $raw);
    if ($raw === '') {
      continue;
    }
    if (preg_match('/^Bearer\s+(\S+)/i', $raw, $m)) {
      return $m[1];
    }
    // Bare secret via X-ERP-Sync-Secret
    if (!str_contains(strtolower($raw), ' ')) {
      return $raw;
    }
  }
  // Hostinger "Fetch URL" cron cannot set headers — allow ?cron_secret= as last resort.
  foreach (['cron_secret', 'secret'] as $key) {
    if (!isset($_GET[$key])) {
      continue;
    }
    $q = trim((string) $_GET[$key]);
    if ($q !== '') {
      return $q;
    }
  }
  return null;
}

/** @param array<string, mixed> $status */
function ll_erp_sync_set_last_status(array $status): void
{
  $cfg = ll_erp_sync_load_config();
  // Never persist cookie values into status.
  unset($status['cookie'], $status['request_headers']);
  $cfg['last_status'] = $status;
  unset($cfg['cookie_configured'], $cfg['cron_secret_configured']);
  $json = json_encode($cfg, JSON_UNESCAPED_UNICODE);
  if ($json !== false) {
    ll_setting_set(LL_ERP_SYNC_CONFIG_KEY, $json, null);
  }
}

/** @param array<string, mixed> $status */
function ll_erp_sync_set_last_keepalive(array $status): void
{
  $cfg = ll_erp_sync_load_config();
  unset($status['cookie'], $status['request_headers'], $status['body']);
  $cfg['last_keepalive'] = $status;
  unset($cfg['cookie_configured'], $cfg['cron_secret_configured']);
  $json = json_encode($cfg, JSON_UNESCAPED_UNICODE);
  if ($json !== false) {
    ll_setting_set(LL_ERP_SYNC_CONFIG_KEY, $json, null);
  }
}

/**
 * Client-facing keep-alive health for the ERP Sync panel.
 * @param array<string, mixed> $cfg
 * @return array<string, mixed>
 */
function ll_erp_sync_keepalive_diagnostics(array $cfg): array
{
  $enabled = !empty($cfg['keepalive_enabled']);
  $ka = is_array($cfg['last_keepalive'] ?? null) ? $cfg['last_keepalive'] : null;
  $at = is_array($ka) ? (string) ($ka['at'] ?? '') : '';
  $ageSec = null;
  if ($at !== '') {
    $ts = strtotime($at);
    if ($ts !== false) {
      $ageSec = max(0, time() - $ts);
    }
  }
  $source = is_array($ka) ? (string) ($ka['source'] ?? '') : '';
  $cronSilent = $enabled && ($source !== 'cron' || ($ageSec !== null && $ageSec > 180));
  $hint = '';
  if (!$enabled) {
    $hint = 'Keep-alive is off. Enable the checkbox, Save, and set Hostinger cron to */1.';
  } elseif (!$cfg['cron_secret_configured']) {
    $hint = 'Set a Cron bearer secret and Save before Hostinger cron can authenticate.';
  } elseif ($ka === null) {
    $hint = 'No keep-alive ping recorded yet. Use Ping keep-alive now, then confirm hPanel cron hits production /api/erp-sync/keepalive.';
  } elseif ($cronSilent) {
    $hint = 'Enabled, but no recent cron ping (last was '
      . ($source !== '' ? $source : 'unknown')
      . '). Save alone does not schedule pings — Hostinger must call production https://ai.gurupunvaanii.com/api/erp-sync/keepalive every minute.';
  } elseif (!empty($ka['session_expired'])) {
    $hint = 'Session expired after keep-alive — paste a fresh Cookie and Save.';
  }
  return [
    'enabled' => $enabled,
    'cron_secret_configured' => !empty($cfg['cron_secret_configured']),
    'last' => $ka,
    'age_seconds' => $ageSec,
    'cron_silent' => $cronSilent,
    'hint' => $hint,
  ];
}

/** @param array<string, mixed> $status */
function ll_erp_sync_set_last_daily_status(array $status): void
{
  $cfg = ll_erp_sync_load_config();
  unset($status['cookie'], $status['request_headers'], $status['body'], $status['leads'], $status['results']);
  $cfg['last_daily_status'] = $status;
  unset($cfg['cookie_configured'], $cfg['cron_secret_configured']);
  $json = json_encode($cfg, JSON_UNESCAPED_UNICODE);
  if ($json !== false) {
    ll_setting_set(LL_ERP_SYNC_CONFIG_KEY, $json, null);
  }
}

/** Daily pipeline is on when either the new or legacy flag is set. */
function ll_erp_sync_daily_is_enabled(array $cfg): bool
{
  return !empty($cfg['daily_enabled']) || !empty($cfg['enabled']);
}

function ll_erp_sync_ist_now(): DateTimeImmutable
{
  return new DateTimeImmutable('now', new DateTimeZone('Asia/Kolkata'));
}

function ll_erp_sync_ist_today(): string
{
  return ll_erp_sync_ist_now()->format('Y-m-d');
}

function ll_erp_sync_in_daily_window(?DateTimeImmutable $now = null): bool
{
  $now = $now ?? ll_erp_sync_ist_now();
  $minutes = ((int) $now->format('G')) * 60 + (int) $now->format('i');
  return $minutes >= LL_ERP_SYNC_DAILY_WINDOW_START_MIN
    && $minutes <= LL_ERP_SYNC_DAILY_WINDOW_END_MIN;
}

/**
 * Persist extra config keys (no secrets). Null deletes a key.
 * @param array<string, mixed|null> $fields
 */
function ll_erp_sync_persist_config_fields(array $fields): void
{
  $cfg = ll_erp_sync_load_config();
  foreach ($fields as $key => $value) {
    if ($value === null) {
      unset($cfg[$key]);
    } else {
      $cfg[$key] = $value;
    }
  }
  unset($cfg['cookie_configured'], $cfg['cron_secret_configured']);
  $json = json_encode($cfg, JSON_UNESCAPED_UNICODE);
  if ($json !== false) {
    ll_setting_set(LL_ERP_SYNC_CONFIG_KEY, $json, null);
  }
}

function ll_erp_sync_mark_daily_kickoff_today(): void
{
  ll_erp_sync_persist_config_fields([
    'last_daily_kickoff_ist_date' => ll_erp_sync_ist_today(),
    'daily_chain_token' => null,
    'daily_chain_token_at' => null,
  ]);
}

/**
 * Whether cron should start a fresh daily fetch now (6:00 AM IST window).
 */
function ll_erp_sync_cron_should_start_daily(array $cfg): bool
{
  if (!ll_erp_sync_daily_is_enabled($cfg) || !ll_erp_sync_in_daily_window()) {
    return false;
  }
  $job = ll_erp_sync_load_job();
  if (is_array($job) && ($job['status'] ?? '') === 'auditing') {
    return false;
  }
  $today = ll_erp_sync_ist_today();
  if ((string) ($cfg['last_daily_kickoff_ist_date'] ?? '') !== $today) {
    return true;
  }
  $daily = is_array($cfg['last_daily_status'] ?? null) ? $cfg['last_daily_status'] : null;
  if (!is_array($daily) || ($daily['ok'] ?? true) !== false) {
    return false;
  }
  $at = strtotime((string) ($daily['at'] ?? ''));
  return $at !== false && (time() - $at) >= 600;
}

/** @return array<string, mixed> */
function ll_erp_sync_daily_schedule_info(array $cfg): array
{
  $now = ll_erp_sync_ist_now();
  $today6 = $now->setTime(6, 0, 0);
  $windowEnd = $now->setTime(6, 45, 0);
  $startedToday = (string) ($cfg['last_daily_kickoff_ist_date'] ?? '') === $now->format('Y-m-d');
  if (!$startedToday && $now <= $windowEnd) {
    $next = $today6;
  } else {
    $next = $today6->modify('+1 day');
  }
  return [
    'timezone' => 'Asia/Kolkata',
    'window' => '05:55–06:45 IST',
    'in_window' => ll_erp_sync_in_daily_window($now),
    'next_at' => $next->format('c'),
    'kickoff_ist_date' => (string) ($cfg['last_daily_kickoff_ist_date'] ?? ''),
  ];
}

/**
 * Resolve auto-publish for a run mode.
 * @param 'auto_publish'|'cron_auto_publish' $key
 */
function ll_erp_sync_resolve_auto_publish(array $cfg, string $key, bool $dryRun): bool
{
  if ($dryRun) {
    return false;
  }
  if ($key === 'cron_auto_publish') {
    // Default ON when key absent (older saved configs).
    if (!array_key_exists('cron_auto_publish', $cfg)) {
      return true;
    }
    return !empty($cfg['cron_auto_publish']);
  }
  return !empty($cfg['auto_publish']);
}

/**
 * @return array{ok:bool,status:int,content_type:string,body:string,bytes:int,error?:string,session_expired?:bool}
 */
function ll_erp_sync_http_fetch(string $url, string $method, ?string $cookie, array $extraHeaders): array
{
  if (!function_exists('curl_init')) {
    return ['ok' => false, 'status' => 0, 'content_type' => '', 'body' => '', 'bytes' => 0, 'error' => 'cURL required'];
  }
  if ($url === '' || !preg_match('#^https?://#i', $url)) {
    return ['ok' => false, 'status' => 0, 'content_type' => '', 'body' => '', 'bytes' => 0, 'error' => 'Invalid report URL'];
  }

  $headers = ['Accept: application/json, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, */*'];
  foreach ($extraHeaders as $k => $v) {
    $name = trim((string) $k);
    $lk = strtolower($name);
    if ($name === '' || $lk === 'cookie' || $lk === 'authorization') {
      continue;
    }
    $headers[] = $name . ': ' . trim((string) $v);
  }
  if ($cookie !== null && $cookie !== '') {
    $headers[] = 'Cookie: ' . $cookie;
  }

  $ch = curl_init($url);
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS => 5,
    CURLOPT_TIMEOUT => LL_ERP_SYNC_TIMEOUT,
    CURLOPT_CUSTOMREQUEST => $method,
    CURLOPT_HTTPHEADER => $headers,
    CURLOPT_USERAGENT => 'LeadLens-ERP-Sync/1.0',
    CURLOPT_SSL_VERIFYPEER => true,
  ]);
  $body = curl_exec($ch);
  $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
  $contentType = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
  $err = curl_error($ch);
  curl_close($ch);

  if ($body === false) {
    return ['ok' => false, 'status' => $status, 'content_type' => $contentType, 'body' => '', 'bytes' => 0, 'error' => $err ?: 'fetch failed'];
  }
  $bytes = strlen($body);
  if ($bytes > LL_ERP_SYNC_MAX_BYTES) {
    return ['ok' => false, 'status' => $status, 'content_type' => $contentType, 'body' => '', 'bytes' => $bytes, 'error' => 'Payload too large'];
  }

  $sessionExpired = ll_erp_sync_looks_like_login($body, $contentType, $status);
  $ok = $status >= 200 && $status < 300 && !$sessionExpired && $bytes > 0;
  return [
    'ok' => $ok,
    'status' => $status,
    'content_type' => $contentType,
    'body' => $body,
    'bytes' => $bytes,
    'session_expired' => $sessionExpired,
    'error' => $sessionExpired ? 'ERP session expired — refresh Cookie in /dev ERP Sync' : ($ok ? null : ('HTTP ' . $status)),
  ];
}

function ll_erp_sync_looks_like_login(string $body, string $contentType, int $status): bool
{
  if ($status === 401 || $status === 403) {
    return true;
  }
  $ct = strtolower($contentType);
  $sample = strtolower(substr($body, 0, 4000));
  if (str_contains($ct, 'html') || str_starts_with(ltrim($body), '<')) {
    if (
      str_contains($sample, 'login')
      || str_contains($sample, 'signin')
      || str_contains($sample, 'sign-in')
      || str_contains($sample, 'j_password')
      || str_contains($sample, 'session expired')
      || str_contains($sample, 'please log')
    ) {
      return true;
    }
  }
  if (str_contains($sample, '"error"') && (str_contains($sample, 'unauthorized') || str_contains($sample, 'session'))) {
    return true;
  }
  return false;
}

/**
 * Lightweight session ping: short timeout, follow redirects, truncate body.
 * Does not store payloads or run Audit.
 *
 * @return array{ok:bool,status:int,content_type:string,bytes:int,error?:string,session_expired?:bool,method?:string}
 */
function ll_erp_sync_http_ping(string $url, ?string $cookie, array $extraHeaders): array
{
  if (!function_exists('curl_init')) {
    return ['ok' => false, 'status' => 0, 'content_type' => '', 'bytes' => 0, 'error' => 'cURL required'];
  }
  if ($url === '' || !preg_match('#^https?://#i', $url)) {
    return ['ok' => false, 'status' => 0, 'content_type' => '', 'bytes' => 0, 'error' => 'Invalid keep-alive URL'];
  }

  $headers = ['Accept: text/html, application/json, */*'];
  foreach ($extraHeaders as $k => $v) {
    $name = trim((string) $k);
    $lk = strtolower($name);
    if ($name === '' || $lk === 'cookie' || $lk === 'authorization') {
      continue;
    }
    $headers[] = $name . ': ' . trim((string) $v);
  }
  if ($cookie !== null && $cookie !== '') {
    $headers[] = 'Cookie: ' . $cookie;
  }

  $body = '';
  $bytesRead = 0;
  $truncated = false;
  $ch = curl_init($url);
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => false,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS => 5,
    CURLOPT_TIMEOUT => LL_ERP_SYNC_KEEPALIVE_TIMEOUT,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_HTTPGET => true,
    CURLOPT_HTTPHEADER => $headers,
    CURLOPT_USERAGENT => 'LeadLens-ERP-KeepAlive/1.0',
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_HEADER => false,
    CURLOPT_WRITEFUNCTION => static function ($ch, string $chunk) use (&$body, &$bytesRead, &$truncated): int {
      $len = strlen($chunk);
      if ($bytesRead >= LL_ERP_SYNC_KEEPALIVE_MAX_BYTES) {
        $truncated = true;
        return 0;
      }
      $remain = LL_ERP_SYNC_KEEPALIVE_MAX_BYTES - $bytesRead;
      $take = min($len, $remain);
      $body .= substr($chunk, 0, $take);
      $bytesRead += $take;
      if ($take < $len || $bytesRead >= LL_ERP_SYNC_KEEPALIVE_MAX_BYTES) {
        $truncated = true;
        return 0;
      }
      return $len;
    },
  ]);
  $okExec = curl_exec($ch);
  $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
  $contentType = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
  $err = curl_error($ch);
  curl_close($ch);

  // Intentional early abort after sampling body is OK (avoids downloading full reports).
  if ($okExec === false && !($truncated && $status > 0)) {
    return [
      'ok' => false,
      'status' => $status,
      'content_type' => $contentType,
      'bytes' => $bytesRead,
      'error' => $err ?: 'keep-alive ping failed',
      'method' => 'GET',
    ];
  }

  $sessionExpired = ll_erp_sync_looks_like_login($body, $contentType, $status);
  $ok = $status >= 200 && $status < 400 && !$sessionExpired;
  return [
    'ok' => $ok,
    'status' => $status,
    'content_type' => $contentType,
    'bytes' => $bytesRead,
    'session_expired' => $sessionExpired,
    'method' => 'GET',
    'error' => $sessionExpired
      ? 'ERP session expired — refresh Cookie in /dev ERP Sync'
      : ($ok ? null : ('HTTP ' . $status)),
  ];
}

/**
 * Ping ERP with saved Cookie so idle sessions may last longer.
 * Updates last_keepalive only. Cron pings also fire-and-forget `/daily` at 6:00 AM IST
 * (the ping itself never runs Audit inline).
 *
 * @param 'manual'|'cron' $source
 * @return array<string, mixed>
 */
function ll_erp_sync_keepalive(string $source = 'manual'): array
{
  $source = $source === 'cron' ? 'cron' : 'manual';
  $cfg = ll_erp_sync_load_config();
  $url = trim((string) ($cfg['keepalive_url'] ?? ''));
  if ($url === '') {
    $url = trim((string) ($cfg['report_url'] ?? ''));
  }
  $cookie = ll_erp_sync_cookie_plaintext();
  if ($url === '') {
    $status = [
      'ok' => false,
      'result' => 'error',
      'error' => 'No keep-alive or report URL configured',
      'source' => $source,
      'at' => gmdate('c'),
    ];
    ll_erp_sync_set_last_keepalive($status);
    return $status;
  }
  if ($cookie === null) {
    $status = [
      'ok' => false,
      'result' => 'session_expired',
      'error' => 'Cookie not configured — paste Cookie header in ERP Sync',
      'session_expired' => true,
      'source' => $source,
      'at' => gmdate('c'),
    ];
    ll_erp_sync_set_last_keepalive($status);
    return $status;
  }

  $extra = $cfg['extra_headers'] ?? [];
  if ($extra instanceof stdClass) {
    $extra = (array) $extra;
  }
  $ping = ll_erp_sync_http_ping($url, $cookie, (array) $extra);

  if (!empty($ping['session_expired'])) {
    $status = [
      'ok' => false,
      'result' => 'session_expired',
      'error' => $ping['error'] ?? 'session_expired',
      'session_expired' => true,
      'http_status' => $ping['status'],
      'bytes' => $ping['bytes'] ?? 0,
      'url_host' => (string) (parse_url($url, PHP_URL_HOST) ?: ''),
      'source' => $source,
      'at' => gmdate('c'),
    ];
    ll_erp_sync_set_last_keepalive($status);
    return $status;
  }
  if (empty($ping['ok'])) {
    $status = [
      'ok' => false,
      'result' => 'error',
      'error' => $ping['error'] ?? 'keep-alive failed',
      'http_status' => $ping['status'],
      'bytes' => $ping['bytes'] ?? 0,
      'url_host' => (string) (parse_url($url, PHP_URL_HOST) ?: ''),
      'source' => $source,
      'at' => gmdate('c'),
    ];
    ll_erp_sync_set_last_keepalive($status);
    return $status;
  }

  $status = [
    'ok' => true,
    'result' => 'ok',
    'http_status' => $ping['status'],
    'bytes' => $ping['bytes'] ?? 0,
    'content_type' => $ping['content_type'] ?? '',
    'url_host' => (string) (parse_url($url, PHP_URL_HOST) ?: ''),
    'source' => $source,
    'at' => gmdate('c'),
  ];
  ll_erp_sync_set_last_keepalive($status);
  try {
    $queued = ll_erp_sync_maybe_queue_daily_from_keepalive($source);
    if (is_array($queued) && !empty($queued['queued'])) {
      $status['daily_queued'] = true;
    }
  } catch (Throwable $e) {
    // Keep-alive must stay a cheap ping even if daily queue fails.
  }
  return $status;
}

function ll_erp_sync_store_payload(string $body, string $contentType): string
{
  $dir = ll_erp_sync_storage_dir();
  $name = 'payload-' . gmdate('Ymd-His') . '-' . bin2hex(random_bytes(4)) . '.bin';
  $path = $dir . '/' . $name;
  file_put_contents($path, $body);
  // Convenience overwrite for "latest raw" readers.
  @file_put_contents($dir . '/latest.bin', $body);
  @file_put_contents($dir . '/latest.meta.json', json_encode([
    'file' => $name,
    'latest' => 'latest.bin',
    'content_type' => $contentType,
    'bytes' => strlen($body),
    'fetched_at' => gmdate('c'),
  ], JSON_UNESCAPED_UNICODE));
  // Keep only the newest few payloads.
  $files = glob($dir . '/payload-*.bin') ?: [];
  rsort($files);
  foreach (array_slice($files, 5) as $old) {
    @unlink($old);
  }
  return $name;
}

/**
 * Persist mapped leads for the main TeleCaller Audit UI (overwrite latest).
 *
 * @param array{leads: list<array>, row_count: int, lead_count: int, mapped_columns: array<string,string>, missing_required?: list<string>} $mapped
 * @return array{file: string, lead_count: int, row_count: int, bytes: int}
 */
function ll_erp_sync_store_mapped_leads(array $mapped, string $payloadFile, string $contentType = ''): array
{
  $dir = ll_erp_sync_storage_dir();
  $fetchedAt = gmdate('c');
  $doc = [
    'version' => 1,
    'payload_file' => $payloadFile,
    'source_file' => 'ERP:' . $payloadFile,
    'content_type' => $contentType,
    'fetched_at' => $fetchedAt,
    'row_count' => (int) ($mapped['row_count'] ?? 0),
    'lead_count' => (int) ($mapped['lead_count'] ?? count($mapped['leads'] ?? [])),
    'mapped_columns' => $mapped['mapped_columns'] ?? new stdClass(),
    'leads' => array_values($mapped['leads'] ?? []),
  ];
  $json = json_encode($doc, JSON_UNESCAPED_UNICODE);
  if ($json === false) {
    throw new RuntimeException('Could not encode mapped leads');
  }
  $path = $dir . '/latest-leads.json';
  if (file_put_contents($path, $json) === false) {
    throw new RuntimeException('Could not write latest-leads.json');
  }
  $metaPath = $dir . '/latest.meta.json';
  $meta = [];
  if (is_file($metaPath)) {
    $decoded = json_decode((string) file_get_contents($metaPath), true);
    if (is_array($decoded)) {
      $meta = $decoded;
    }
  }
  $meta['file'] = $meta['file'] ?? $payloadFile;
  $meta['latest'] = $meta['latest'] ?? 'latest.bin';
  $meta['leads_file'] = 'latest-leads.json';
  $meta['lead_count'] = $doc['lead_count'];
  $meta['row_count'] = $doc['row_count'];
  $meta['mapped_at'] = $fetchedAt;
  @file_put_contents($metaPath, json_encode($meta, JSON_UNESCAPED_UNICODE));
  return [
    'file' => 'latest-leads.json',
    'lead_count' => $doc['lead_count'],
    'row_count' => $doc['row_count'],
    'bytes' => strlen($json),
  ];
}

/** @return ?array<string, mixed> */
function ll_erp_sync_load_latest_leads(): ?array
{
  $path = ll_erp_sync_storage_dir() . '/latest-leads.json';
  if (!is_file($path)) {
    return null;
  }
  $decoded = json_decode((string) file_get_contents($path), true);
  return is_array($decoded) ? $decoded : null;
}

/**
 * Fetch ERP once → store raw payload → map → store latest-leads.json (no OpenAI).
 *
 * @return array<string, mixed>
 */
function ll_erp_sync_fetch_for_audit(): array
{
  @set_time_limit(180);
  $cfg = ll_erp_sync_load_config();
  $url = trim((string) ($cfg['report_url'] ?? ''));
  $cookie = ll_erp_sync_cookie_plaintext();
  if ($url === '') {
    return ['ok' => false, 'error' => 'Report URL not configured', 'phase' => 'fetch'];
  }
  if ($cookie === null) {
    return [
      'ok' => false,
      'error' => 'Cookie not configured — paste Cookie header in /dev ERP Sync',
      'phase' => 'fetch',
      'session_expired' => true,
    ];
  }
  $extra = $cfg['extra_headers'] ?? [];
  if ($extra instanceof stdClass) {
    $extra = (array) $extra;
  }
  $fetch = ll_erp_sync_http_fetch($url, (string) ($cfg['http_method'] ?? 'GET'), $cookie, (array) $extra);
  if (!empty($fetch['session_expired'])) {
    ll_erp_sync_set_last_status([
      'ok' => false,
      'phase' => 'fetch-for-audit',
      'error' => $fetch['error'] ?? 'session_expired',
      'session_expired' => true,
      'http_status' => $fetch['status'],
      'at' => gmdate('c'),
    ]);
    return [
      'ok' => false,
      'error' => $fetch['error'] ?? 'ERP session expired',
      'phase' => 'fetch',
      'session_expired' => true,
      'http_status' => $fetch['status'],
    ];
  }
  if (empty($fetch['ok'])) {
    ll_erp_sync_set_last_status([
      'ok' => false,
      'phase' => 'fetch-for-audit',
      'error' => $fetch['error'] ?? 'fetch failed',
      'http_status' => $fetch['status'],
      'at' => gmdate('c'),
    ]);
    return [
      'ok' => false,
      'error' => $fetch['error'] ?? 'fetch failed',
      'phase' => 'fetch',
      'http_status' => $fetch['status'],
    ];
  }

  $file = ll_erp_sync_store_payload($fetch['body'], $fetch['content_type']);
  $format = ll_erp_sync_detect_format($fetch['body'], $fetch['content_type']);
  if ($format === 'json') {
    $decoded = json_decode($fetch['body'], true);
    if (!is_array($decoded)) {
      return ['ok' => false, 'error' => 'Invalid JSON payload', 'phase' => 'parse'];
    }
    [$rows, $usedPath] = ll_erp_sync_extract_rows($decoded, (string) ($cfg['rows_path'] ?? ''));
  } elseif ($format === 'xlsx') {
    try {
      $rows = ll_erp_sync_parse_xlsx_rows($fetch['body']);
      $usedPath = '';
    } catch (Throwable $e) {
      return ['ok' => false, 'error' => $e->getMessage(), 'phase' => 'parse'];
    }
  } else {
    return ['ok' => false, 'error' => 'Unsupported payload format', 'phase' => 'parse'];
  }

  $mapped = ll_erp_sync_map_to_leads($rows, (array) ($cfg['field_map'] ?? ll_erp_sync_default_field_map()));
  if (!empty($mapped['missing_required'])) {
    return [
      'ok' => false,
      'error' => 'Missing required field mapping: ' . implode(', ', $mapped['missing_required']),
      'phase' => 'parse',
      'mapped_columns' => $mapped['mapped_columns'],
    ];
  }
  if (!$mapped['leads']) {
    return ['ok' => false, 'error' => 'No leads mapped from ERP payload', 'phase' => 'parse'];
  }

  $stored = ll_erp_sync_store_mapped_leads($mapped, $file, $fetch['content_type']);
  $status = [
    'ok' => true,
    'phase' => 'ready-for-audit',
    'http_status' => $fetch['status'],
    'bytes' => $fetch['bytes'],
    'content_type' => $fetch['content_type'],
    'payload_file' => $file,
    'leads_file' => $stored['file'],
    'row_count' => $mapped['row_count'],
    'lead_count' => $mapped['lead_count'],
    'rows_path' => $usedPath ?? '',
    'format' => $format,
    'at' => gmdate('c'),
  ];
  ll_erp_sync_set_last_status($status);

  return [
    'ok' => true,
    'phase' => 'ready-for-audit',
    'message' => 'Fetched ' . $mapped['lead_count'] . ' leads — open Audit to run AI',
    'http_status' => $fetch['status'],
    'bytes' => $fetch['bytes'],
    'content_type' => $fetch['content_type'],
    'payload_file' => $file,
    'leads_file' => $stored['file'],
    'leads_bytes' => $stored['bytes'],
    'row_count' => $mapped['row_count'],
    'lead_count' => $mapped['lead_count'],
    'mapped_columns' => $mapped['mapped_columns'],
    'rows_path' => $usedPath ?? '',
    'format' => $format,
    'source_file' => 'ERP:' . $file,
  ];
}

/**
 * @return array{keys: list<string>, row_count: int, sample_row: ?array, rows_path: string, format: string, error?: string}
 */
function ll_erp_sync_preview_payload(string $body, string $contentType, string $rowsPath = ''): array
{
  $format = ll_erp_sync_detect_format($body, $contentType);
  if ($format === 'json') {
    $decoded = json_decode($body, true);
    if (!is_array($decoded)) {
      return ['keys' => [], 'row_count' => 0, 'sample_row' => null, 'rows_path' => $rowsPath, 'format' => 'json', 'error' => 'Invalid JSON'];
    }
    [$rows, $usedPath] = ll_erp_sync_extract_rows($decoded, $rowsPath);
    $sample = null;
    $keys = [];
    if ($rows) {
      $first = $rows[0];
      if (is_array($first)) {
        $sample = ll_erp_sync_truncate_row($first);
        $keys = array_map('strval', array_keys($first));
      }
    }
    return [
      'keys' => $keys,
      'row_count' => count($rows),
      'sample_row' => $sample,
      'rows_path' => $usedPath,
      'format' => 'json',
    ];
  }
  if ($format === 'xlsx') {
    try {
      $rows = ll_erp_sync_parse_xlsx_rows($body);
    } catch (Throwable $e) {
      return ['keys' => [], 'row_count' => 0, 'sample_row' => null, 'rows_path' => '', 'format' => 'xlsx', 'error' => $e->getMessage()];
    }
    $sample = $rows[0] ?? null;
    $keys = $sample ? array_map('strval', array_keys($sample)) : [];
    return [
      'keys' => $keys,
      'row_count' => count($rows),
      'sample_row' => $sample ? ll_erp_sync_truncate_row($sample) : null,
      'rows_path' => '',
      'format' => 'xlsx',
    ];
  }
  return ['keys' => [], 'row_count' => 0, 'sample_row' => null, 'rows_path' => '', 'format' => $format, 'error' => 'Unsupported payload format'];
}

function ll_erp_sync_detect_format(string $body, string $contentType): string
{
  $ct = strtolower($contentType);
  if (str_contains($ct, 'json') || str_starts_with(ltrim($body), '{') || str_starts_with(ltrim($body), '[')) {
    return 'json';
  }
  if (
    str_contains($ct, 'spreadsheet')
    || str_contains($ct, 'excel')
    || str_starts_with($body, 'PK')
  ) {
    return 'xlsx';
  }
  return 'unknown';
}

/** @param array<string, mixed> $row */
function ll_erp_sync_truncate_row(array $row): array
{
  $out = [];
  $i = 0;
  foreach ($row as $k => $v) {
    if ($i++ >= 40) {
      break;
    }
    if (is_scalar($v) || $v === null) {
      $s = (string) $v;
      $out[$k] = strlen($s) > 120 ? substr($s, 0, 117) . '…' : $s;
    } else {
      $out[$k] = '[complex]';
    }
  }
  return $out;
}

/**
 * @return array{0: list<array>, 1: string}
 */
function ll_erp_sync_extract_rows(array $decoded, string $rowsPath = ''): array
{
  if ($rowsPath !== '') {
    $node = ll_erp_sync_path_get($decoded, $rowsPath);
    if (is_array($node) && ll_erp_sync_is_list($node)) {
      return [array_values(array_filter($node, 'is_array')), $rowsPath];
    }
  }
  if (ll_erp_sync_is_list($decoded) && isset($decoded[0]) && is_array($decoded[0])) {
    return [array_values($decoded), ''];
  }
  $candidates = ['data', 'rows', 'records', 'result', 'results', 'reportData', 'ReportData', 'jsondata', 'JSONData', 'list'];
  foreach ($candidates as $key) {
    if (!isset($decoded[$key])) {
      continue;
    }
    $node = $decoded[$key];
    if (is_array($node) && ll_erp_sync_is_list($node) && isset($node[0]) && is_array($node[0])) {
      return [array_values($node), $key];
    }
    if (is_array($node) && !ll_erp_sync_is_list($node)) {
      foreach (['data', 'rows', 'records', 'list'] as $inner) {
        if (isset($node[$inner]) && is_array($node[$inner]) && ll_erp_sync_is_list($node[$inner])) {
          return [array_values(array_filter($node[$inner], 'is_array')), $key . '.' . $inner];
        }
      }
    }
  }
  // Deep search first list-of-objects.
  $found = ll_erp_sync_find_row_list($decoded, '');
  if ($found !== null) {
    return $found;
  }
  return [[], $rowsPath];
}

function ll_erp_sync_path_get(array $data, string $path): mixed
{
  $parts = array_values(array_filter(explode('.', $path), static fn ($p) => $p !== ''));
  $node = $data;
  foreach ($parts as $part) {
    if (!is_array($node) || !array_key_exists($part, $node)) {
      return null;
    }
    $node = $node[$part];
  }
  return $node;
}

function ll_erp_sync_is_list(array $arr): bool
{
  if ($arr === []) {
    return true;
  }
  return array_keys($arr) === range(0, count($arr) - 1);
}

/** @return ?array{0: list<array>, 1: string} */
function ll_erp_sync_find_row_list(array $node, string $prefix, int $depth = 0): ?array
{
  if ($depth > 5) {
    return null;
  }
  if (ll_erp_sync_is_list($node) && isset($node[0]) && is_array($node[0])) {
    $keys = array_keys($node[0]);
    $scalarish = count(array_filter($keys, static fn ($k) => is_string($k))) >= 2;
    if ($scalarish) {
      return [array_values(array_filter($node, 'is_array')), $prefix];
    }
  }
  foreach ($node as $k => $v) {
    if (!is_array($v)) {
      continue;
    }
    $path = $prefix === '' ? (string) $k : $prefix . '.' . $k;
    $hit = ll_erp_sync_find_row_list($v, $path, $depth + 1);
    if ($hit !== null) {
      return $hit;
    }
  }
  return null;
}

/**
 * Minimal XLSX → associative rows (first sheet). Requires ZipArchive + SimpleXML.
 * @return list<array<string, string>>
 */
function ll_erp_sync_parse_xlsx_rows(string $binary): array
{
  if (!class_exists('ZipArchive')) {
    throw new RuntimeException('ZipArchive required to parse Excel');
  }
  $tmp = tempnam(sys_get_temp_dir(), 'llxlsx');
  if ($tmp === false) {
    throw new RuntimeException('Could not create temp file');
  }
  file_put_contents($tmp, $binary);
  $zip = new ZipArchive();
  if ($zip->open($tmp) !== true) {
    @unlink($tmp);
    throw new RuntimeException('Invalid XLSX archive');
  }
  $shared = [];
  $ss = $zip->getFromName('xl/sharedStrings.xml');
  if ($ss !== false) {
    $xml = @simplexml_load_string($ss);
    if ($xml) {
      foreach ($xml->si as $si) {
        if (isset($si->t)) {
          $shared[] = (string) $si->t;
        } else {
          $parts = [];
          foreach ($si->r as $r) {
            $parts[] = (string) $r->t;
          }
          $shared[] = implode('', $parts);
        }
      }
    }
  }
  $sheetXml = $zip->getFromName('xl/worksheets/sheet1.xml');
  $zip->close();
  @unlink($tmp);
  if ($sheetXml === false) {
    throw new RuntimeException('sheet1.xml missing');
  }
  $sheet = @simplexml_load_string($sheetXml);
  if (!$sheet) {
    throw new RuntimeException('Could not parse sheet XML');
  }
  $grid = [];
  foreach ($sheet->sheetData->row as $row) {
    $rIdx = (int) $row['r'];
    foreach ($row->c as $c) {
      $ref = (string) $c['r'];
      if (!preg_match('/^([A-Z]+)(\d+)$/', $ref, $m)) {
        continue;
      }
      $col = ll_erp_sync_col_index($m[1]);
      $type = (string) ($c['t'] ?? '');
      $val = isset($c->v) ? (string) $c->v : '';
      if ($type === 's' && $val !== '' && isset($shared[(int) $val])) {
        $val = $shared[(int) $val];
      }
      $grid[$rIdx][$col] = $val;
    }
  }
  if (!$grid) {
    return [];
  }
  ksort($grid);
  $headerRow = reset($grid);
  ksort($headerRow);
  $headers = [];
  foreach ($headerRow as $col => $label) {
    $label = trim((string) $label);
    if ($label !== '') {
      $headers[$col] = $label;
    }
  }
  $out = [];
  $firstKey = array_key_first($grid);
  foreach ($grid as $rIdx => $cols) {
    if ($rIdx === $firstKey) {
      continue;
    }
    $assoc = [];
    $empty = true;
    foreach ($headers as $col => $label) {
      $v = trim((string) ($cols[$col] ?? ''));
      if ($v !== '') {
        $empty = false;
      }
      $assoc[$label] = $v;
    }
    if (!$empty) {
      $out[] = $assoc;
    }
  }
  return $out;
}

function ll_erp_sync_col_index(string $letters): int
{
  $n = 0;
  $len = strlen($letters);
  for ($i = 0; $i < $len; $i++) {
    $n = $n * 26 + (ord($letters[$i]) - 64);
  }
  return $n;
}

function ll_erp_sync_norm_key(string $s): string
{
  $s = strtolower(trim($s));
  $s = preg_replace('/[^a-z0-9]+/', '', $s) ?? $s;
  return $s;
}

/**
 * Map raw ERP rows → audit lead objects (simplified parseWorkbook grouping).
 *
 * @param list<array<string, mixed>> $rows
 * @param array<string, list<string>> $fieldMap
 * @return array{leads: list<array>, row_count: int, lead_count: int, mapped_columns: array<string,string>, missing_required: list<string>}
 */
function ll_erp_sync_map_to_leads(array $rows, array $fieldMap): array
{
  if (!$rows) {
    return ['leads' => [], 'row_count' => 0, 'lead_count' => 0, 'mapped_columns' => [], 'missing_required' => ['mobile', 'project']];
  }
  $headers = array_map('strval', array_keys($rows[0]));
  $headerNorm = [];
  foreach ($headers as $h) {
    $headerNorm[ll_erp_sync_norm_key($h)] = $h;
  }
  $columns = [];
  foreach ($fieldMap as $fieldId => $aliases) {
    $candidates = is_array($aliases) ? $aliases : [ (string) $aliases ];
    array_unshift($candidates, $fieldId);
    foreach ($candidates as $alias) {
      $n = ll_erp_sync_norm_key((string) $alias);
      if ($n !== '' && isset($headerNorm[$n])) {
        $columns[$fieldId] = $headerNorm[$n];
        break;
      }
    }
  }
  $missing = [];
  if (empty($columns['mobile'])) {
    $missing[] = 'mobile';
  }
  if (empty($columns['project'])) {
    $missing[] = 'project';
  }

  $grouped = [];
  $lastMobile = '';
  $lastProject = '';
  foreach ($rows as $index => $row) {
    if (!is_array($row)) {
      continue;
    }
    $rawMobile = isset($columns['mobile']) ? trim((string) ($row[$columns['mobile']] ?? '')) : '';
    $rawProject = isset($columns['project']) ? trim((string) ($row[$columns['project']] ?? '')) : '';
    $normMobile = $rawMobile !== '' ? (ll_erp_sync_indian_mobile($rawMobile) ?: '') : '';
    if ($rawMobile !== '') {
      if ($normMobile === '') {
        continue;
      }
      $lastMobile = $normMobile;
    }
    if ($rawProject !== '') {
      $lastProject = $rawProject;
    }
    if ($lastMobile === '' || $lastProject === '') {
      continue;
    }
    $values = [];
    foreach ($fieldMap as $fieldId => $_aliases) {
      $header = $columns[$fieldId] ?? null;
      $values[$fieldId] = $header ? trim((string) ($row[$header] ?? '')) : '';
    }
    $values['mobile'] = $lastMobile;
    $values['project'] = $lastProject;
    $key = $lastProject . ' | ' . $lastMobile;
    if (!isset($grouped[$key])) {
      $grouped[$key] = [];
    }
    $grouped[$key][] = ['values' => $values, 'rowIndex' => $index];
  }

  $leads = [];
  foreach ($grouped as $groupId => $records) {
    // Fill-down telecaller/status within group.
    $carry = ['telecaller' => '', 'registration' => '', 'source' => '', 'status' => ''];
    foreach ($records as &$rec) {
      foreach ($carry as $k => $v) {
        $cur = $rec['values'][$k] ?? '';
        if ($cur !== '') {
          $carry[$k] = $cur;
        } elseif ($v !== '') {
          $rec['values'][$k] = $v;
        }
      }
    }
    unset($rec);
    $last = $records[array_key_last($records)];
    $sv = $last['values'];
    $commentsHistory = array_map(static fn ($r) => (string) ($r['values']['comments'] ?? ''), $records);
    $connected = ll_erp_sync_connected_from_parameter((string) ($sv['parameter'] ?? ''));
    foreach ($records as $r) {
      if (ll_erp_sync_connected_from_parameter((string) ($r['values']['parameter'] ?? '')) === 'Yes') {
        $connected = 'Yes';
        break;
      }
    }
    $localErrors = ll_erp_sync_local_errors($sv, $connected);
    $auditContext = [
      's' => $sv['status'] ?? '',
      'c' => $commentsHistory,
      'n' => $sv['next'] ?? '',
      'u' => $sv['update'] ?? '',
      'l' => $sv['location'] ?? '',
      'rq' => $sv['requirement'] ?? '',
      'b' => $sv['budget'] ?? '',
      'k' => $connected,
      'le' => $localErrors,
    ];
    if (trim((string) ($sv['requirement'] ?? '')) === '') {
      unset($auditContext['rq']);
    }
    if (trim((string) ($sv['budget'] ?? '')) === '') {
      unset($auditContext['b']);
    }
    $leads[] = [
      'leadId' => $groupId . '#' . $last['rowIndex'],
      'groupId' => $groupId,
      'staticValues' => [
        'project' => $sv['project'] ?? '',
        'mobile' => $sv['mobile'] ?? '',
        'registration' => $sv['registration'] ?? '',
        'telecaller' => $sv['telecaller'] ?? '',
        'status' => $sv['status'] ?? '',
        'comments' => $sv['comments'] ?? '',
        'next' => $sv['next'] ?? '',
        'overdue' => ll_erp_sync_overdue_display((string) ($sv['status'] ?? ''), (string) ($sv['next'] ?? '')),
        'callDate' => $sv['update'] ?? '',
        'update' => $sv['update'] ?? '',
        'totalFollowups' => count($records),
        'dayCallCount' => 1,
        'dayCallIndex' => 1,
        'connected' => $connected,
        'location' => $sv['location'] ?? '',
        'requirement' => $sv['requirement'] ?? '',
        'parameter' => $sv['parameter'] ?? '',
        'budget' => $sv['budget'] ?? '',
        'source' => $sv['source'] ?? '',
      ],
      'auditContext' => $auditContext,
      'localErrors' => $localErrors,
    ];
  }

  return [
    'leads' => $leads,
    'row_count' => count($rows),
    'lead_count' => count($leads),
    'mapped_columns' => $columns,
    'missing_required' => $missing,
  ];
}

function ll_erp_sync_indian_mobile(string $raw): ?string
{
  $digits = preg_replace('/\D+/', '', $raw) ?? '';
  if (strlen($digits) === 12 && str_starts_with($digits, '91')) {
    $digits = substr($digits, 2);
  } elseif (strlen($digits) === 11 && str_starts_with($digits, '0')) {
    $digits = substr($digits, 1);
  }
  if (strlen($digits) === 10 && preg_match('/^[6-9]/', $digits)) {
    return $digits;
  }
  return null;
}

function ll_erp_sync_connected_from_parameter(string $parameter): string
{
  $settings = ll_erp_sync_audit_settings();
  $yes = array_map('ll_erp_sync_norm_key', array_map('trim', explode(',', (string) ($settings['yesValues'] ?? ''))));
  $no = array_map('ll_erp_sync_norm_key', array_map('trim', explode(',', (string) ($settings['noValues'] ?? ''))));
  $n = ll_erp_sync_norm_key($parameter);
  if ($n === '') {
    return '';
  }
  if (in_array($n, $yes, true)) {
    return 'Yes';
  }
  if (in_array($n, $no, true)) {
    return 'No';
  }
  return '';
}

/** @param array<string, mixed> $sv @return list<string> */
function ll_erp_sync_local_errors(array $sv, string $connected): array
{
  $errors = [];
  $param = trim((string) ($sv['parameter'] ?? ''));
  if ($param === '') {
    $errors[] = 'Analysis Parameter Empty';
  }
  if ($connected === 'Yes') {
    if (trim((string) ($sv['location'] ?? '')) === '') {
      $errors[] = 'Customer Location Empty';
    }
    if (trim((string) ($sv['requirement'] ?? '')) === '') {
      $errors[] = 'Customer Requirement Empty';
    }
    if (trim((string) ($sv['budget'] ?? '')) === '') {
      $errors[] = 'Estimate Budget Empty';
    }
  }
  return $errors;
}

function ll_erp_sync_overdue_display(string $status, string $next): int|string
{
  if (in_array(ll_erp_sync_norm_key($status), ['lost', 'beyondbudget'], true) || str_contains(ll_erp_sync_norm_key($status), 'beyondbudget')) {
    return '-';
  }
  // Best-effort: if next parses as past date, rough day count; else 0.
  $ts = strtotime($next);
  if ($ts === false) {
    // DD/MM/YYYY
    if (preg_match('#^(\d{1,2})/(\d{1,2})/(\d{2,4})#', $next, $m)) {
      $y = (int) $m[3];
      if ($y < 100) {
        $y += 2000;
      }
      $ts = mktime(0, 0, 0, (int) $m[2], (int) $m[1], $y);
    }
  }
  if ($ts === false) {
    return 0;
  }
  $today = strtotime('today');
  $days = (int) floor(($today - $ts) / 86400);
  return max(0, $days);
}

/** @return array<string, mixed> */
function ll_erp_sync_audit_settings(): array
{
  $row = ll_setting_get('audit_settings');
  $settings = [];
  if ($row && $row['setting_value']) {
    $decoded = json_decode((string) $row['setting_value'], true);
    if (is_array($decoded)) {
      $settings = $decoded;
    }
  }
  if (empty($settings['model'])) {
    $settings['model'] = 'gpt-4o-mini';
  }
  if (empty($settings['batchSize'])) {
    $settings['batchSize'] = 10;
  }
  if (empty($settings['yesValues'])) {
    $settings['yesValues'] = 'Site Visited, In Progress, Immediate Possession, Not Interested';
  }
  if (empty($settings['noValues'])) {
    $settings['noValues'] = 'RNR, 1st RNR, 2nd RNR, 3rd RNR, Continues RNR, Call Disconnected, Wrong Number';
  }
  return $settings;
}

/**
 * Call OpenAI chat completions and return decoded content JSON.
 * @param array<string, mixed> $body
 * @return array<string, mixed>
 */
function ll_erp_sync_openai_chat(array $body): array
{
  $key = ll_openai_key_plaintext();
  if ($key === null || $key === '') {
    throw new RuntimeException('Server OpenAI API key is not configured');
  }
  if (!function_exists('curl_init')) {
    throw new RuntimeException('cURL required for OpenAI');
  }
  $payload = json_encode($body, JSON_UNESCAPED_UNICODE);
  if ($payload === false) {
    throw new RuntimeException('Could not encode OpenAI body');
  }
  $ch = curl_init('https://api.openai.com/v1/chat/completions');
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_TIMEOUT => 180,
    CURLOPT_HTTPHEADER => [
      'Authorization: Bearer ' . $key,
      'Content-Type: application/json',
      'Accept: application/json',
    ],
    CURLOPT_POSTFIELDS => $payload,
  ]);
  $response = curl_exec($ch);
  $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
  $err = curl_error($ch);
  curl_close($ch);
  if ($response === false) {
    throw new RuntimeException('OpenAI request failed: ' . ($err ?: 'unknown'));
  }
  $decoded = json_decode($response, true);
  if (!is_array($decoded)) {
    throw new RuntimeException('OpenAI returned invalid JSON');
  }
  if ($status < 200 || $status >= 300) {
    $msg = $decoded['error']['message'] ?? ('HTTP ' . $status);
    throw new RuntimeException('OpenAI ' . $status . ': ' . $msg);
  }
  return $decoded;
}

function ll_erp_sync_build_system_prompt(array $settings): string
{
  $rules = '';
  if (!empty($settings['rules']) && is_array($settings['rules'])) {
    $i = 1;
    foreach ($settings['rules'] as $rule) {
      if (!is_array($rule)) {
        continue;
      }
      $instruction = trim((string) ($rule['instruction'] ?? ''));
      if ($instruction === '') {
        continue;
      }
      $field = trim((string) ($rule['field'] ?? 'check'));
      $rules .= $i . '. ' . $field . ': ' . $instruction . "\n";
      $i++;
    }
  }
  $extra = trim((string) ($settings['additionalInstructions'] ?? ''));
  return "LeadLens ERP server auditor. Evidence only. Never invent facts.\n"
    . "OUTPUT: JSON object with a[] items {id,q,e,i,o,r}. Echo each compact id exactly (b0, b1, …).\n"
    . "q=comment quality 0-10; e=error labels from allowed set only; i=0|1 buying intent; o=18-28 words; r=20-40 words.\n"
    . "Allowed e labels: Lead Status Not Aligned With Comments | Customer Requirement Empty | Incorrect Customer Requirement | Customer Comment Quality Not Appropriate.\n"
    . "Never emit Follow-up Missed, Budget/Location/Parameter Empty, or TAT labels (those are in le).\n"
    . "Never recommend Status→Lost (Cold is the floor).\n\n"
    . "RUN CHECKS:\n" . ($rules !== '' ? $rules : "none\n")
    . ($extra !== '' ? "\nEXTRA:\n" . $extra : '');
}

/** Normalize a model-returned lead id for matching. */
function ll_erp_sync_clean_lead_id(string $value): string
{
  $norm = strtolower(trim($value));
  $norm = preg_replace('/[_-]+/', ' ', $norm) ?? $norm;
  $norm = preg_replace('/\s+/', ' ', $norm) ?? $norm;
  if (in_array($norm, ['', 'nan', 'none', 'nat', 'undefined', 'null'], true)) {
    return '';
  }
  return trim($value);
}

/**
 * Map a model-returned id (compact, shortened, or original) back to a sent id.
 * @param list<string> $sentIds
 */
function ll_erp_sync_resolve_audit_result_id(string $returnedId, array $sentIds): ?string
{
  $ret = ll_erp_sync_clean_lead_id($returnedId);
  if ($ret === '') {
    return null;
  }
  foreach ($sentIds as $id) {
    if (ll_erp_sync_clean_lead_id((string) $id) === $ret) {
      return (string) $id;
    }
  }
  $tail = [];
  foreach ($sentIds as $id) {
    $parts = explode('|', ll_erp_sync_clean_lead_id((string) $id));
    $last = trim((string) end($parts));
    if ($last === $ret) {
      $tail[] = (string) $id;
    }
  }
  if (count($tail) === 1) {
    return $tail[0];
  }
  $suffix = [];
  foreach ($sentIds as $id) {
    $clean = ll_erp_sync_clean_lead_id((string) $id);
    if ($clean !== '' && str_ends_with($clean, $ret)) {
      $suffix[] = (string) $id;
    }
  }
  return count($suffix) === 1 ? $suffix[0] : null;
}

/** @return array<string, true> */
function ll_erp_sync_ai_allowed_errors(): array
{
  return [
    'Lead Status Not Aligned With Comments' => true,
    'Customer Requirement Empty' => true,
    'Incorrect Customer Requirement' => true,
    'Customer Comment Quality Not Appropriate' => true,
  ];
}

/** @return array<string, true> */
function ll_erp_sync_high_severity_errors(): array
{
  return [
    'Follow-up Missed' => true,
    'Customer Requirement Empty' => true,
    'Customer Comment Quality Not Appropriate' => true,
  ];
}

/**
 * @param array<string, mixed> $lead
 * @param ?array<string, mixed> $ai
 * @return array<string, mixed>
 */
function ll_erp_sync_apply_ai_to_lead(array $lead, ?array $ai, bool $fallback = false): array
{
  $sv = is_array($lead['staticValues'] ?? null) ? $lead['staticValues'] : [];
  $local = is_array($lead['localErrors'] ?? null) ? $lead['localErrors'] : [];
  $allowed = ll_erp_sync_ai_allowed_errors();
  $high = ll_erp_sync_high_severity_errors();
  $aiErrors = [];
  if (is_array($ai) && isset($ai['e']) && is_array($ai['e'])) {
    foreach ($ai['e'] as $label) {
      $label = trim((string) $label);
      if (isset($allowed[$label])) {
        $aiErrors[] = $label;
      }
    }
  }
  $errors = array_values(array_unique(array_merge($local, $aiErrors)));
  $q = is_array($ai) ? (int) ($ai['q'] ?? 5) : 5;
  $q = max(0, min(10, $q));
  $intent = (is_array($ai) && (int) ($ai['i'] ?? 0) === 1) ? 'Yes' : 'No';
  $severity = !$errors ? 'NONE' : (array_filter($errors, static fn ($e) => isset($high[$e])) ? 'HIGH' : 'MEDIUM');
  $observation = is_array($ai) ? trim((string) ($ai['o'] ?? '')) : '';
  $recommendation = is_array($ai) ? trim((string) ($ai['r'] ?? '')) : '';
  if ($fallback) {
    $observation = $observation !== '' ? $observation : 'Server audit fallback — model omitted this lead; local checks only.';
    $recommendation = $recommendation !== '' ? $recommendation : 'Review comments and status in CRM, then update if needed.';
  }
  return array_merge($sv, [
    'commentQuality' => $q,
    'errorTypes' => $errors ? implode(', ', $errors) : 'None',
    'errorSeverity' => $severity,
    'buyingIntent' => $intent,
    'observation' => $observation,
    'recommendation' => $recommendation,
  ]);
}

/**
 * Ask OpenAI for one batch. Returns map of real leadId → AI item.
 * Compact ids (b0, b1, …) avoid pipes/hashes in project|mobile#row ids.
 *
 * @param list<array> $leads
 * @return array<string, array>
 */
function ll_erp_sync_audit_batch_request(array $leads, array $settings): array
{
  $compactToReal = [];
  $modelInput = [];
  foreach ($leads as $i => $lead) {
    $real = trim((string) ($lead['leadId'] ?? ''));
    $compact = 'b' . $i;
    $compactToReal[$compact] = $real;
    $ctx = $lead['auditContext'] ?? [];
    $modelInput[] = array_merge(['id' => $compact], is_array($ctx) ? $ctx : []);
  }
  $model = (string) ($settings['model'] ?? 'gpt-4o-mini');
  $maxTokens = max(500, count($leads) * 160);
  $schema = [
    'type' => 'object',
    'additionalProperties' => false,
    'required' => ['a'],
    'properties' => [
      'a' => [
        'type' => 'array',
        'items' => [
          'type' => 'object',
          'additionalProperties' => false,
          'required' => ['id', 'q', 'e', 'i', 'o', 'r'],
          'properties' => [
            'id' => ['type' => 'string'],
            'q' => ['type' => 'integer', 'minimum' => 0, 'maximum' => 10],
            'e' => ['type' => 'array', 'items' => ['type' => 'string']],
            'i' => ['type' => 'integer', 'enum' => [0, 1]],
            'o' => ['type' => 'string'],
            'r' => ['type' => 'string'],
          ],
        ],
      ],
    ],
  ];
  $body = [
    'model' => $model,
    'temperature' => 0,
    'max_tokens' => $maxTokens,
    'messages' => [
      ['role' => 'system', 'content' => ll_erp_sync_build_system_prompt($settings)],
      [
        'role' => 'user',
        'content' => 'Audit ' . count($leads) . " call(s). Echo each compact id exactly (b0, b1, …). Judge status vs comments; comment quality; buying intent. le=local errors — explain in o/r, never copy into e.\n"
          . json_encode(['L' => $modelInput], JSON_UNESCAPED_UNICODE),
      ],
    ],
    'response_format' => [
      'type' => 'json_schema',
      'json_schema' => [
        'name' => 'll_audit',
        'strict' => true,
        'schema' => $schema,
      ],
    ],
  ];
  if (preg_match('/(^|[^a-z])(gpt-5|o1|o3|o4)([.-]|$)/i', $model) && !str_contains(strtolower($model), 'gpt-5-chat')) {
    unset($body['max_tokens'], $body['temperature']);
    $body['max_completion_tokens'] = $maxTokens;
  }

  $aiList = null;
  $lastError = null;
  for ($attempt = 1; $attempt <= 3; $attempt++) {
    try {
      $data = ll_erp_sync_openai_chat($body);
      $content = $data['choices'][0]['message']['content'] ?? null;
      if (!$content) {
        throw new RuntimeException('OpenAI returned no content');
      }
      $parsed = json_decode((string) $content, true);
      if (!is_array($parsed) || !isset($parsed['a']) || !is_array($parsed['a'])) {
        throw new RuntimeException('OpenAI response missing a[]');
      }
      $aiList = $parsed['a'];
      break;
    } catch (Throwable $e) {
      $lastError = $e;
      $msg = $e->getMessage();
      if (str_contains($msg, '429')) {
        sleep(30);
        continue;
      }
      if ($attempt < 3) {
        usleep($attempt * 1_500_000);
      }
    }
  }
  if ($aiList === null) {
    throw $lastError ?? new RuntimeException('Audit batch failed');
  }

  $claimed = [];
  $byReal = [];
  foreach ($aiList as $item) {
    if (!is_array($item)) {
      continue;
    }
    $pool = [];
    foreach ($compactToReal as $compact => $real) {
      if (isset($claimed[$real])) {
        continue;
      }
      $pool[] = $compact;
      if ($real !== '') {
        $pool[] = $real;
      }
    }
    $resolved = ll_erp_sync_resolve_audit_result_id((string) ($item['id'] ?? ''), $pool);
    if ($resolved === null) {
      continue;
    }
    $real = $compactToReal[$resolved] ?? $resolved;
    if ($real === '' || isset($claimed[$real])) {
      continue;
    }
    $claimed[$real] = true;
    $byReal[$real] = $item;
  }
  return $byReal;
}

/**
 * @param list<array> $leads
 * @return list<array>
 */
function ll_erp_sync_audit_batch(array $leads, array $settings): array
{
  if (!$leads) {
    return [];
  }
  $byId = ll_erp_sync_audit_batch_request($leads, $settings);
  $missing = [];
  foreach ($leads as $lead) {
    $id = trim((string) ($lead['leadId'] ?? ''));
    if ($id === '' || !isset($byId[$id])) {
      $missing[] = $lead;
    }
  }
  if ($missing) {
    $recovered = ll_erp_sync_audit_batch_request($missing, $settings);
    foreach ($recovered as $id => $item) {
      $byId[$id] = $item;
    }
  }
  $results = [];
  foreach ($leads as $lead) {
    $id = trim((string) ($lead['leadId'] ?? ''));
    $ai = $byId[$id] ?? null;
    $results[] = ll_erp_sync_apply_ai_to_lead($lead, is_array($ai) ? $ai : null, $ai === null);
  }
  return $results;
}

/**
 * Group audited results into dashboard publish payloads (same shape as confirmUploadDashboard).
 * @param list<array> $results
 * @return list<array{telecaller_name:string,title:string,results:list,source_file:string,lead_count:int}>
 */
function ll_erp_sync_build_dashboards(array $results, string $sourceFile): array
{
  $byName = [];
  foreach ($results as $row) {
    if (!is_array($row)) {
      continue;
    }
    $name = trim((string) ($row['telecaller'] ?? $row['telecallerName'] ?? ''));
    if ($name === '') {
      $name = 'Unassigned';
    }
    if (!isset($byName[$name])) {
      $byName[$name] = [];
    }
    $byName[$name][] = $row;
  }
  $dashboards = [];
  foreach ($byName as $name => $rows) {
    $dashboards[] = [
      'telecaller_name' => $name,
      'title' => $name . ' · ' . ($sourceFile !== '' ? $sourceFile : 'ERP sync'),
      'results' => $rows,
      'source_file' => $sourceFile,
      'lead_count' => count($rows),
      'meta' => ['source' => 'erp_sync'],
    ];
  }
  return $dashboards;
}

/** @return ?array<string, mixed> */
function ll_erp_sync_load_job(): ?array
{
  $row = ll_setting_get(LL_ERP_SYNC_JOB_KEY);
  if (!$row || !$row['setting_value']) {
    return null;
  }
  $decoded = json_decode((string) $row['setting_value'], true);
  return is_array($decoded) ? $decoded : null;
}

/** @param ?array<string, mixed> $job */
function ll_erp_sync_save_job(?array $job): void
{
  if ($job === null) {
    ll_setting_delete(LL_ERP_SYNC_JOB_KEY);
    return;
  }
  $json = json_encode($job, JSON_UNESCAPED_UNICODE);
  if ($json === false) {
    throw new RuntimeException('Could not encode job');
  }
  ll_setting_set(LL_ERP_SYNC_JOB_KEY, $json, null);
}

/**
 * Wall-clock deadline for this PHP request (max_execution_time − safety buffer).
 */
function ll_erp_sync_request_deadline(int $startedAt): int
{
  $maxExec = (int) ini_get('max_execution_time');
  if ($maxExec <= 0) {
    $maxExec = 240;
  }
  // Honor set_time_limit(240) used by run — use the larger of ini / 240 when unlimited is false.
  $budget = max(30, min($maxExec, 240));
  return $startedAt + $budget - LL_ERP_SYNC_CHAIN_SAFETY_BUFFER;
}

/**
 * @param array<string, mixed> $job
 * @return array{ok:bool,job:array<string,mixed>,busy?:bool,message?:string}
 */
function ll_erp_sync_acquire_run_lock(array $job, string $ownerToken): array
{
  $running = !empty($job['running']);
  $since = (int) ($job['running_since'] ?? 0);
  $existing = (string) ($job['running_token'] ?? '');
  if ($running && $since > 0 && (time() - $since) < LL_ERP_SYNC_RUNNING_STALE_SEC) {
    if ($existing !== '' && hash_equals($existing, $ownerToken)) {
      return ['ok' => true, 'job' => $job];
    }
    return [
      'ok' => false,
      'busy' => true,
      'job' => $job,
      'message' => 'Audit already in progress',
    ];
  }
  $job['running'] = true;
  $job['running_since'] = time();
  $job['running_token'] = $ownerToken;
  // Consume chain token once a worker starts (prevents replay stampede).
  unset($job['chain_token'], $job['chain_token_at']);
  ll_erp_sync_save_job($job);
  return ['ok' => true, 'job' => $job];
}

/** @param array<string, mixed> $job */
function ll_erp_sync_release_run_lock(array $job, string $ownerToken): array
{
  $existing = (string) ($job['running_token'] ?? '');
  if ($existing !== '' && !hash_equals($existing, $ownerToken)) {
    return $job;
  }
  unset($job['running'], $job['running_since'], $job['running_token']);
  ll_erp_sync_save_job($job);
  return $job;
}

/** Build same-host ERP sync URL (/api or /dev/api). */
function ll_erp_sync_self_url(string $action): string
{
  $action = trim($action, '/');
  $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
    || ((int) ($_SERVER['SERVER_PORT'] ?? 0) === 443)
    || (strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https');
  $scheme = $https ? 'https' : 'http';
  $host = (string) ($_SERVER['HTTP_HOST'] ?? 'localhost');
  $prefix = ll_is_dev_request() ? '/dev/api' : '/api';
  return $scheme . '://' . $host . $prefix . '/erp-sync/' . $action;
}

function ll_erp_sync_continue_self_url(): string
{
  return ll_erp_sync_self_url('continue');
}

/**
 * @param array<string, string> $headers
 */
function ll_erp_sync_fire_and_forget_post(string $url, array $headers, string $body = '{}'): bool
{
  $parts = parse_url($url);
  if (!is_array($parts) || empty($parts['host'])) {
    return false;
  }
  $host = (string) $parts['host'];
  $port = (int) ($parts['port'] ?? ((string) ($parts['scheme'] ?? 'https') === 'https' ? 443 : 80));
  $path = (string) ($parts['path'] ?? '/');
  if (!empty($parts['query'])) {
    $path .= '?' . $parts['query'];
  }
  $ssl = ((string) ($parts['scheme'] ?? '')) === 'https';
  $req = "POST {$path} HTTP/1.1\r\n";
  $req .= "Host: {$host}\r\n";
  $req .= "Content-Type: application/json\r\n";
  foreach ($headers as $name => $value) {
    $req .= $name . ': ' . $value . "\r\n";
  }
  $req .= 'Content-Length: ' . strlen($body) . "\r\n";
  $req .= "Connection: Close\r\n\r\n";
  $req .= $body;

  $errno = 0;
  $errstr = '';
  $remote = ($ssl ? 'ssl://' : 'tcp://') . $host . ':' . $port;
  $ctx = stream_context_create($ssl ? [
    'ssl' => [
      'verify_peer' => true,
      'verify_peer_name' => true,
      'SNI_enabled' => true,
      'peer_name' => $host,
    ],
  ] : []);
  $fp = @stream_socket_client($remote, $errno, $errstr, 1.5, STREAM_CLIENT_CONNECT, $ctx);
  if (is_resource($fp)) {
    stream_set_timeout($fp, 1);
    @fwrite($fp, $req);
    @fclose($fp);
    return true;
  }

  if (!function_exists('curl_init')) {
    return false;
  }
  $ch = curl_init($url);
  if ($ch === false) {
    return false;
  }
  $curlHeaders = ['Content-Type: application/json'];
  foreach ($headers as $name => $value) {
    $curlHeaders[] = $name . ': ' . $value;
  }
  curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => $body,
    CURLOPT_HTTPHEADER => $curlHeaders,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 1,
    CURLOPT_CONNECTTIMEOUT => 1,
    CURLOPT_NOSIGNAL => 1,
  ]);
  @curl_exec($ch);
  curl_close($ch);
  return true;
}

/**
 * Fire-and-forget POST continue with one-time chain token.
 * Does not wait for audit work; cron remains a safety net if this fails.
 */
function ll_erp_sync_fire_self_chain_continue(): bool
{
  $job = ll_erp_sync_load_job();
  if (!is_array($job) || ($job['status'] ?? '') !== 'auditing') {
    return false;
  }
  try {
    $token = bin2hex(random_bytes(16));
  } catch (Throwable $e) {
    $token = sha1(uniqid('erp-chain', true));
  }
  $job['chain_token'] = $token;
  $job['chain_token_at'] = time();
  unset($job['running'], $job['running_since'], $job['running_token']);
  ll_erp_sync_save_job($job);
  return ll_erp_sync_fire_and_forget_post(
    ll_erp_sync_continue_self_url(),
    ['X-ERP-Sync-Chain' => $token],
    '{}'
  );
}

/**
 * Keep-alive (every minute) starts the 6:00 AM IST daily pipeline.
 * @return array{queued:bool}|null
 */
function ll_erp_sync_maybe_queue_daily_from_keepalive(string $source): ?array
{
  if ($source !== 'cron') {
    return null;
  }
  $cfg = ll_erp_sync_load_config();
  if (!ll_erp_sync_cron_should_start_daily($cfg)) {
    return null;
  }
  $pendingAt = (int) ($cfg['daily_chain_token_at'] ?? 0);
  if ($pendingAt > 0 && (time() - $pendingAt) < 90) {
    return ['queued' => false];
  }
  try {
    $token = bin2hex(random_bytes(16));
  } catch (Throwable $e) {
    $token = sha1(uniqid('erp-daily', true));
  }
  ll_erp_sync_persist_config_fields([
    'daily_chain_token' => $token,
    'daily_chain_token_at' => time(),
  ]);
  $ok = ll_erp_sync_fire_and_forget_post(
    ll_erp_sync_self_url('daily'),
    ['X-ERP-Sync-Chain' => $token],
    '{}'
  );
  return ['queued' => $ok];
}

/**
 * Full or resumable pipeline: fetch → parse → audit → optional publish.
 *
 * @param array{auto_publish_key?:string,record_daily?:bool,continue_only?:bool,skip_enabled_check?:bool,self_chain?:bool} $opts
 * @return array<string, mixed>
 */
function ll_erp_sync_run(array $actor, bool $forceFetch = false, bool $dryRun = false, array $opts = []): array
{
  @set_time_limit(240);
  @ignore_user_abort(true);
  $cfg = ll_erp_sync_load_config();
  $autoPublishKey = (string) ($opts['auto_publish_key'] ?? 'auto_publish');
  if ($autoPublishKey !== 'cron_auto_publish') {
    $autoPublishKey = 'auto_publish';
  }
  $recordDaily = !empty($opts['record_daily']);
  $continueOnly = !empty($opts['continue_only']);
  $selfChain = !empty($opts['self_chain']);
  $runStartedAt = time();
  $deadline = ll_erp_sync_request_deadline($runStartedAt);
  try {
    $ownerToken = bin2hex(random_bytes(8));
  } catch (Throwable $e) {
    $ownerToken = sha1(uniqid('erp-run', true));
  }

  if (
    empty($opts['skip_enabled_check'])
    && empty($forceFetch)
    && $actor['username'] === 'erp-sync-cron'
    && !ll_erp_sync_daily_is_enabled($cfg)
  ) {
    return ['ok' => false, 'error' => 'ERP sync is disabled', 'status' => 'disabled'];
  }

  $job = ll_erp_sync_load_job();
  $resume = is_array($job) && ($job['status'] ?? '') === 'auditing' && !empty($job['leads']);

  if ($continueOnly) {
    if (!$resume) {
      return [
        'ok' => true,
        'idle' => true,
        'status' => 'idle',
        'needs_continue' => false,
        'message' => 'No in-progress audit job',
      ];
    }
    $forceFetch = false;
  }

  if (!$resume || $forceFetch) {
    if ($continueOnly) {
      return [
        'ok' => true,
        'idle' => true,
        'status' => 'idle',
        'needs_continue' => false,
        'message' => 'No in-progress audit job',
      ];
    }
    $url = trim((string) ($cfg['report_url'] ?? ''));
    $cookie = ll_erp_sync_cookie_plaintext();
    if ($url === '') {
      $fail = ['ok' => false, 'phase' => 'fetch', 'error' => 'Report URL not configured', 'at' => gmdate('c')];
      ll_erp_sync_set_last_status($fail);
      if ($recordDaily) {
        ll_erp_sync_set_last_daily_status(array_merge($fail, ['source' => 'daily']));
      }
      return ['ok' => false, 'error' => 'Report URL not configured', 'phase' => 'fetch'];
    }
    if ($cookie === null) {
      $fail = ['ok' => false, 'phase' => 'fetch', 'error' => 'Cookie not configured', 'session_expired' => true, 'at' => gmdate('c')];
      ll_erp_sync_set_last_status($fail);
      if ($recordDaily) {
        ll_erp_sync_set_last_daily_status(array_merge($fail, ['source' => 'daily']));
      }
      return ['ok' => false, 'error' => 'Cookie not configured — paste Cookie header in ERP Sync', 'phase' => 'fetch', 'session_expired' => true];
    }
    $extra = $cfg['extra_headers'] ?? [];
    if ($extra instanceof stdClass) {
      $extra = (array) $extra;
    }
    $fetch = ll_erp_sync_http_fetch($url, (string) ($cfg['http_method'] ?? 'GET'), $cookie, (array) $extra);
    if (!empty($fetch['session_expired'])) {
      $fail = [
        'ok' => false,
        'phase' => 'fetch',
        'error' => $fetch['error'] ?? 'session_expired',
        'session_expired' => true,
        'http_status' => $fetch['status'],
        'at' => gmdate('c'),
      ];
      ll_erp_sync_set_last_status($fail);
      if ($recordDaily) {
        ll_erp_sync_set_last_daily_status(array_merge($fail, ['source' => 'daily']));
      }
      ll_erp_sync_save_job(null);
      return [
        'ok' => false,
        'error' => $fetch['error'] ?? 'ERP session expired',
        'phase' => 'fetch',
        'session_expired' => true,
      ];
    }
    if (empty($fetch['ok'])) {
      $fail = [
        'ok' => false,
        'phase' => 'fetch',
        'error' => $fetch['error'] ?? 'fetch failed',
        'http_status' => $fetch['status'],
        'at' => gmdate('c'),
      ];
      ll_erp_sync_set_last_status($fail);
      if ($recordDaily) {
        ll_erp_sync_set_last_daily_status(array_merge($fail, ['source' => 'daily']));
      }
      return ['ok' => false, 'error' => $fetch['error'] ?? 'fetch failed', 'phase' => 'fetch'];
    }

    $file = ll_erp_sync_store_payload($fetch['body'], $fetch['content_type']);
    $format = ll_erp_sync_detect_format($fetch['body'], $fetch['content_type']);
    if ($format === 'json') {
      $decoded = json_decode($fetch['body'], true);
      if (!is_array($decoded)) {
        $fail = ['ok' => false, 'phase' => 'parse', 'error' => 'Invalid JSON payload', 'at' => gmdate('c')];
        ll_erp_sync_set_last_status($fail);
        if ($recordDaily) {
          ll_erp_sync_set_last_daily_status(array_merge($fail, ['source' => 'daily']));
        }
        return ['ok' => false, 'error' => 'Invalid JSON payload', 'phase' => 'parse'];
      }
      [$rows] = ll_erp_sync_extract_rows($decoded, (string) ($cfg['rows_path'] ?? ''));
    } elseif ($format === 'xlsx') {
      try {
        $rows = ll_erp_sync_parse_xlsx_rows($fetch['body']);
      } catch (Throwable $e) {
        $fail = ['ok' => false, 'phase' => 'parse', 'error' => $e->getMessage(), 'at' => gmdate('c')];
        ll_erp_sync_set_last_status($fail);
        if ($recordDaily) {
          ll_erp_sync_set_last_daily_status(array_merge($fail, ['source' => 'daily']));
        }
        return ['ok' => false, 'error' => $e->getMessage(), 'phase' => 'parse'];
      }
    } else {
      $fail = ['ok' => false, 'phase' => 'parse', 'error' => 'Unsupported payload format', 'at' => gmdate('c')];
      ll_erp_sync_set_last_status($fail);
      if ($recordDaily) {
        ll_erp_sync_set_last_daily_status(array_merge($fail, ['source' => 'daily']));
      }
      return ['ok' => false, 'error' => 'Unsupported payload format', 'phase' => 'parse'];
    }

    $mapped = ll_erp_sync_map_to_leads($rows, (array) ($cfg['field_map'] ?? ll_erp_sync_default_field_map()));
    if (!empty($mapped['missing_required'])) {
      $fail = [
        'ok' => false,
        'phase' => 'parse',
        'error' => 'Missing required field mapping: ' . implode(', ', $mapped['missing_required']),
        'at' => gmdate('c'),
      ];
      ll_erp_sync_set_last_status($fail);
      if ($recordDaily) {
        ll_erp_sync_set_last_daily_status(array_merge($fail, ['source' => 'daily']));
      }
      return [
        'ok' => false,
        'error' => 'Missing required field mapping: ' . implode(', ', $mapped['missing_required']),
        'phase' => 'parse',
        'mapped_columns' => $mapped['mapped_columns'],
      ];
    }
    if (!$mapped['leads']) {
      $fail = ['ok' => false, 'phase' => 'parse', 'error' => 'No leads mapped from ERP payload', 'at' => gmdate('c')];
      ll_erp_sync_set_last_status($fail);
      if ($recordDaily) {
        ll_erp_sync_set_last_daily_status(array_merge($fail, ['source' => 'daily']));
      }
      return ['ok' => false, 'error' => 'No leads mapped from ERP payload', 'phase' => 'parse'];
    }

    // Keep latest-leads.json in sync (manual Audit handoff still works after a daily fetch).
    try {
      ll_erp_sync_store_mapped_leads($mapped, $file, $fetch['content_type']);
    } catch (Throwable $e) {
      // Non-fatal for cron audit; job still holds leads in settings.
    }

    $job = [
      'status' => 'auditing',
      'payload_file' => $file,
      'source_file' => 'ERP:' . $file,
      'leads' => $mapped['leads'],
      'results' => [],
      'cursor' => 0,
      'row_count' => $mapped['row_count'],
      'lead_count' => $mapped['lead_count'],
      'started_at' => gmdate('c'),
      'actor_name' => $actor['display_name'] ?? $actor['username'] ?? 'system',
      'pipeline' => $recordDaily ? 'daily' : 'manual',
    ];
    ll_erp_sync_save_job($job);
    if ($recordDaily) {
      ll_erp_sync_set_last_daily_status([
        'ok' => true,
        'phase' => 'audit',
        'source' => 'daily',
        'partial' => true,
        'needs_continue' => true,
        'lead_count' => $mapped['lead_count'],
        'done' => 0,
        'at' => gmdate('c'),
        'message' => 'Fetched ' . $mapped['lead_count'] . ' leads — auditing…',
      ]);
    }
  }

  $settings = ll_erp_sync_audit_settings();
  $batchSize = max(1, min(20, (int) ($cfg['batch_size'] ?? $settings['batchSize'] ?? 10)));
  $maxPerRun = max($batchSize, (int) ($cfg['max_leads_per_run'] ?? 40));
  $leads = $job['leads'];
  $cursor = (int) ($job['cursor'] ?? 0);
  $results = is_array($job['results'] ?? null) ? $job['results'] : [];

  $lock = ll_erp_sync_acquire_run_lock($job, $ownerToken);
  if (empty($lock['ok'])) {
    return [
      'ok' => true,
      'busy' => true,
      'idle' => true,
      'needs_continue' => true,
      'status' => 'busy',
      'message' => $lock['message'] ?? 'Audit already in progress',
      'done' => count($results),
      'total' => count($leads),
    ];
  }
  $job = $lock['job'];

  $chunksThisRequest = 0;
  $hitTimeLimit = false;

  try {
    while ($cursor < count($leads)) {
      if ($selfChain && time() >= $deadline) {
        $hitTimeLimit = true;
        break;
      }

      $processedThisRun = 0;
      while ($cursor < count($leads) && $processedThisRun < $maxPerRun) {
        if ($selfChain && time() >= $deadline) {
          $hitTimeLimit = true;
          break 2;
        }
        $batch = array_slice($leads, $cursor, $batchSize);
        try {
          $batchResults = ll_erp_sync_audit_batch($batch, $settings);
        } catch (Throwable $e) {
          $job['status'] = 'error';
          $job['error'] = $e->getMessage();
          $job['cursor'] = $cursor;
          $job['results'] = $results;
          $job = ll_erp_sync_release_run_lock($job, $ownerToken);
          ll_erp_sync_save_job($job);
          $fail = [
            'ok' => false,
            'phase' => 'audit',
            'error' => $e->getMessage(),
            'cursor' => $cursor,
            'lead_count' => count($leads),
            'at' => gmdate('c'),
          ];
          ll_erp_sync_set_last_status($fail);
          if ($recordDaily) {
            ll_erp_sync_set_last_daily_status(array_merge($fail, ['source' => 'daily']));
          }
          return [
            'ok' => false,
            'error' => $e->getMessage(),
            'phase' => 'audit',
            'cursor' => $cursor,
            'lead_count' => count($leads),
            'done' => count($results),
          ];
        }
        foreach ($batchResults as $row) {
          $results[] = $row;
        }
        $cursor += count($batch);
        $processedThisRun += count($batch);
        $job['cursor'] = $cursor;
        $job['results'] = $results;
        $job['status'] = $cursor >= count($leads) ? 'audited' : 'auditing';
        ll_erp_sync_save_job($job);
      }

      $chunksThisRequest++;

      if ($cursor >= count($leads)) {
        break;
      }

      // One maxPerRun chunk done; without self-chain, stop (manual advanced /run).
      if (!$selfChain) {
        break;
      }

      // Deadline already includes safety buffer — stop and HTTP-handoff when hit.
      if (time() >= $deadline) {
        $hitTimeLimit = true;
        break;
      }
    }
  } finally {
    $fresh = ll_erp_sync_load_job();
    if (is_array($fresh)) {
      $job = $fresh;
      $job['cursor'] = $cursor;
      $job['results'] = $results;
      $job['status'] = $cursor >= count($leads) ? ($job['status'] ?? 'audited') : 'auditing';
      if ($cursor < count($leads)) {
        $job['status'] = 'auditing';
      }
      $job = ll_erp_sync_release_run_lock($job, $ownerToken);
    }
  }

  if ($cursor < count($leads)) {
    $selfChained = false;
    if ($selfChain) {
      $selfChained = ll_erp_sync_fire_self_chain_continue();
    }
    $resumeHint = $selfChained
      ? 'self-chain queued next batch'
      : ($selfChain
        ? 'self-chain handoff failed — continue cron will resume'
        : 'call continue (or run) again');
    $partial = [
      'ok' => true,
      'phase' => 'audit',
      'partial' => true,
      'needs_continue' => true,
      'complete' => false,
      'cursor' => $cursor,
      'lead_count' => count($leads),
      'done' => count($results),
      'audited' => count($results),
      'total' => count($leads),
      'chunks_this_request' => $chunksThisRequest,
      'self_chained' => $selfChained,
      'time_limit_handoff' => $hitTimeLimit,
      'at' => gmdate('c'),
    ];
    ll_erp_sync_set_last_status($partial);
    if ($recordDaily) {
      ll_erp_sync_set_last_daily_status(array_merge($partial, [
        'source' => 'daily',
        'message' => 'Audited ' . count($results) . ' / ' . count($leads) . ' — ' . $resumeHint,
      ]));
    }
    return array_merge($partial, [
      'message' => 'Audited ' . count($results) . ' / ' . count($leads) . ' leads — ' . $resumeHint,
    ]);
  }

  $sourceFile = (string) ($job['source_file'] ?? 'ERP sync');
  $dashboards = ll_erp_sync_build_dashboards($results, $sourceFile);
  $published = null;
  $autoPublish = ll_erp_sync_resolve_auto_publish($cfg, $autoPublishKey, $dryRun);

  if ($autoPublish && $dashboards) {
    $published = ll_publish_telecaller_dashboards($dashboards, $actor);
    $job['status'] = 'published';
    $job['published_at'] = gmdate('c');
    $job['published_count'] = count($published['published'] ?? []);
  } else {
    $job['status'] = 'ready';
    $job['publish_skipped'] = $dryRun
      ? 'dry_run'
      : (!$autoPublish ? ($autoPublishKey === 'cron_auto_publish' ? 'cron_auto_publish_off' : 'auto_publish_off') : 'no_dashboards');
  }
  unset($job['chain_token'], $job['chain_token_at'], $job['running'], $job['running_since'], $job['running_token']);
  ll_erp_sync_save_job($job);

  $status = [
    'ok' => true,
    'partial' => false,
    'needs_continue' => false,
    'complete' => true,
    'phase' => $autoPublish ? 'published' : 'ready',
    'lead_count' => count($leads),
    'result_count' => count($results),
    'done' => count($results),
    'audited' => count($results),
    'total' => count($leads),
    'dashboard_count' => count($dashboards),
    'auto_publish' => $autoPublish,
    'published_count' => is_array($published) ? count($published['published'] ?? []) : 0,
    'at' => gmdate('c'),
  ];
  ll_erp_sync_set_last_status($status);
  if ($recordDaily) {
    ll_erp_sync_set_last_daily_status(array_merge($status, [
      'source' => 'daily',
      'message' => $autoPublish
        ? ('Published ' . ($status['published_count'] ?? 0) . ' TeleCaller dashboard(s)')
        : 'Audit complete — publish skipped (cron auto-publish off)',
    ]));
  }

  return array_merge(['ok' => true], $status, [
    'dashboards_preview' => array_map(static fn ($d) => [
      'telecaller_name' => $d['telecaller_name'],
      'lead_count' => $d['lead_count'],
      'title' => $d['title'],
    ], $dashboards),
    'published' => $published,
  ]);
}

/**
 * Cron daily kickoff: always fresh fetch + start/continue audit batch + publish when done.
 * @return array<string, mixed>
 */
function ll_erp_sync_daily_kickoff(array $actor): array
{
  $cfg = ll_erp_sync_load_config();
  if ($actor['username'] === 'erp-sync-cron' && !ll_erp_sync_daily_is_enabled($cfg)) {
    return ['ok' => false, 'error' => 'Daily ERP pipeline is disabled', 'status' => 'disabled'];
  }
  $isCron = $actor['username'] === 'erp-sync-cron';
  if ($isCron && !ll_erp_sync_in_daily_window()) {
    $job = ll_erp_sync_load_job();
    if (is_array($job) && ($job['status'] ?? '') === 'auditing') {
      return ll_erp_sync_continue_job($actor);
    }
    return [
      'ok' => true,
      'idle' => true,
      'skipped_window' => true,
      'status' => 'outside_ist_window',
      'message' => 'Daily cron is ignored outside 6:00 AM IST (05:55–06:45). Keep-alive starts the pipeline at 6:00 AM IST.',
    ];
  }
  if ($isCron && !ll_erp_sync_cron_should_start_daily($cfg)) {
    $job = ll_erp_sync_load_job();
    if (is_array($job) && ($job['status'] ?? '') === 'auditing') {
      return ll_erp_sync_continue_job($actor);
    }
    return [
      'ok' => true,
      'idle' => true,
      'status' => 'already_ran_today',
      'message' => 'Daily pipeline already started today (IST).',
    ];
  }
  ll_erp_sync_mark_daily_kickoff_today();
  return ll_erp_sync_run($actor, true, false, [
    'auto_publish_key' => 'cron_auto_publish',
    'record_daily' => true,
    'skip_enabled_check' => true,
    'self_chain' => true,
  ]);
}

/**
 * Resume in-progress daily/server audit only. No-ops when idle.
 * Self-chains to the next batch when incomplete (cron every-10m is backup only).
 * @return array<string, mixed>
 */
function ll_erp_sync_continue_job(array $actor): array
{
  $cfg = ll_erp_sync_load_config();
  if ($actor['username'] === 'erp-sync-cron' && !ll_erp_sync_daily_is_enabled($cfg)) {
    return ['ok' => true, 'idle' => true, 'status' => 'disabled', 'message' => 'Daily ERP pipeline is disabled'];
  }
  $job = ll_erp_sync_load_job();
  $isDailyJob = is_array($job) && (($job['pipeline'] ?? '') === 'daily' || ($job['status'] ?? '') === 'auditing');
  // Continue any auditing job (daily or advanced) so one cron covers both.
  if (!is_array($job) || ($job['status'] ?? '') !== 'auditing') {
    return [
      'ok' => true,
      'idle' => true,
      'status' => 'idle',
      'needs_continue' => false,
      'message' => 'No in-progress audit job',
    ];
  }
  $recordDaily = $isDailyJob || (($job['pipeline'] ?? '') === 'daily');
  return ll_erp_sync_run($actor, false, false, [
    'auto_publish_key' => $recordDaily ? 'cron_auto_publish' : 'auto_publish',
    'record_daily' => $recordDaily,
    'continue_only' => true,
    'skip_enabled_check' => true,
    'self_chain' => true,
  ]);
}

/**
 * Publish the last completed ERP sync job results (manual, when auto-publish off).
 * @return array<string, mixed>
 */
function ll_erp_sync_publish_last(array $actor): array
{
  $job = ll_erp_sync_load_job();
  if (!$job || empty($job['results']) || !is_array($job['results'])) {
    ll_error('No completed ERP sync results to publish');
  }
  $sourceFile = (string) ($job['source_file'] ?? 'ERP sync');
  $dashboards = ll_erp_sync_build_dashboards($job['results'], $sourceFile);
  if (!$dashboards) {
    ll_error('No dashboards to publish');
  }
  $out = ll_publish_telecaller_dashboards($dashboards, $actor);
  $job['status'] = 'published';
  $job['published_at'] = gmdate('c');
  $job['published_count'] = count($out['published']);
  ll_erp_sync_save_job($job);
  ll_erp_sync_set_last_status([
    'ok' => true,
    'phase' => 'published',
    'published_count' => count($out['published']),
    'at' => gmdate('c'),
  ]);
  return $out;
}

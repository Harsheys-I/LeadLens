<?php

declare(strict_types=1);

require_once __DIR__ . '/../lib/upload-files.php';
require_once __DIR__ . '/../lib/perf-reconcile.php';

/**
 * Terminal TeleCalling Performance upload (no session, no cron secret):
 *   POST perf-dashboards/upload  multipart: username, password, master, history (.json or .xlsx),
 *                                optional telecallers (comma-separated)
 * Parses both reports, reconciles them like perf-dashboard.js, and replaces the published
 * Performance boards in the same request. Responds 201.
 */

const LL_PERF_UPLOAD_MEMORY = '1024M';
const LL_PERF_UPLOAD_TIME_LIMIT = 300;
const LL_PERF_UPLOAD_LOCK = 'leadlens_perf_upload';

function ll_perf_upload_route(): void
{
  ll_require_method('POST');
  $startedAt = ll_perf_upload_started_at();
  if (!$_POST && !$_FILES && (int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 0) {
    ll_error('Request is larger than the server limit (' . (string) ini_get('post_max_size') . ')', 413);
  }
  $warnings = ll_perf_upload_raise_limits();

  $user = ll_upload_authenticate_password();
  if (!ll_user_has_permission($user, 'telecaller.perf_upload')) {
    ll_error('This account needs Upload Performance Dashboard access', 403);
  }

  $state = [
    'log' => [
      'kind' => 'performance',
      'started_at' => $startedAt,
      'source_file' => '',
      'row_count' => 0,
      'lead_count' => 0,
      'uploaded_by' => (string) (($user['display_name'] ?? '') ?: ($user['username'] ?? '')),
      'status' => 'failed',
      'error' => null,
      'published_at' => null,
      'published_count' => null,
    ],
    'lock' => false,
  ];
  ob_start();
  register_shutdown_function(static function () use (&$state): void {
    ll_perf_upload_shutdown($state);
  });

  [$masterBytes, $masterFile, $masterKind] = ll_upload_read_file('master');
  $state['log']['source_file'] = $masterFile;
  [$historyBytes, $historyFile, $historyKind] = ll_upload_read_file('history');
  $state['log']['source_file'] = $masterFile . ' + ' . $historyFile;

  $only = ll_perf_upload_telecaller_filter();

  try {
    $masterRows = ll_perf_upload_parse_report($masterBytes, $masterKind, ll_perf_master_fields(), ll_perf_master_erp_codes());
  } catch (RuntimeException $e) {
    ll_error('Master report: ' . $e->getMessage(), 400);
  } catch (Throwable $e) {
    error_log('LeadLens perf upload master read failed: ' . $e->getMessage());
    ll_error('Master report: could not read the file', 500);
  }
  unset($masterBytes);
  try {
    $historyRows = ll_perf_upload_parse_report($historyBytes, $historyKind, ll_perf_history_fields(), ll_perf_history_erp_codes());
  } catch (RuntimeException $e) {
    ll_error('History report: ' . $e->getMessage(), 400);
  } catch (Throwable $e) {
    error_log('LeadLens perf upload history read failed: ' . $e->getMessage());
    ll_error('History report: could not read the file', 500);
  }
  unset($historyBytes);
  if (!ll_perf_upload_has_value($historyRows, 'updateDate')) {
    ll_error('History report: no row has a valid Lead Update Date — check that the History report was sent as "history"', 400);
  }
  $masterCount = count($masterRows);
  $historyCount = count($historyRows);
  $state['log']['row_count'] = $masterCount + $historyCount;

  if (!ll_perf_upload_lock()) {
    ll_error('Another Performance upload is running — try again shortly', 409);
  }
  $state['lock'] = true;

  $error = null;
  try {
    $reconciled = ll_perf_reconcile($masterRows, $historyRows);
    unset($masterRows, $historyRows);
    $items = ll_perf_build_dashboards($reconciled, $only);
    $unmatched = $only !== null ? ll_perf_upload_unmatched($only, $reconciled['byTelecaller']) : [];
    $meta = [
      'summary' => $reconciled['summary'],
      'date_min' => $reconciled['dateMin'],
      'date_max' => $reconciled['dateMax'],
      'report_days' => (int) $reconciled['reportDays'],
    ];
    unset($reconciled);
    if (!$items) {
      $error = ['No TeleCaller dashboards to publish', 400, $only !== null ? ['unmatched_telecallers' => $unmatched] : []];
    } else {
      $result = ll_perf_dashboards_replace_all($items, $user);
    }
    $telecallerCount = count($items);
    unset($items);
  } catch (Throwable $e) {
    error_log('LeadLens perf upload build failed: ' . $e->getMessage());
    $error = ['Could not build the Performance dashboards', 500, []];
  } finally {
    ll_perf_upload_unlock();
    $state['lock'] = false;
  }
  if ($error !== null) {
    ll_error($error[0], $error[1], $error[2]);
  }

  $publishedAt = gmdate('c');
  $state['log'] = array_merge($state['log'], [
    'lead_count' => $telecallerCount,
    'status' => 'published',
    'published_at' => $publishedAt,
    'published_count' => count($result['published']),
  ]);
  $response = [
    'status' => 'published',
    'telecaller_count' => $telecallerCount,
    'published' => $result['published'],
    'cleared' => $result['cleared'],
    'summary' => $meta['summary'],
    'date_min' => $meta['date_min'],
    'date_max' => $meta['date_max'],
    'report_days' => $meta['report_days'],
    'master_rows' => $masterCount,
    'history_rows' => $historyCount,
    'master_file' => $masterFile,
    'history_file' => $historyFile,
    'uploaded_by' => $state['log']['uploaded_by'],
  ];
  if ($only !== null) {
    $response['unmatched_telecallers'] = $unmatched;
  }
  if ($warnings) {
    $response['warnings'] = $warnings;
  }
  ll_ok($response, 201);
}

/** ISO-8601 UTC with milliseconds, so two uploads in the same second get distinct log keys. */
function ll_perf_upload_started_at(): string
{
  $now = microtime(true);
  $sec = (int) floor($now);
  return gmdate('Y-m-d\TH:i:s', $sec) . sprintf('.%03d', (int) (($now - $sec) * 1000)) . '+00:00';
}

/**
 * Raise memory_limit / time limit for the reconcile step. Never lowers an existing limit.
 * @return list<string> Warnings when the host refused a higher limit
 */
function ll_perf_upload_raise_limits(): array
{
  $warnings = [];
  $current = (string) ini_get('memory_limit');
  $want = ll_perf_upload_ini_bytes(LL_PERF_UPLOAD_MEMORY);
  $have = ll_perf_upload_ini_bytes($current);
  if ($have !== -1 && $have < $want) {
    if (@ini_set('memory_limit', LL_PERF_UPLOAD_MEMORY) === false) {
      $warnings[] = 'Server refused memory_limit ' . LL_PERF_UPLOAD_MEMORY . ' (running with ' . $current . '); very large reports may fail';
    }
  }
  if (function_exists('set_time_limit')) {
    @set_time_limit(LL_PERF_UPLOAD_TIME_LIMIT);
  }
  return $warnings;
}

/** php.ini shorthand ("128M", "1G", "-1") → bytes; -1 means unlimited. */
function ll_perf_upload_ini_bytes(string $value): int
{
  $value = trim($value);
  if ($value === '' || $value === '-1') {
    return -1;
  }
  $num = (int) $value;
  switch (strtolower(substr($value, -1))) {
    case 'g':
      return $num * 1024 * 1024 * 1024;
    case 'm':
      return $num * 1024 * 1024;
    case 'k':
      return $num * 1024;
    default:
      return $num;
  }
}

/** @return list<string>|null Requested TeleCaller names, or null to publish everyone */
function ll_perf_upload_telecaller_filter(): ?array
{
  $raw = trim((string) ($_POST['telecallers'] ?? ''));
  if ($raw === '') {
    return null;
  }
  $names = [];
  foreach (explode(',', $raw) as $part) {
    $name = trim($part);
    if ($name !== '' && !in_array($name, $names, true)) {
      $names[] = $name;
    }
  }
  return $names ?: null;
}

/**
 * @param list<string> $only
 * @return list<string> Requested names with no TeleCaller in the reports
 */
function ll_perf_upload_unmatched(array $only, array $byTelecaller): array
{
  $known = [];
  foreach (array_keys($byTelecaller) as $name) {
    $known[ll_perf_norm((string) $name)] = true;
  }
  return array_values(array_filter($only, static fn (string $name): bool => !isset($known[ll_perf_norm($name)])));
}

/**
 * Keys present on any row. ERP JSON drops empty cells, so row 0 can omit a column
 * that later rows (or the Excel header) still have.
 *
 * @param list<mixed> $list
 * @return array<string, true>
 */
function ll_perf_upload_seen_keys(array $list): array
{
  $seen = [];
  foreach ($list as $item) {
    if (!is_array($item)) {
      continue;
    }
    foreach ($item as $key => $_) {
      $seen[(string) $key] = true;
    }
  }
  return $seen;
}

/**
 * ERP JSON is either header-named (erp_upload.py renames A-codes to Excel headers)
 * or still keyed by A-codes (a raw getreportjsondata upload). Header names win when
 * Mobile and Project Name are present. Source, registration, and next follow-up are
 * optional: a missing letter or header is left blank instead of rejecting the file.
 *
 * @param list<array{id: string, label: string, aliases: string}> $fields
 * @param array<string, string> $codes
 * @return list<array<string, mixed>>
 */
function ll_perf_upload_parse_json(string $binary, array $fields, array $codes): array
{
  $decoded = json_decode($binary, true);
  unset($binary);
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
  unset($decoded);
  if (!isset($list[0]) || !is_array($list[0])) {
    throw new RuntimeException('JSON report has no rows');
  }

  $seen = ll_perf_upload_seen_keys($list);
  $headerColumns = ll_perf_match_columns(array_keys($seen), $fields);
  if (($headerColumns['mobile'] ?? '') !== '' && ($headerColumns['project'] ?? '') !== '') {
    $rawRows = [];
    foreach ($list as $item) {
      if (!is_array($item)) {
        continue;
      }
      $assoc = [];
      foreach ($item as $key => $val) {
        if (is_array($val) || is_object($val)) {
          $val = '';
        }
        $assoc[(string) $key] = trim((string) $val);
      }
      $rawRows[] = $assoc;
    }
    unset($list);
    return ll_perf_upload_rows_from_sheet($rawRows, $fields);
  }

  $requiredIds = [];
  foreach ($fields as $field) {
    if (ll_perf_field_required($field)) {
      $requiredIds[$field['id']] = true;
    }
  }
  $hasCode = false;
  $missing = [];
  foreach ($codes as $code => $fieldId) {
    $headerKey = (string) ($headerColumns[$fieldId] ?? '');
    if (isset($seen[$code]) || $headerKey !== '') {
      $hasCode = true;
    }
    if (isset($requiredIds[$fieldId]) && !isset($seen[$code]) && $headerKey === '') {
      $missing[] = $code;
    }
  }
  if (!$hasCode) {
    $codeKeys = array_keys($codes);
    throw new RuntimeException(ll_perf_upload_json_error(
      'JSON report is missing ' . $codeKeys[0] . '–' . $codeKeys[count($codeKeys) - 1] . ' columns',
      $fields,
      $codes
    ));
  }
  if ($missing) {
    throw new RuntimeException(ll_perf_upload_json_error(
      'JSON report is missing column(s): ' . implode(', ', $missing),
      $fields,
      $codes
    ));
  }
  $fieldRows = [];
  foreach ($list as $item) {
    if (!is_array($item)) {
      continue;
    }
    $assoc = [];
    $empty = true;
    foreach ($codes as $code => $fieldId) {
      $headerKey = (string) ($headerColumns[$fieldId] ?? '');
      $val = null;
      if ($headerKey !== '' && array_key_exists($headerKey, $item)) {
        $candidate = $item[$headerKey];
        if (is_array($candidate) || is_object($candidate)) {
          $candidate = '';
        }
        if (trim((string) $candidate) !== '') {
          $val = $candidate;
        }
      }
      if ($val === null) {
        $val = $item[$code] ?? '';
      }
      if (is_array($val) || is_object($val)) {
        $val = '';
      }
      $val = trim((string) $val);
      if ($val !== '') {
        $empty = false;
      }
      $assoc[$fieldId] = $val;
    }
    if (!$empty) {
      $fieldRows[] = $assoc;
    }
  }
  unset($list);
  $rows = ll_perf_rows_from_field_rows($fieldRows, $fields);
  unset($fieldRows);
  if (!$rows) {
    throw new RuntimeException('The JSON report has no data rows');
  }
  return $rows;
}

/**
 * One uploaded report → normalized Performance rows.
 * Throws RuntimeException with a user-facing message for layout/content problems.
 *
 * @param list<array{id: string, label: string, aliases: string}> $fields
 * @param array<string, string> $codes ERP A-code → field id
 * @return list<array<string, mixed>>
 */
function ll_perf_upload_parse_report(string $binary, string $kind, array $fields, array $codes): array
{
  if ($kind === 'json') {
    return ll_perf_upload_parse_json($binary, $fields, $codes);
  }

  $rawRows = ll_erp_sync_parse_xlsx_rows($binary, ll_erp_sync_default_field_map());
  unset($binary);
  if (!$rawRows) {
    throw new RuntimeException('The first sheet has no data rows');
  }
  return ll_perf_upload_rows_from_sheet($rawRows, $fields);
}

/**
 * xlsx rows keyed by header label → normalized rows, after the same column check as the browser.
 * @param list<array<string, string>> $rawRows
 * @return list<array<string, mixed>>
 */
function ll_perf_upload_rows_from_sheet(array $rawRows, array $fields): array
{
  $columns = ll_perf_match_columns(array_keys(ll_perf_upload_seen_keys($rawRows)), $fields);
  $missing = ll_perf_missing_labels($columns, $fields);
  if ($missing) {
    throw new RuntimeException('Missing column(s): ' . implode(', ', $missing));
  }
  $rows = ll_perf_rows_from_header_rows($rawRows, $columns, $fields);
  if (!$rows) {
    throw new RuntimeException('The first sheet has no data rows');
  }
  return $rows;
}

/** True when at least one row has a non-null $key (e.g. a parsed date). */
function ll_perf_upload_has_value(array $rows, string $key): bool
{
  foreach ($rows as $row) {
    if (($row[$key] ?? null) !== null) {
      return true;
    }
  }
  return false;
}

/** Rewrite ll_erp_json_rows() A-code errors with field labels, e.g. "Mobile (A3)". */
function ll_perf_upload_json_error(string $message, array $fields, array $codes): string
{
  $labels = [];
  foreach ($fields as $field) {
    $labels[$field['id']] = $field['label'];
  }
  $describe = static function (array $list) use ($labels, $codes): string {
    $out = [];
    foreach ($list as $code) {
      $id = $codes[$code] ?? null;
      $out[] = $id !== null && isset($labels[$id]) ? $labels[$id] . ' (' . $code . ')' : $code;
    }
    return 'Missing column(s): ' . implode(', ', $out) . ' — the ERP report layout changed';
  };
  if (preg_match('/^JSON report is missing column\(s\): (.+)$/u', $message, $m)) {
    return $describe(array_map('trim', explode(',', $m[1])));
  }
  if (preg_match('/^JSON report is missing .+ columns$/u', $message)) {
    return $describe(array_keys($codes));
  }
  return $message;
}

function ll_perf_upload_lock(): bool
{
  $stmt = ll_pdo()->prepare('SELECT GET_LOCK(?, 0)');
  $stmt->execute([LL_PERF_UPLOAD_LOCK]);
  return (int) $stmt->fetchColumn() === 1;
}

function ll_perf_upload_unlock(): void
{
  try {
    ll_pdo()->prepare('SELECT RELEASE_LOCK(?)')->execute([LL_PERF_UPLOAD_LOCK]);
  } catch (Throwable $e) {
    // The lock is also dropped when the MySQL session closes.
  }
}

/**
 * Write the upload log row for every exit after auth (ll_error/ll_ok exit, so finally blocks are skipped).
 * Shutdown functions run before output buffers are flushed, so the JSON error body is still readable here.
 *
 * @param array{log: array<string, mixed>, lock: bool} $state
 */
function ll_perf_upload_shutdown(array $state): void
{
  if ($state['lock']) {
    ll_perf_upload_unlock();
  }
  $log = $state['log'];
  if ($log['status'] !== 'published') {
    $body = ob_get_level() > 0 ? (string) ob_get_contents() : '';
    $decoded = $body !== '' ? json_decode($body, true) : null;
    $fatal = error_get_last();
    if (is_array($decoded) && isset($decoded['error'])) {
      $log['error'] = (string) $decoded['error'];
    } elseif ($fatal && in_array($fatal['type'], [E_ERROR, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR], true)) {
      $limit = ll_perf_upload_ini_bytes((string) ini_get('memory_limit'));
      if ($limit !== -1 && str_contains((string) $fatal['message'], 'Allowed memory size')) {
        @ini_set('memory_limit', (string) ($limit + 64 * 1024 * 1024));
      }
      $log['error'] = 'Server error: ' . $fatal['message'];
    } else {
      $log['error'] = 'Upload stopped (HTTP ' . (int) http_response_code() . ')';
    }
  }
  try {
    ll_audit_upload_log_record($log);
  } catch (Throwable $e) {
    // Logging must not change the response.
  }
}

<?php

declare(strict_types=1);

/**
 * TeleCalling Performance — server port of the parse + reconcile engine in perf-dashboard.js.
 * Output must stay identical to reconcilePerf() and the browser publish payload.
 * Dates are epoch milliseconds (float) interpreted in Asia/Kolkata.
 */

const LL_PERF_WS = '[\s\x{00A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]';

function ll_perf_master_fields(): array
{
  return [
    ['id' => 'mobile', 'label' => 'Mobile', 'aliases' => 'mobile, mobile number, phone', 'required' => true],
    ['id' => 'project', 'label' => 'Project Name', 'aliases' => 'project name, project', 'required' => true],
    ['id' => 'source', 'label' => 'Source', 'aliases' => 'source, source name', 'required' => false],
    ['id' => 'registration', 'label' => 'Lead Registration Date', 'aliases' => 'lead registration date, registration date', 'required' => false],
    ['id' => 'next', 'label' => 'Next Followup Date', 'aliases' => 'next followup date, next follow-up date, next follow up date', 'required' => false],
    ['id' => 'status', 'label' => 'Status', 'aliases' => 'status, lead status', 'required' => true],
    ['id' => 'telecaller', 'label' => 'Telecaller Name', 'aliases' => 'telecaller name, tellecaller name, tele caller name, agent name, executive name', 'required' => true],
  ];
}

function ll_perf_history_fields(): array
{
  $fields = array_values(array_filter(
    ll_perf_master_fields(),
    static fn(array $f): bool => $f['id'] !== 'next' && $f['id'] !== 'registration'
  ));
  $fields[] = ['id' => 'update', 'label' => 'Lead Update Date', 'aliases' => 'lead update date, call date, update date, lead update', 'required' => true];
  return $fields;
}

/**
 * Master report 10000022 JSON column codes → field id.
 * 10 Oct 2026 Excel (row 7): A Sr, B Project Name, C Mobile, D Status,
 * E Telecaller Name, F Next Followup Date, G Lead Registration Date, H Source.
 * Registration moved A9→A7 and source A10→A8 after unused columns were removed.
 * A2 Project Name and A3 Mobile did not move.
 * Source, registration, and next follow-up are optional: ERP JSON omits empty cells,
 * so those codes may be absent even when the Excel header exists.
 */
function ll_perf_master_erp_codes(): array
{
  return [
    'A3' => 'mobile',
    'A2' => 'project',
    'A8' => 'source',
    'A7' => 'registration',
    'A6' => 'next',
    'A4' => 'status',
    'A5' => 'telecaller',
  ];
}

/**
 * History report 10000026 JSON column codes → field id.
 * 10 Oct 2026 Excel (row 7): A Sr, B Lead Update Date, C Mobile, D Project Name,
 * E Tellecaller Name, F Status, G Source. Sr is new at A1, so the previous
 * A1–A6 fields each shifted one letter later.
 * Source (A7) is optional and may be omitted when the cell is empty.
 */
function ll_perf_history_erp_codes(): array
{
  return [
    'A2' => 'update',
    'A3' => 'mobile',
    'A4' => 'project',
    'A5' => 'telecaller',
    'A6' => 'status',
    'A7' => 'source',
  ];
}

function ll_perf_metric_keys(): array
{
  return [
    'totalLeads', 'activeLeads', 'totalCalls', 'notFollowupLeads', 'draftLeads', 'siteVisited',
    'siteVisitScheduled', 'siteVisitPending', 'siteVisitCancelled', 'notInterested', 'overdue',
  ];
}

function ll_perf_detail_metric_keys(): array
{
  return [
    'totalLeads', 'activeLeads', 'totalCalls', 'draftLeads', 'notFollowupLeads', 'siteVisited',
    'siteVisitScheduled', 'siteVisitPending', 'siteVisitCancelled', 'notInterested', 'overdue',
  ];
}

function ll_perf_pie_keys(): array
{
  return ['notInterested', 'siteVisitScheduled', 'siteVisitPending', 'siteVisitCancelled', 'siteVisited', 'overdue'];
}

function ll_perf_tz(): DateTimeZone
{
  static $tz = null;
  if ($tz === null) {
    $tz = new DateTimeZone('Asia/Kolkata');
  }
  return $tz;
}

/** JS String(value).trim(). */
function ll_perf_clean($value): string
{
  if ($value === null) {
    return '';
  }
  if (is_bool($value)) {
    $s = $value ? 'true' : 'false';
  } elseif (is_float($value)) {
    $s = (is_finite($value) && floor($value) === $value && abs($value) < 1e21)
      ? sprintf('%.0f', $value)
      : (string) $value;
  } elseif (is_scalar($value)) {
    $s = (string) $value;
  } else {
    return '';
  }
  $t = preg_replace('/^' . LL_PERF_WS . '+|' . LL_PERF_WS . '+$/u', '', $s);
  return $t ?? trim($s);
}

/** JS clean(value).toLowerCase().replace(/\s+/g, " "). */
function ll_perf_norm($value): string
{
  $s = ll_perf_clean($value);
  $s = function_exists('mb_strtolower') ? mb_strtolower($s, 'UTF-8') : strtolower($s);
  $r = preg_replace('/' . LL_PERF_WS . '+/u', ' ', $s);
  return $r ?? $s;
}

function ll_perf_alias_list(string $text): array
{
  $out = [];
  foreach (explode(',', $text) as $part) {
    $n = ll_perf_norm($part);
    if ($n !== '') {
      $out[] = $n;
    }
  }
  return $out;
}

/**
 * @param list<string|int> $headers
 * @return array<string, string> field id => matched header ('' when missing)
 */
function ll_perf_match_columns(array $headers, array $fields): array
{
  $normalized = [];
  foreach ($headers as $header) {
    $normalized[] = ['header' => (string) $header, 'key' => ll_perf_norm($header)];
  }
  $out = [];
  foreach ($fields as $field) {
    $aliases = ll_perf_alias_list((string) $field['aliases']);
    $aliases[] = ll_perf_norm($field['label']);
    $match = '';
    foreach ($normalized as $item) {
      if (in_array($item['key'], $aliases, true)) {
        $match = $item['header'];
        break;
      }
    }
    $out[$field['id']] = $match;
  }
  return $out;
}

/** Identity columns the dashboards cannot run without. Source, registration, and next are optional. */
function ll_perf_field_required(array $field): bool
{
  return ($field['required'] ?? true) !== false;
}

/** @return list<string> */
function ll_perf_missing_labels(array $columns, array $fields): array
{
  $missing = [];
  foreach ($fields as $field) {
    if (!ll_perf_field_required($field)) {
      continue;
    }
    if ((string) ($columns[$field['id']] ?? '') === '') {
      $missing[] = (string) $field['label'];
    }
  }
  return $missing;
}

/** Epoch ms for an IST wall-clock time; out-of-range parts roll over like new Date(y, m, d, ...). */
function ll_perf_local_ms(int $y, int $mo, int $d, int $h = 0, int $mi = 0, int $s = 0, int $ms = 0): float
{
  if ($y >= 0 && $y <= 99) {
    $y += 1900;
  }
  $dt = (new DateTimeImmutable('@0'))
    ->setTimezone(ll_perf_tz())
    ->setDate($y, $mo, $d)
    ->setTime($h, $mi, $s);
  return $dt->getTimestamp() * 1000.0 + $ms;
}

/** Excel 1900-system serial → epoch ms, mirroring XLSX.SSF.parse_date_code + new Date(...) in IST. */
function ll_perf_excel_serial_ms(float $v): ?float
{
  if (!is_finite($v) || $v < 0 || $v > 2958465) {
    return null;
  }
  $date = (int) floor($v);
  $frac = $v - $date;
  $time = (int) floor(86400 * $frac);
  $u = 86400 * $frac - $time;
  if (abs($u) < 1e-6) {
    $u = 0.0;
  }
  if ($u > 0.9999) {
    $time++;
    if ($time === 86400) {
      $time = 0;
      $date++;
    }
  }
  if ($date === 60) {
    [$y, $m, $d] = [1900, 2, 29];
  } elseif ($date === 0) {
    [$y, $m, $d] = [1900, 1, 0];
  } else {
    if ($date > 60) {
      $date--;
    }
    [$y, $m, $d] = [1900, 1, $date];
  }
  $sec = $time % 60;
  $time = intdiv($time, 60);
  $min = $time % 60;
  $hour = intdiv($time, 60);
  return ll_perf_local_ms($y, $m, $d, $hour, $min, $sec);
}

/**
 * parseDateValue port. Returns epoch ms (IST wall clock) or null.
 * Numbers and plain numeric strings in serial range are Excel serials (xlsx rows carry raw cell values).
 */
function ll_perf_parse_date($value): ?float
{
  if ($value instanceof DateTimeInterface) {
    return $value->getTimestamp() * 1000.0 + (int) $value->format('v');
  }
  if (is_int($value) || is_float($value)) {
    return ll_perf_excel_serial_ms((float) $value);
  }
  $s = ll_perf_clean($value);
  if ($s === '') {
    return null;
  }
  if (preg_match('/^\d+(?:\.\d+)?$/', $s)) {
    $n = (float) $s;
    return $n >= 1 ? ll_perf_excel_serial_ms($n) : null;
  }
  if (preg_match('/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?/', $s, $m)) {
    $msPart = isset($m[7]) && $m[7] !== '' ? (int) substr(str_pad($m[7], 3, '0'), 0, 3) : 0;
    return ll_perf_local_ms((int) $m[1], (int) $m[2], (int) $m[3], (int) ($m[4] ?? 0), (int) ($m[5] ?? 0), (int) ($m[6] ?? 0), $msPart);
  }
  if (preg_match('/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?/', $s, $m)) {
    $y = (int) $m[3];
    if ($y < 100) {
      $y += 2000;
    }
    $msPart = isset($m[7]) && $m[7] !== '' ? (int) substr(str_pad($m[7], 3, '0'), 0, 3) : 0;
    return ll_perf_local_ms($y, (int) $m[2], (int) $m[1], (int) ($m[4] ?? 0), (int) ($m[5] ?? 0), (int) ($m[6] ?? 0), $msPart);
  }
  if (!preg_match('/\d/', $s)) {
    return null;
  }
  $dt = date_create_immutable($s, ll_perf_tz());
  return $dt ? $dt->getTimestamp() * 1000.0 + (int) $dt->format('v') : null;
}

function ll_perf_ms_to_ist(float $ms): DateTimeImmutable
{
  return (new DateTimeImmutable('@' . (int) floor($ms / 1000)))->setTimezone(ll_perf_tz());
}

function ll_perf_date_iso(?float $ms): ?string
{
  return $ms === null ? null : ll_perf_ms_to_ist($ms)->format('Y-m-d');
}

/** formatDisplayDate(dateToIso(d)) — drill-down date cells. Interned: every detail row repeats them. */
function ll_perf_display_date(?float $ms): string
{
  static $pool = [];
  if ($ms === null) {
    return '—';
  }
  $s = ll_perf_ms_to_ist($ms)->format('j M Y');
  return $pool[$s] ??= $s;
}

/** Inclusive calendar days between two 'Y-m-d' dates; 0 when either is missing. */
function ll_perf_report_day_count(?string $minIso, ?string $maxIso): int
{
  $min = $minIso === null ? null : ll_perf_parse_date($minIso);
  $max = $maxIso === null ? null : ll_perf_parse_date($maxIso);
  if ($min === null || $max === null) {
    return 0;
  }
  $start = ll_perf_ms_to_ist($min)->setTime(0, 0)->getTimestamp();
  $end = ll_perf_ms_to_ist($max)->setTime(0, 0)->getTimestamp();
  return (int) floor(($end - $start) / 86400) + 1;
}

function ll_perf_tomorrow_start_ms(?int $nowMs): float
{
  $now = $nowMs === null ? new DateTimeImmutable('now', ll_perf_tz()) : ll_perf_ms_to_ist((float) $nowMs);
  return $now->setTime(0, 0)->modify('+1 day')->getTimestamp() * 1000.0;
}

/** Shared rowObjects body: $columns maps field id → key in each raw row. */
function ll_perf_normalize_rows(array $rawRows, array $columns, array $fields): array
{
  $out = [];
  $pool = [];
  foreach ($rawRows as $raw) {
    if (!is_array($raw)) {
      continue;
    }
    $obj = [];
    $blank = true;
    foreach ($fields as $field) {
      $id = $field['id'];
      $header = (string) ($columns[$id] ?? '');
      if ($id === 'registration' || $id === 'next' || $id === 'update') {
        $rawVal = $header !== '' ? ($raw[$header] ?? null) : '';
        $obj[$id] = $rawVal;
        if ($rawVal !== '' && $rawVal !== null) {
          $blank = false;
        }
      } else {
        $val = $header !== '' ? ll_perf_clean($raw[$header] ?? null) : '';
        $obj[$id] = $val;
        if ($val !== '') {
          $blank = false;
        }
      }
    }
    if ($blank) {
      continue;
    }
    if (ll_perf_norm($obj['project'] ?? '') === 'totals'
      || ll_perf_norm($obj['telecaller'] ?? '') === 'totals'
      || ll_perf_norm($obj['mobile'] ?? '') === 'totals') {
      continue;
    }
    $obj['registrationDate'] = ll_perf_parse_date($obj['registration'] ?? null);
    $obj['nextDate'] = ll_perf_parse_date($obj['next'] ?? null);
    $obj['updateDate'] = ll_perf_parse_date($obj['update'] ?? null);
    foreach (['telecaller', 'mobile', 'project', 'source', 'status'] as $k) {
      $v = ll_perf_clean($obj[$k] ?? '');
      $obj[$k] = $pool[$v] ??= $v;
    }
    $out[] = $obj;
  }
  return $out;
}

/**
 * rowObjects port for xlsx rows keyed by header label (ll_erp_sync_parse_xlsx_rows output).
 * @param array<string, string> $columns from ll_perf_match_columns()
 */
function ll_perf_rows_from_header_rows(array $rawRows, array $columns, array $fields): array
{
  return ll_perf_normalize_rows($rawRows, $columns, $fields);
}

/** rowObjects port for rows already keyed by field id (ERP JSON mapped through the A-code maps). */
function ll_perf_rows_from_field_rows(array $rows, array $fields): array
{
  $columns = [];
  foreach ($fields as $field) {
    $columns[$field['id']] = $field['id'];
  }
  return ll_perf_normalize_rows($rows, $columns, $fields);
}

function ll_perf_lead_mobile(array $row): string
{
  $mobile = ll_perf_norm($row['mobile'] ?? '');
  if (preg_match('/^\d+\.0+$/', $mobile)) {
    $mobile = (string) preg_replace('/\.0+$/', '', $mobile);
  }
  if (preg_match('/^\d+(\.\d+)?e\+\d+$/i', $mobile)) {
    $n = (float) $mobile;
    if (is_finite($n)) {
      $mobile = sprintf('%.0f', round($n));
    }
  }
  return $mobile;
}

/** Lead identity: Mobile + TeleCaller Name. */
function ll_perf_lead_key(array $row): string
{
  $mobile = ll_perf_lead_mobile($row);
  if ($mobile === '') {
    return '';
  }
  $tc = ll_perf_norm($row['telecaller'] ?? '');
  return $mobile . '|' . ($tc !== '' ? $tc : 'unknown');
}

/** STE identity: Mobile + TeleCaller + Project. */
function ll_perf_ste_key(array $row): string
{
  $mobile = ll_perf_lead_mobile($row);
  if ($mobile === '') {
    return '';
  }
  $tc = ll_perf_norm($row['telecaller'] ?? '');
  return $mobile . '|' . ($tc !== '' ? $tc : 'unknown') . '|' . ll_perf_norm($row['project'] ?? '');
}

/** Carry forward the last non-empty Mobile/Project/Source/TeleCaller on CRM continuation rows. */
function ll_perf_forward_fill_history(array $historyRows): array
{
  $lastMobile = '';
  $lastProject = '';
  $lastSource = '';
  $lastTelecaller = '';
  $out = [];
  foreach ($historyRows as $row) {
    $filled = $row;
    $mobile = ll_perf_lead_mobile($filled);
    $project = ll_perf_clean($filled['project'] ?? '');
    $source = ll_perf_clean($filled['source'] ?? '');
    $telecaller = ll_perf_clean($filled['telecaller'] ?? '');
    if ($mobile !== '') {
      $cm = ll_perf_clean($filled['mobile'] ?? '');
      $lastMobile = $cm !== '' ? $cm : $mobile;
    }
    if ($project !== '') {
      $lastProject = $project;
    }
    if ($source !== '') {
      $lastSource = $source;
    }
    if ($telecaller !== '') {
      $lastTelecaller = $telecaller;
    }
    if (ll_perf_lead_mobile($filled) === '' && $lastMobile !== '') {
      $filled['mobile'] = $lastMobile;
    }
    if (ll_perf_clean($filled['project'] ?? '') === '' && $lastProject !== '') {
      $filled['project'] = $lastProject;
    }
    if (ll_perf_clean($filled['source'] ?? '') === '' && $lastSource !== '') {
      $filled['source'] = $lastSource;
    }
    if (ll_perf_clean($filled['telecaller'] ?? '') === '' && $lastTelecaller !== '') {
      $filled['telecaller'] = $lastTelecaller;
    }
    if (ll_perf_clean($filled['telecaller'] ?? '') === '') {
      $filled['telecaller'] = 'Unknown';
    }
    if (ll_perf_lead_mobile($filled) !== '') {
      $out[] = $filled;
    }
  }
  return $out;
}

/** Lead Update Date in ms; -1 when missing. */
function ll_perf_lud_ms(array $row): float
{
  $d = $row['updateDate'] ?? null;
  if (is_int($d) || is_float($d)) {
    return (float) $d;
  }
  return ll_perf_parse_date($row['update'] ?? null) ?? -1.0;
}

/**
 * One row per identity key with the max Lead Update Date, in first-seen key order (JS Map semantics).
 * $laterWinsTies: equal LUD replaces the kept row (latest-row rules) or keeps the first (any-row status rules).
 */
function ll_perf_max_lud_rows(array $rows, callable $keyOf, bool $laterWinsTies, ?callable $matches = null): array
{
  $index = [];
  $lud = [];
  foreach ($rows as $i => $row) {
    if ($matches !== null && !$matches($row['status'] ?? '')) {
      continue;
    }
    $key = $keyOf($row);
    if ($key === '') {
      continue;
    }
    $next = ll_perf_lud_ms($row);
    if (!isset($index[$key]) || $next > $lud[$key] || ($laterWinsTies && $next === $lud[$key])) {
      $index[$key] = $i;
      $lud[$key] = $next;
    }
  }
  $out = [];
  foreach ($index as $i) {
    $out[] = $rows[$i];
  }
  return $out;
}

/** collapseHistoryToLatestLead: one History row per lead (Mobile + TeleCaller). */
function ll_perf_latest_per_lead(array $historyFilled): array
{
  return ll_perf_max_lud_rows($historyFilled, 'll_perf_lead_key', true);
}

/** latestRowPerSteKey: one History row per Mobile + TeleCaller + Project. */
function ll_perf_latest_per_ste_key(array $historyFilled): array
{
  return ll_perf_max_lud_rows($historyFilled, 'll_perf_ste_key', true);
}

/** STE / accumulateAnyRowStatusMetric: rows matching a status, once per STE key. */
function ll_perf_best_per_ste_key(array $historyFilled, callable $matches): array
{
  return ll_perf_max_lud_rows($historyFilled, 'll_perf_ste_key', false, $matches);
}

function ll_perf_serialize_detail(array $row): array
{
  return [
    'mobile' => ll_perf_clean($row['mobile'] ?? ''),
    'telecaller' => ll_perf_clean($row['telecaller'] ?? ''),
    'project' => ll_perf_clean($row['project'] ?? ''),
    'source' => ll_perf_clean($row['source'] ?? ''),
    'status' => ll_perf_clean($row['status'] ?? ''),
    'registration' => ll_perf_display_date($row['registrationDate'] ?? null),
    'nextFollowup' => ll_perf_display_date($row['nextDate'] ?? null),
    'updateDate' => ll_perf_display_date($row['updateDate'] ?? null),
  ];
}

function ll_perf_empty_metrics(): array
{
  return array_fill_keys(ll_perf_metric_keys(), 0);
}

function ll_perf_empty_pie_counts(): array
{
  return array_fill_keys(ll_perf_pie_keys(), 0);
}

function ll_perf_new_bucket(): array
{
  return ll_perf_empty_metrics() + [
    'pie' => ll_perf_empty_pie_counts(),
    'details' => array_fill_keys(ll_perf_detail_metric_keys(), []),
    '_masterKeys' => [],
    '_historyKeys' => [],
    '_overdueKeys' => [],
    '_draftKeys' => [],
    '_notFollowupKeys' => [],
    '_leadMasterRow' => [],
    '_leadHistoryRow' => [],
    '_detailKeys' => [],
  ];
}

/** createBucketMaps ensure(): returns the bucket key, creating/renaming the bucket as needed. */
function ll_perf_ensure_bucket(array &$map, $name): string
{
  $display = ll_perf_clean($name);
  if ($display === '') {
    $display = 'Unknown';
  }
  $key = ll_perf_norm($display);
  if ($key === '') {
    $key = 'unknown';
  }
  if (!isset($map[$key])) {
    $map[$key] = ll_perf_new_bucket();
    $map[$key]['_displayName'] = $display;
  } elseif ($display !== 'Unknown' && $map[$key]['_displayName'] === 'Unknown') {
    $map[$key]['_displayName'] = $display;
  }
  return $key;
}

/** createBucketMaps ensureCompound(): telecaller × dimension bucket. */
function ll_perf_ensure_compound(array &$map, $tcName, $dimName): string
{
  $tcDisplay = ll_perf_clean($tcName);
  if ($tcDisplay === '') {
    $tcDisplay = 'Unknown';
  }
  $dimDisplay = ll_perf_clean($dimName);
  if ($dimDisplay === '') {
    $dimDisplay = 'Unknown';
  }
  $tcKey = ll_perf_norm($tcDisplay);
  $dimKey = ll_perf_norm($dimDisplay);
  $key = ($tcKey !== '' ? $tcKey : 'unknown') . "\0" . ($dimKey !== '' ? $dimKey : 'unknown');
  if (!isset($map[$key])) {
    $map[$key] = ll_perf_new_bucket();
    $map[$key]['_tcDisplay'] = $tcDisplay;
    $map[$key]['_dimDisplay'] = $dimDisplay;
  } else {
    if ($tcDisplay !== 'Unknown' && $map[$key]['_tcDisplay'] === 'Unknown') {
      $map[$key]['_tcDisplay'] = $tcDisplay;
    }
    if ($dimDisplay !== 'Unknown' && $map[$key]['_dimDisplay'] === 'Unknown') {
      $map[$key]['_dimDisplay'] = $dimDisplay;
    }
  }
  return $key;
}

/**
 * Run every resolver for $row (telecaller, project, source, tc×project, tc×source).
 * @return list<array{0:string,1:string}> [map name, bucket key] pairs
 */
function ll_perf_resolve(array &$maps, array $row): array
{
  return [
    ['byTelecaller', ll_perf_ensure_bucket($maps['byTelecaller'], $row['telecaller'] ?? '')],
    ['byProject', ll_perf_ensure_bucket($maps['byProject'], $row['project'] ?? '')],
    ['bySource', ll_perf_ensure_bucket($maps['bySource'], $row['source'] ?? '')],
    ['tcProject', ll_perf_ensure_compound($maps['tcProject'], $row['telecaller'] ?? '', $row['project'] ?? '')],
    ['tcSource', ll_perf_ensure_compound($maps['tcSource'], $row['telecaller'] ?? '', $row['source'] ?? '')],
  ];
}

function ll_perf_push_detail_once(array &$bucket, string $metric, array $detail, string $dedupeKey): void
{
  if ($dedupeKey === '' || isset($bucket['_detailKeys'][$metric][$dedupeKey])) {
    return;
  }
  $bucket['_detailKeys'][$metric][$dedupeKey] = true;
  $bucket['details'][$metric][] = $detail;
}

function ll_perf_finalize_bucket(array $bucket): array
{
  $union = $bucket['_masterKeys'] + $bucket['_historyKeys'];
  $bucket['activeLeads'] = count($bucket['_masterKeys']);
  $bucket['totalLeads'] = count($union);
  $bucket['overdue'] = count($bucket['_overdueKeys']);
  $bucket['draftLeads'] = count($bucket['_draftKeys']);
  $bucket['notFollowupLeads'] = count($bucket['_notFollowupKeys']);
  foreach ($union as $key => $_) {
    $detail = $bucket['_leadHistoryRow'][$key] ?? $bucket['_leadMasterRow'][$key] ?? null;
    if ($detail !== null) {
      $bucket['details']['totalLeads'][] = $detail;
    }
  }
  $pie = [];
  foreach (ll_perf_pie_keys() as $k) {
    $pie[$k] = (int) $bucket[$k];
  }
  $bucket['pie'] = $pie;
  unset(
    $bucket['_masterKeys'], $bucket['_historyKeys'], $bucket['_overdueKeys'], $bucket['_draftKeys'],
    $bucket['_notFollowupKeys'], $bucket['_leadMasterRow'], $bucket['_leadHistoryRow'], $bucket['_detailKeys']
  );
  return $bucket;
}

/** Reorder like JS object keys: canonical array-index keys first (ascending), then insertion order. */
function ll_perf_js_key_order(array $map): array
{
  $index = [];
  $rest = [];
  foreach ($map as $k => $v) {
    if (is_int($k) && $k >= 0 && $k <= 4294967294) {
      $index[$k] = $v;
    } else {
      $rest[$k] = $v;
    }
  }
  if (!$index) {
    return $map;
  }
  ksort($index, SORT_NUMERIC);
  return $index + $rest;
}

function ll_perf_buckets_to_display(array $map): array
{
  $out = [];
  foreach (ll_perf_js_key_order($map) as $bucket) {
    $name = $bucket['_displayName'] ?? 'Unknown';
    unset($bucket['_displayName']);
    $out[$name] = $bucket;
  }
  return ll_perf_js_key_order($out);
}

/** Group compound buckets into [telecallerName => [dimName => bucket]]. */
function ll_perf_compound_to_nested(array $map): array
{
  $out = [];
  foreach ($map as $bucket) {
    $tc = $bucket['_tcDisplay'] ?? 'Unknown';
    $dim = $bucket['_dimDisplay'] ?? 'Unknown';
    unset($bucket['_tcDisplay'], $bucket['_dimDisplay']);
    $out[$tc][$dim] = $bucket;
  }
  foreach ($out as $tc => $dims) {
    $out[$tc] = ll_perf_js_key_order($dims);
  }
  return ll_perf_js_key_order($out);
}

/**
 * reconcilePerf port. Rows are from ll_perf_rows_from_header_rows / ll_perf_rows_from_field_rows.
 * Lead = Mobile + TeleCaller; STE/SVS/SVP/SVC are once per Mobile + TeleCaller + Project.
 * $nowMs fixes "today" for the overdue cut-off (start of tomorrow, IST).
 */
function ll_perf_reconcile(array $masterRows, array $historyRows, ?int $nowMs = null): array
{
  $dateMin = null;
  $dateMax = null;
  foreach ($historyRows as $row) {
    $d = $row['updateDate'] ?? null;
    if ($d === null) {
      continue;
    }
    if ($dateMin === null || $d < $dateMin) {
      $dateMin = $d;
    }
    if ($dateMax === null || $d > $dateMax) {
      $dateMax = $d;
    }
  }

  $historyFilled = [];
  foreach (ll_perf_forward_fill_history($historyRows) as $row) {
    $row['_detail'] = ll_perf_serialize_detail($row);
    $historyFilled[] = $row;
  }
  $historyLeads = ll_perf_latest_per_lead($historyFilled);
  $dateMinIso = ll_perf_date_iso($dateMin === null ? null : (float) $dateMin);
  $dateMaxIso = ll_perf_date_iso($dateMax === null ? null : (float) $dateMax);
  $reportDays = ll_perf_report_day_count($dateMinIso, $dateMaxIso);

  $maps = ['byTelecaller' => [], 'byProject' => [], 'bySource' => [], 'tcProject' => [], 'tcSource' => []];
  $allMasterKeys = [];
  $allHistoryKeys = [];
  $allHistoryLeadKeys = [];
  $tomorrow = ll_perf_tomorrow_start_ms($nowMs);

  foreach ($historyFilled as $row) {
    $key = ll_perf_lead_key($row);
    if ($key !== '') {
      $allHistoryLeadKeys[$key] = true;
    }
  }

  foreach ($masterRows as $row) {
    if (!is_array($row)) {
      continue;
    }
    $key = ll_perf_lead_key($row);
    if ($key === '') {
      continue;
    }
    $detail = ll_perf_serialize_detail($row);
    $targets = ll_perf_resolve($maps, $row);
    $isDraft = ll_perf_norm($row['status'] ?? '') === 'draft';
    $notFollowup = !isset($allHistoryLeadKeys[$key]) && !$isDraft;
    $next = $row['nextDate'] ?? null;
    $isOverdue = $next !== null && $next < $tomorrow;
    $allMasterKeys[$key] = true;
    foreach ($targets as [$m, $k]) {
      $b = &$maps[$m][$k];
      $b['_masterKeys'][$key] = true;
      $b['_leadMasterRow'][$key] = $detail;
      if ($isDraft) {
        $b['_draftKeys'][$key] = true;
        ll_perf_push_detail_once($b, 'draftLeads', $detail, $key);
      }
      if ($notFollowup) {
        $b['_notFollowupKeys'][$key] = true;
        ll_perf_push_detail_once($b, 'notFollowupLeads', $detail, $key);
      }
      if ($isOverdue) {
        $b['_overdueKeys'][$key] = true;
        ll_perf_push_detail_once($b, 'overdue', $detail, $key);
      }
      ll_perf_push_detail_once($b, 'activeLeads', $detail, $key);
      unset($b);
    }
  }

  foreach ($historyFilled as $row) {
    foreach (ll_perf_resolve($maps, $row) as [$m, $k]) {
      $maps[$m][$k]['totalCalls'] += 1;
      $maps[$m][$k]['details']['totalCalls'][] = $row['_detail'];
    }
  }

  $credit = static function (array $rows, string $field) use (&$maps): void {
    foreach ($rows as $row) {
      $steKey = ll_perf_ste_key($row);
      foreach (ll_perf_resolve($maps, $row) as [$m, $k]) {
        $maps[$m][$k][$field] += 1;
        ll_perf_push_detail_once($maps[$m][$k], $field, $row['_detail'], $steKey);
      }
    }
  };

  $statusIs = static fn(string $target): callable => static fn($status): bool => ll_perf_norm($status) === $target;

  $credit(ll_perf_best_per_ste_key($historyFilled, static function ($status): bool {
    $s = ll_perf_norm($status);
    return $s === 'sent to enquiry' || $s === 'send to enquiry';
  }), 'siteVisited');

  $credit(array_values(array_filter(
    ll_perf_latest_per_ste_key($historyFilled),
    static fn(array $row): bool => ll_perf_norm($row['status'] ?? '') === 'site visit scheduled'
  )), 'siteVisitScheduled');

  $credit(ll_perf_best_per_ste_key($historyFilled, $statusIs('site visit pending')), 'siteVisitPending');
  $credit(ll_perf_best_per_ste_key($historyFilled, $statusIs('site visit cancelled')), 'siteVisitCancelled');

  foreach ($historyLeads as $row) {
    $key = ll_perf_lead_key($row);
    if ($key === '') {
      continue;
    }
    $targets = ll_perf_resolve($maps, $row);
    foreach ($targets as [$m, $k]) {
      $maps[$m][$k]['_historyKeys'][$key] = true;
      $maps[$m][$k]['_leadHistoryRow'][$key] = $row['_detail'];
    }
    $allHistoryKeys[$key] = true;
    if (ll_perf_norm($row['status'] ?? '') === 'not interested') {
      foreach ($targets as [$m, $k]) {
        $maps[$m][$k]['notInterested'] += 1;
        ll_perf_push_detail_once($maps[$m][$k], 'notInterested', $row['_detail'], $key);
      }
    }
  }

  foreach (array_keys($maps) as $m) {
    foreach (array_keys($maps[$m]) as $k) {
      $maps[$m][$k] = ll_perf_finalize_bucket($maps[$m][$k]);
    }
  }

  $byTelecaller = ll_perf_buckets_to_display($maps['byTelecaller']);
  $byProject = ll_perf_buckets_to_display($maps['byProject']);
  $bySource = ll_perf_buckets_to_display($maps['bySource']);
  $byTelecallerProject = ll_perf_compound_to_nested($maps['tcProject']);
  $byTelecallerSource = ll_perf_compound_to_nested($maps['tcSource']);
  unset($maps);

  $summary = ll_perf_empty_metrics();
  $summary['activeLeads'] = count($allMasterKeys);
  $summary['totalLeads'] = count($allMasterKeys + $allHistoryKeys);
  $summed = [
    'totalCalls', 'notFollowupLeads', 'draftLeads', 'notInterested', 'siteVisitScheduled',
    'siteVisitPending', 'siteVisitCancelled', 'siteVisited', 'overdue',
  ];
  foreach ($byTelecaller as $bucket) {
    foreach ($summed as $k) {
      $summary[$k] += (int) $bucket[$k];
    }
  }

  $pie = [];
  foreach (ll_perf_pie_keys() as $k) {
    $pie[$k] = $summary[$k];
  }

  return [
    'summary' => $summary,
    'byTelecaller' => $byTelecaller,
    'byProject' => $byProject,
    'bySource' => $bySource,
    'byTelecallerProject' => $byTelecallerProject,
    'byTelecallerSource' => $byTelecallerSource,
    'pie' => $pie,
    'dateMin' => $dateMinIso,
    'dateMax' => $dateMaxIso,
    'reportDays' => $reportDays,
  ];
}

/** Sort like a.localeCompare(b, undefined, {sensitivity: "base"}). */
function ll_perf_sort_names(array $names): array
{
  if (class_exists('Collator')) {
    $collator = new Collator('en');
    $collator->setStrength(Collator::PRIMARY);
    usort($names, static fn(string $a, string $b): int => (int) $collator->compare($a, $b));
  } else {
    usort($names, static fn(string $a, string $b): int => strcasecmp($a, $b));
  }
  return $names;
}

/**
 * Publish items for perf-dashboards (same shape as the browser confirm handler).
 * @param list<string>|null $only TeleCaller names to publish (case/whitespace-insensitive); null = all
 * @return list<array<string, mixed>>
 */
function ll_perf_build_dashboards(array $reconciled, ?array $only = null): array
{
  $byTelecaller = is_array($reconciled['byTelecaller'] ?? null) ? $reconciled['byTelecaller'] : [];
  $names = ll_perf_sort_names(array_map('strval', array_keys($byTelecaller)));
  if ($only !== null) {
    $wanted = [];
    foreach ($only as $name) {
      $n = ll_perf_norm($name);
      if ($n !== '') {
        $wanted[$n] = true;
      }
    }
    $names = array_values(array_filter($names, static fn(string $name): bool => isset($wanted[ll_perf_norm($name)])));
  }

  $items = [];
  foreach ($names as $name) {
    $bucket = $byTelecaller[$name];
    $summary = ll_perf_empty_metrics();
    foreach (ll_perf_metric_keys() as $k) {
      $summary[$k] = (int) ($bucket[$k] ?? 0);
    }
    $pie = ll_perf_empty_pie_counts();
    foreach (ll_perf_pie_keys() as $k) {
      $pie[$k] = (int) ($bucket['pie'][$k] ?? 0);
    }
    $items[] = [
      'telecaller_name' => $name,
      'title' => $name . ' · Performance',
      'summary' => $summary,
      'byTelecaller' => [$name => $bucket],
      'byProject' => $reconciled['byTelecallerProject'][$name] ?? [],
      'bySource' => $reconciled['byTelecallerSource'][$name] ?? [],
      'pie' => $pie,
      'date_min' => $reconciled['dateMin'] ?? null,
      'date_max' => $reconciled['dateMax'] ?? null,
      'report_days' => (int) ($reconciled['reportDays'] ?? 0),
    ];
  }
  return $items;
}

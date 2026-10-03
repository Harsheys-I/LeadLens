<?php

declare(strict_types=1);

require_once __DIR__ . '/erp-sync.php';

/**
 * Terminal upload helpers shared by audit/upload and perf-dashboards/upload:
 * password auth, multipart file reading, and Strategic ERP getreportjsondata rows.
 */

/**
 * Same password check as auth/login, from multipart username + password.
 * @return array<string, mixed> Public user
 */
function ll_upload_authenticate_password(): array
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
  return ll_public_user($row);
}

/** Drop fractional seconds so "2024-01-29 10:10:00.0" parses as a date. */
function ll_erp_json_trim_fraction(string $value): string
{
  if (preg_match('/^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})\.\d+$/', $value, $m)) {
    return $m[1];
  }
  return $value;
}

/**
 * ERP report JSON (a list of A-code objects, optionally wrapped in data/rows/…) → rows keyed by field id.
 * Values are trimmed strings; arrays/objects become ''. All-empty rows are skipped.
 *
 * @param array<string, string> $codeToField e.g. ['A1' => 'mobile', ...]
 * @param list<string> $requiredCodes Codes that must all be present in the first row
 * @return list<array<string, string>>
 */
function ll_erp_json_rows(string $raw, array $codeToField, bool $trimFraction, array $requiredCodes = []): array
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
  unset($decoded);
  if (!isset($list[0]) || !is_array($list[0])) {
    throw new RuntimeException('JSON report has no rows');
  }
  $sample = $list[0];
  $hasCode = false;
  foreach ($codeToField as $code => $_field) {
    if (array_key_exists($code, $sample)) {
      $hasCode = true;
      break;
    }
  }
  if (!$hasCode) {
    $codes = array_keys($codeToField);
    throw new RuntimeException('JSON report is missing ' . $codes[0] . '–' . $codes[count($codes) - 1] . ' columns');
  }
  $missing = [];
  foreach ($requiredCodes as $code) {
    if (!array_key_exists($code, $sample)) {
      $missing[] = $code;
    }
  }
  if ($missing) {
    throw new RuntimeException('JSON report is missing column(s): ' . implode(', ', $missing));
  }

  $rows = [];
  foreach ($list as $item) {
    if (!is_array($item)) {
      continue;
    }
    $assoc = [];
    $empty = true;
    foreach ($codeToField as $code => $fieldId) {
      $val = $item[$code] ?? '';
      if (is_array($val) || is_object($val)) {
        $val = '';
      }
      $val = trim((string) $val);
      if ($trimFraction) {
        $val = ll_erp_json_trim_fraction($val);
      }
      if ($val !== '') {
        $empty = false;
      }
      $assoc[$fieldId] = $val;
    }
    if (!$empty) {
      $rows[] = $assoc;
    }
  }
  return $rows;
}

/**
 * Read one multipart file ($_FILES[$field]) as .xlsx or Strategic ERP .json.
 *
 * @param list<string> $allowedExt Lowercase extensions, subset of ['xlsx', 'json']
 * @return array{0: string, 1: string, 2: string} Bytes, display name, and "xlsx" or "json"
 */
function ll_upload_read_file(string $field, array $allowedExt = ['xlsx', 'json']): array
{
  $attachHint = $field === 'file'
    ? 'Attach the workbook as form field "file" (e.g. -F "file=@leads.xlsx")'
    : 'Attach the report as form field "' . $field . '" (e.g. -F "' . $field . '=@' . $field . '.json")';
  $file = $_FILES[$field] ?? null;
  if (!is_array($file) || !isset($file['error']) || is_array($file['error'])) {
    ll_error($attachHint);
  }
  $err = (int) $file['error'];
  if ($err === UPLOAD_ERR_INI_SIZE || $err === UPLOAD_ERR_FORM_SIZE) {
    ll_error('File is larger than the server upload limit (' . (string) ini_get('upload_max_filesize') . ')', 413);
  }
  if ($err === UPLOAD_ERR_NO_FILE) {
    ll_error($attachHint);
  }
  if ($err !== UPLOAD_ERR_OK) {
    ll_error('File upload failed (code ' . $err . ')', 400);
  }
  $name = basename(str_replace('\\', '/', (string) ($file['name'] ?? '')));
  $ext = strtolower((string) pathinfo($name, PATHINFO_EXTENSION));
  if (!in_array($ext, $allowedExt, true)) {
    $sorted = $allowedExt;
    sort($sorted);
    ll_error($sorted === ['json', 'xlsx']
      ? 'Only .xlsx or Strategic ERP .json reports are supported'
      : 'Only ' . implode(' or ', array_map(static fn (string $e): string => '.' . $e, $allowedExt)) . ' files are supported');
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

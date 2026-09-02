<?php

declare(strict_types=1);

function ll_json($data, int $status = 200): void
{
  http_response_code($status);
  header('Content-Type: application/json; charset=utf-8');
  header('Cache-Control: no-store');
  echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

function ll_error(string $message, int $status = 400, array $extra = []): void
{
  ll_json(array_merge(['ok' => false, 'error' => $message], $extra), $status);
}

function ll_ok(array $data = [], int $status = 200): void
{
  ll_json(array_merge(['ok' => true], $data), $status);
}

function ll_read_json_body(): array
{
  $raw = file_get_contents('php://input');
  if ($raw === false || trim($raw) === '') {
    return [];
  }
  $decoded = json_decode($raw, true);
  if (!is_array($decoded)) {
    ll_error('Invalid JSON body', 400);
  }
  return $decoded;
}

function ll_method(): string
{
  return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
}

function ll_require_method(string ...$methods): void
{
  $current = ll_method();
  foreach ($methods as $m) {
    if ($current === strtoupper($m)) {
      return;
    }
  }
  ll_error('Method not allowed', 405);
}

<?php

declare(strict_types=1);

function ll_pdo(): PDO
{
  static $pdo = null;
  if ($pdo instanceof PDO) {
    return $pdo;
  }

  $cfg = $GLOBALS['LL_CONFIG']['db'] ?? null;
  if (!$cfg || empty($cfg['name']) || empty($cfg['user'])) {
    ll_error('Database is not configured. Copy api/config.example.php to api/config.local.php.', 503);
  }

  $dsn = sprintf(
    'mysql:host=%s;dbname=%s;charset=%s',
    $cfg['host'] ?? 'localhost',
    $cfg['name'],
    $cfg['charset'] ?? 'utf8mb4'
  );

  try {
    $pdo = new PDO($dsn, $cfg['user'], $cfg['pass'] ?? '', [
      PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
      PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
      PDO::ATTR_EMULATE_PREPARES => false,
    ]);
  } catch (Throwable $e) {
    ll_error('Database connection failed: ' . $e->getMessage(), 503);
  }

  return $pdo;
}

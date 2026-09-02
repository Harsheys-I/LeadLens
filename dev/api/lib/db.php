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
    ll_error('Database is not configured. On the live Hostinger server, create api/config.local.php from config.example.php with real MySQL credentials (it is gitignored and will not deploy from Git).', 503);
  }

  $usingExample = ($GLOBALS['LL_CONFIG_SOURCE'] ?? '') === 'example';
  $placeholderUser = ($cfg['user'] ?? '') === 'your_database_user';
  $placeholderName = ($cfg['name'] ?? '') === 'your_database_name';
  $placeholderPass = ($cfg['pass'] ?? '') === 'your_database_password';
  if ($usingExample || $placeholderUser || $placeholderName || $placeholderPass) {
    ll_error(
      'MySQL credentials are still placeholders. Upload api/config.local.php on the Hostinger server (File Manager or FTP) with real hPanel database name/user/password. Git deploy will not include this file because it is gitignored. Then open /api/install.php once.',
      503
    );
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

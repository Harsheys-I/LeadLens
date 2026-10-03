<?php
/**
 * Copy to config.local.php and fill in Hostinger MySQL credentials.
 * config.local.php is gitignored — never commit real passwords.
 */
return [
  'db' => [
    'host' => 'localhost',
    'name' => 'your_database_name',
    'user' => 'your_database_user',
    'pass' => 'your_database_password',
    'charset' => 'utf8mb4',
  ],
  'session' => [
    // Random long string used to sign session tokens (change on every install)
    'secret' => 'change-me-to-a-long-random-string',
    'cookie_name' => 'leadlens_session',
    'ttl_seconds' => 60 * 60 * 24 * 14, // 14 days
  ],
  'app' => [
    'name' => 'GPP AI',
    // Set true immediately after first successful /api/install.php
    'install_locked' => false,
    // Optional: required to re-run install when users already exist (POST force_token=…)
    'install_force_token' => '',
    // Used to encrypt OpenAI API key + ERP cookie at rest (AES-256-GCM).
    // Must be a long random string — placeholders are rejected at runtime.
    'secrets_key' => 'change-me-to-another-long-random-string',
  ],
];

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
    // Set true after first install if you want install.php to refuse re-runs
    'install_locked' => false,
    // Used to encrypt OpenAI API key at rest (AES-256-GCM). Falls back to session.secret if empty.
    'secrets_key' => 'change-me-to-another-long-random-string',
  ],
];

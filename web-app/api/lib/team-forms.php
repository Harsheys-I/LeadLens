<?php

declare(strict_types=1);

/** Valid per-group membership roles. */
function ll_tf_roles(): array
{
  return ['form_creator', 'reviewer', 'assignee'];
}

function ll_tf_task_statuses(): array
{
  return ['pending', 'in_progress', 'submitted', 'approved', 'rework', 'closed'];
}

function ll_tf_field_types(): array
{
  return ['text', 'textarea', 'number', 'select', 'checkbox', 'date', 'readonly', 'calculated'];
}

function ll_tf_calc_ops(): array
{
  return ['add', 'subtract', 'multiply', 'divide'];
}

/**
 * Create Team Forms tables on first API hit (Hostinger upgrade without reinstall).
 */
function ll_team_forms_ensure_tables(): void
{
  static $done = false;
  if ($done) {
    return;
  }
  $done = true;
  $pdo = ll_pdo();

  $pdo->exec("CREATE TABLE IF NOT EXISTS departments (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    description TEXT NULL,
    created_by INT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_departments_name (name),
    KEY idx_departments_created (created_by),
    CONSTRAINT fk_departments_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

  $pdo->exec("CREATE TABLE IF NOT EXISTS org_groups (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    department_id INT UNSIGNED NOT NULL,
    name VARCHAR(120) NOT NULL,
    description TEXT NULL,
    created_by INT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_org_groups_dept_name (department_id, name),
    KEY idx_org_groups_dept (department_id),
    KEY idx_org_groups_created (created_by),
    CONSTRAINT fk_org_groups_dept FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
    CONSTRAINT fk_org_groups_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

  $pdo->exec("CREATE TABLE IF NOT EXISTS group_members (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    group_id INT UNSIGNED NOT NULL,
    user_id INT UNSIGNED NOT NULL,
    role ENUM('form_creator','reviewer','assignee') NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_group_members_role (group_id, user_id, role),
    KEY idx_group_members_user (user_id),
    CONSTRAINT fk_group_members_group FOREIGN KEY (group_id) REFERENCES org_groups(id) ON DELETE CASCADE,
    CONSTRAINT fk_group_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

  $pdo->exec("CREATE TABLE IF NOT EXISTS form_templates (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    group_id INT UNSIGNED NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT NULL,
    created_by INT UNSIGNED NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_form_templates_group (group_id),
    KEY idx_form_templates_created (created_by),
    CONSTRAINT fk_form_templates_group FOREIGN KEY (group_id) REFERENCES org_groups(id) ON DELETE CASCADE,
    CONSTRAINT fk_form_templates_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

  $pdo->exec("CREATE TABLE IF NOT EXISTS form_fields (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    form_id INT UNSIGNED NOT NULL,
    field_key VARCHAR(80) NOT NULL,
    label VARCHAR(200) NOT NULL,
    field_type VARCHAR(40) NOT NULL,
    options_json JSON NULL,
    readonly_value TEXT NULL,
    calc_op VARCHAR(20) NULL,
    calc_left_field_id INT UNSIGNED NULL,
    calc_right_field_id INT UNSIGNED NULL,
    required TINYINT(1) NOT NULL DEFAULT 0,
    sort_order INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_form_fields_key (form_id, field_key),
    KEY idx_form_fields_form (form_id, sort_order),
    CONSTRAINT fk_form_fields_form FOREIGN KEY (form_id) REFERENCES form_templates(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

  $pdo->exec("CREATE TABLE IF NOT EXISTS form_tasks (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    form_id INT UNSIGNED NOT NULL,
    assignee_id INT UNSIGNED NOT NULL,
    assigned_by INT UNSIGNED NULL,
    reviewer_scope ENUM('group','department') NOT NULL DEFAULT 'group',
    status ENUM('pending','in_progress','submitted','approved','rework','closed') NOT NULL DEFAULT 'pending',
    submitted_at DATETIME NULL,
    approved_at DATETIME NULL,
    closed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_form_tasks_form (form_id),
    KEY idx_form_tasks_assignee (assignee_id, status),
    KEY idx_form_tasks_status (status, updated_at),
    CONSTRAINT fk_form_tasks_form FOREIGN KEY (form_id) REFERENCES form_templates(id) ON DELETE CASCADE,
    CONSTRAINT fk_form_tasks_assignee FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_form_tasks_assigned_by FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

  $pdo->exec("CREATE TABLE IF NOT EXISTS form_answers (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    task_id INT UNSIGNED NOT NULL,
    field_id INT UNSIGNED NOT NULL,
    value_text TEXT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_form_answers_task_field (task_id, field_id),
    KEY idx_form_answers_field (field_id),
    CONSTRAINT fk_form_answers_task FOREIGN KEY (task_id) REFERENCES form_tasks(id) ON DELETE CASCADE,
    CONSTRAINT fk_form_answers_field FOREIGN KEY (field_id) REFERENCES form_fields(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

  $pdo->exec("CREATE TABLE IF NOT EXISTS form_comments (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    task_id INT UNSIGNED NOT NULL,
    user_id INT UNSIGNED NOT NULL,
    body TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_form_comments_task (task_id, created_at),
    CONSTRAINT fk_form_comments_task FOREIGN KEY (task_id) REFERENCES form_tasks(id) ON DELETE CASCADE,
    CONSTRAINT fk_form_comments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
}

function ll_tf_can_manage_org(array $user): bool
{
  return !empty($user['is_super']) || ll_user_has_permission($user, 'team_forms.manage_org');
}

function ll_tf_require_module(array $user): void
{
  if (
    !ll_user_has_permission($user, 'module.team_forms')
    && !ll_user_has_permission($user, 'team_forms.use')
    && empty($user['is_super'])
  ) {
    ll_error('Forbidden', 403);
  }
}

/** @return list<string> */
function ll_user_group_roles(int $userId, int $groupId): array
{
  ll_team_forms_ensure_tables();
  $stmt = ll_pdo()->prepare(
    'SELECT role FROM group_members WHERE user_id = ? AND group_id = ?'
  );
  $stmt->execute([$userId, $groupId]);
  return array_values(array_map('strval', $stmt->fetchAll(PDO::FETCH_COLUMN)));
}

function ll_tf_user_has_group_role(int $userId, int $groupId, string $role): bool
{
  return in_array($role, ll_user_group_roles($userId, $groupId), true);
}

/**
 * Compact memberships for auth/me.
 * @return list<array{department_id:int,department_name:string,group_id:int,group_name:string,roles:list<string>}>
 */
function ll_tf_org_memberships(int $userId): array
{
  try {
    ll_team_forms_ensure_tables();
  } catch (Throwable $e) {
    return [];
  }
  $stmt = ll_pdo()->prepare(
    'SELECT g.id AS group_id, g.name AS group_name,
            d.id AS department_id, d.name AS department_name,
            gm.role
     FROM group_members gm
     INNER JOIN org_groups g ON g.id = gm.group_id
     INNER JOIN departments d ON d.id = g.department_id
     WHERE gm.user_id = ?
     ORDER BY d.name ASC, g.name ASC, gm.role ASC'
  );
  $stmt->execute([$userId]);
  $byGroup = [];
  foreach ($stmt->fetchAll() as $row) {
    $gid = (int) $row['group_id'];
    if (!isset($byGroup[$gid])) {
      $byGroup[$gid] = [
        'department_id' => (int) $row['department_id'],
        'department_name' => (string) $row['department_name'],
        'group_id' => $gid,
        'group_name' => (string) $row['group_name'],
        'roles' => [],
      ];
    }
    $byGroup[$gid]['roles'][] = (string) $row['role'];
  }
  return array_values($byGroup);
}

function ll_tf_slug_key(string $label, string $fallback = 'field'): string
{
  $key = strtolower(trim($label));
  $key = preg_replace('/[^a-z0-9]+/', '_', $key) ?? '';
  $key = trim($key, '_');
  if ($key === '') {
    $key = $fallback;
  }
  return substr($key, 0, 60);
}

function ll_tf_eval_calc(string $op, $left, $right): ?string
{
  if ($left === null || $left === '' || $right === null || $right === '') {
    return null;
  }
  if (!is_numeric($left) || !is_numeric($right)) {
    return null;
  }
  $a = (float) $left;
  $b = (float) $right;
  $result = match ($op) {
    'add' => $a + $b,
    'subtract' => $a - $b,
    'multiply' => $a * $b,
    'divide' => $b == 0.0 ? null : $a / $b,
    default => null,
  };
  if ($result === null) {
    return null;
  }
  if (is_finite($result) === false) {
    return null;
  }
  // Trim trailing zeros for clean display.
  $formatted = rtrim(rtrim(sprintf('%.8F', $result), '0'), '.');
  return $formatted === '-0' ? '0' : $formatted;
}

/**
 * @param list<array> $fields
 * @param array<int,string|null> $answersByFieldId
 * @return array<int,string|null>
 */
function ll_tf_apply_calculated(array $fields, array $answersByFieldId): array
{
  $byId = [];
  foreach ($fields as $f) {
    $byId[(int) $f['id']] = $f;
  }
  // Multi-pass so calculated fields depending on other calculated fields resolve.
  for ($pass = 0; $pass < 8; $pass++) {
    $changed = false;
    foreach ($fields as $f) {
      if (($f['field_type'] ?? '') !== 'calculated') {
        continue;
      }
      $fid = (int) $f['id'];
      $leftId = (int) ($f['calc_left_field_id'] ?? 0);
      $rightId = (int) ($f['calc_right_field_id'] ?? 0);
      $op = (string) ($f['calc_op'] ?? '');
      $leftVal = $answersByFieldId[$leftId] ?? null;
      $rightVal = $answersByFieldId[$rightId] ?? null;
      if (($byId[$leftId]['field_type'] ?? '') === 'readonly') {
        $leftVal = $byId[$leftId]['readonly_value'] ?? $leftVal;
      }
      if (($byId[$rightId]['field_type'] ?? '') === 'readonly') {
        $rightVal = $byId[$rightId]['readonly_value'] ?? $rightVal;
      }
      $computed = ll_tf_eval_calc($op, $leftVal, $rightVal);
      $prev = $answersByFieldId[$fid] ?? null;
      if ($computed !== $prev) {
        $answersByFieldId[$fid] = $computed;
        $changed = true;
      }
    }
    if (!$changed) {
      break;
    }
  }
  return $answersByFieldId;
}

function ll_tf_row_department(array $row): array
{
  return [
    'id' => (int) $row['id'],
    'name' => (string) $row['name'],
    'description' => $row['description'] !== null ? (string) $row['description'] : null,
    'created_by' => $row['created_by'] !== null ? (int) $row['created_by'] : null,
    'created_at' => $row['created_at'] ?? null,
    'updated_at' => $row['updated_at'] ?? null,
  ];
}

function ll_tf_row_group(array $row): array
{
  return [
    'id' => (int) $row['id'],
    'department_id' => (int) $row['department_id'],
    'department_name' => isset($row['department_name']) ? (string) $row['department_name'] : null,
    'name' => (string) $row['name'],
    'description' => $row['description'] !== null ? (string) $row['description'] : null,
    'created_by' => $row['created_by'] !== null ? (int) $row['created_by'] : null,
    'created_at' => $row['created_at'] ?? null,
    'updated_at' => $row['updated_at'] ?? null,
  ];
}

function ll_tf_row_field(array $row): array
{
  $options = $row['options_json'] ?? null;
  if (is_string($options)) {
    $decoded = json_decode($options, true);
    $options = is_array($decoded) ? $decoded : [];
  } elseif (!is_array($options)) {
    $options = [];
  }
  return [
    'id' => (int) $row['id'],
    'form_id' => (int) $row['form_id'],
    'field_key' => (string) $row['field_key'],
    'label' => (string) $row['label'],
    'field_type' => (string) $row['field_type'],
    'options' => $options,
    'readonly_value' => $row['readonly_value'] !== null ? (string) $row['readonly_value'] : null,
    'calc_op' => $row['calc_op'] !== null ? (string) $row['calc_op'] : null,
    'calc_left_field_id' => $row['calc_left_field_id'] !== null ? (int) $row['calc_left_field_id'] : null,
    'calc_right_field_id' => $row['calc_right_field_id'] !== null ? (int) $row['calc_right_field_id'] : null,
    'required' => (int) ($row['required'] ?? 0) === 1,
    'sort_order' => (int) ($row['sort_order'] ?? 0),
  ];
}

function ll_tf_progress(array $fields, array $answersByFieldId): array
{
  $writable = 0;
  $filled = 0;
  foreach ($fields as $f) {
    $type = $f['field_type'] ?? '';
    if ($type === 'readonly' || $type === 'calculated') {
      continue;
    }
    $writable++;
    $val = $answersByFieldId[(int) $f['id']] ?? null;
    if ($val !== null && trim((string) $val) !== '') {
      $filled++;
    }
  }
  $pct = $writable > 0 ? (int) round(($filled / $writable) * 100) : 0;
  return ['filled' => $filled, 'total' => $writable, 'percent' => $pct];
}

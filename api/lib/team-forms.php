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

  ll_tf_ensure_form_tasks_open_assignee_unique($pdo);

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

/**
 * Existing installs: one open task per form+assignee (closed tasks may repeat).
 * Dedupes open duplicates then adds generated column + unique key when missing.
 */
function ll_tf_ensure_form_tasks_open_assignee_unique(PDO $pdo): void
{
  try {
    $hasCol = $pdo->query("SHOW COLUMNS FROM form_tasks LIKE 'open_assignee_guard'")->fetch();
    if ($hasCol) {
      return;
    }
    // Keep oldest open task; close newer duplicates so the unique key can apply.
    $pdo->exec(
      "UPDATE form_tasks t
       INNER JOIN (
         SELECT form_id, assignee_id, MIN(id) AS keep_id
         FROM form_tasks
         WHERE status <> 'closed'
         GROUP BY form_id, assignee_id
         HAVING COUNT(*) > 1
       ) d ON t.form_id = d.form_id AND t.assignee_id = d.assignee_id
         AND t.id <> d.keep_id AND t.status <> 'closed'
       SET t.status = 'closed', t.closed_at = UTC_TIMESTAMP()"
    );
    $pdo->exec(
      "ALTER TABLE form_tasks
       ADD COLUMN open_assignee_guard TINYINT UNSIGNED
         GENERATED ALWAYS AS (CASE WHEN status = 'closed' THEN NULL ELSE 1 END) STORED,
       ADD UNIQUE KEY uq_form_tasks_open_assignee (form_id, assignee_id, open_assignee_guard)"
    );
  } catch (Throwable $e) {
    // Older MySQL or concurrent migrate — assign path still enforces via SELECT.
  }
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

/** Allocate a unique, stable field_key for a form (label slug + short random suffix). */
function ll_tf_allocate_field_key(\PDO $pdo, int $formId, string $label, string $preferred = ''): string
{
  $base = $preferred !== '' ? ll_tf_slug_key($preferred) : ll_tf_slug_key($label);
  $chk = $pdo->prepare('SELECT id FROM form_fields WHERE form_id = ? AND field_key = ?');
  for ($i = 0; $i < 16; $i++) {
    $suffix = bin2hex(random_bytes(3));
    $key = substr($base, 0, 72) . '_' . $suffix;
    $key = substr($key, 0, 80);
    $chk->execute([$formId, $key]);
    if (!$chk->fetch()) {
      return $key;
    }
  }
  $fallback = 'f_' . bin2hex(random_bytes(8));
  $chk->execute([$formId, $fallback]);
  if (!$chk->fetch()) {
    return $fallback;
  }
  return 'f_' . bin2hex(random_bytes(10));
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

/**
 * Reviewers who can see this task on the review board (group or department scope).
 *
 * @return list<int>
 */
function ll_tf_reviewer_user_ids_for_task(array $task): array
{
  $scope = (string) ($task['reviewer_scope'] ?? 'group');
  $groupId = (int) ($task['group_id'] ?? 0);
  $deptId = (int) ($task['department_id'] ?? 0);
  $pdo = ll_pdo();
  if ($scope === 'department' && $deptId > 0) {
    $stmt = $pdo->prepare(
      'SELECT DISTINCT gm.user_id
       FROM group_members gm
       INNER JOIN org_groups g ON g.id = gm.group_id
       INNER JOIN users u ON u.id = gm.user_id
       WHERE gm.role = \'reviewer\' AND g.department_id = ? AND u.is_active = 1'
    );
    $stmt->execute([$deptId]);
  } else {
    $stmt = $pdo->prepare(
      'SELECT DISTINCT gm.user_id
       FROM group_members gm
       INNER JOIN users u ON u.id = gm.user_id
       WHERE gm.role = \'reviewer\' AND gm.group_id = ? AND u.is_active = 1'
    );
    $stmt->execute([$groupId]);
  }
  $ids = [];
  foreach ($stmt->fetchAll() as $row) {
    $ids[] = (int) $row['user_id'];
  }
  return $ids;
}

/**
 * In-app notifications when an assignee marks a task completed (submitted).
 * Recipients: scoped reviewers + form template creator. Never the assignee.
 */
function ll_tf_notify_task_completed(array $task, array $actor): void
{
  $assigneeId = (int) ($task['assignee_id'] ?? 0);
  $actorId = (int) ($actor['id'] ?? 0);
  $recipients = [];

  foreach (ll_tf_reviewer_user_ids_for_task($task) as $uid) {
    if ($uid > 0) {
      $recipients[$uid] = true;
    }
  }

  $createdBy = (int) ($task['form_created_by'] ?? 0);
  if ($createdBy > 0) {
    $creator = ll_find_user_by_id($createdBy);
    if ($creator && (int) ($creator['is_active'] ?? 0) === 1) {
      $recipients[$createdBy] = true;
    }
  }

  unset($recipients[$assigneeId], $recipients[$actorId]);
  if (!$recipients) {
    return;
  }

  $formTitle = trim((string) ($task['form_title'] ?? ''));
  if ($formTitle === '') {
    $formTitle = 'a team form';
  }
  $assigneeName = trim((string) ($task['assignee_name'] ?? ''));
  if ($assigneeName === '') {
    $assigneeName = 'An assignee';
  }
  $title = 'Team form completed';
  $body = $assigneeName . ' marked "' . $formTitle . '" completed';
  $meta = json_encode([
    'kind' => 'task_completed',
    'task_id' => (int) ($task['id'] ?? 0),
    'form_id' => (int) ($task['form_id'] ?? 0),
    'assignee_id' => $assigneeId,
  ], JSON_UNESCAPED_UNICODE);

  $ins = ll_pdo()->prepare(
    'INSERT INTO notifications (user_id, type, title, body, meta, is_read)
     VALUES (?, \'team_forms_task\', ?, ?, ?, 0)'
  );
  foreach (array_keys($recipients) as $uid) {
    $ins->execute([$uid, $title, $body, $meta]);
  }
}

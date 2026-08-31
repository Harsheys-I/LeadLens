<?php

declare(strict_types=1);

/** Permission catalog shown in Roles UI and enforced by API + frontend. */
function ll_permission_catalog(): array
{
  return [
    ['id' => 'module.telecaller_audit', 'label' => 'Module · LeadLens', 'group' => 'Modules'],
    ['id' => 'module.admin', 'label' => 'Module · Admin', 'group' => 'Modules'],
    ['id' => 'module.crm', 'label' => 'Module · CRM (coming soon)', 'group' => 'Modules'],
    ['id' => 'module.hr', 'label' => 'Module · HR (coming soon)', 'group' => 'Modules'],
    ['id' => 'admin.users', 'label' => 'Admin · Users', 'group' => 'Admin'],
    ['id' => 'admin.roles', 'label' => 'Admin · Roles', 'group' => 'Admin'],
    ['id' => 'admin.access_requests', 'label' => 'Admin · Access requests', 'group' => 'Admin'],
    ['id' => 'telecaller.bucket1', 'label' => 'LeadLens · Bucket 1 Followup Review', 'group' => 'LeadLens'],
    ['id' => 'telecaller.run_console', 'label' => 'LeadLens · Run console', 'group' => 'LeadLens'],
    ['id' => 'telecaller.dashboard', 'label' => 'LeadLens · Dashboard', 'group' => 'LeadLens'],
    ['id' => 'telecaller.upload_dashboard', 'label' => 'LeadLens · Upload Dashboard', 'group' => 'LeadLens'],
    ['id' => 'telecaller.history', 'label' => 'LeadLens · History', 'group' => 'LeadLens'],
    ['id' => 'telecaller.settings', 'label' => 'LeadLens · Settings', 'group' => 'LeadLens'],
    ['id' => 'telecaller.perf_report', 'label' => 'LeadLens · TeleCalling Performance', 'group' => 'LeadLens'],
    ['id' => 'telecaller.perf_dashboard', 'label' => 'LeadLens · Performance Dashboard', 'group' => 'LeadLens'],
    ['id' => 'telecaller.perf_upload', 'label' => 'LeadLens · Upload Performance Dashboard', 'group' => 'LeadLens'],
    ['id' => 'telecaller.perf_settings', 'label' => 'LeadLens · Performance Settings', 'group' => 'LeadLens'],
    ['id' => 'dashboards.view_all', 'label' => 'Dashboards · View all TeleCallers', 'group' => 'Dashboards'],
  ];
}

function ll_all_permission_ids(): array
{
  return array_column(ll_permission_catalog(), 'id');
}

function ll_default_role_permissions(string $key): array
{
  $all = ll_all_permission_ids();
  return match ($key) {
    'super' => $all,
    'admin' => array_values(array_diff($all, [
      'telecaller.run_console',
      'module.crm',
      'module.hr',
    ])),
    'telecaller' => [
      'module.telecaller_audit',
      'telecaller.dashboard',
      'telecaller.perf_dashboard',
    ],
    default => [],
  };
}

function ll_normalize_permissions($raw): array
{
  if (is_string($raw)) {
    $decoded = json_decode($raw, true);
    $raw = is_array($decoded) ? $decoded : [];
  }
  if (!is_array($raw)) {
    return [];
  }
  $allowed = array_flip(ll_all_permission_ids());
  $out = [];
  foreach ($raw as $perm) {
    $id = is_string($perm) ? trim($perm) : '';
    if ($id !== '' && isset($allowed[$id])) {
      $out[$id] = true;
    }
  }
  return array_keys($out);
}

function ll_user_has_permission(array $user, string $permission): bool
{
  if (!empty($user['is_super'])) {
    return true;
  }
  $perms = $user['permissions'] ?? [];
  if (!is_array($perms)) {
    $perms = ll_normalize_permissions($perms);
  }
  return in_array($permission, $perms, true);
}

function ll_user_rank(array $user): int
{
  return (int) ($user['role_rank'] ?? 0);
}

/** Admin-or-higher for User creation and Roles screens. */
function ll_is_admin_rank(array $user): bool
{
  return ll_user_rank($user) >= 50;
}

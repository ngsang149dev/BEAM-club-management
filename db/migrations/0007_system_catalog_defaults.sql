-- BEAM Club Management — System Catalog & Default Settings (E10-01)
-- Pure additive, idempotent migration for clean Production & Test databases.
-- Seeds ONLY canonical system metadata (18 permissions, 3 permission presets,
-- preset_permissions, and default reminders app_settings).
-- STRICTLY ZERO fake accounts, departments, boards, or tasks.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Canonical 18 Permissions (AGENTS.md Appendix A & src/lib/permissions.ts)
-- ---------------------------------------------------------------------------
INSERT INTO permissions (code, group_name, description, scopable)
VALUES
  ('member.view',         'members',     'View member directory (full names and departments)', false),
  ('member.view_detail',  'members',     'View sensitive member identifiers (student_id, email)', false),
  ('member.create',       'members',     'Create new member accounts', false),
  ('member.update',       'members',     'Update member profile details and department assignments', false),
  ('member.deactivate',   'members',     'Activate or deactivate member accounts', false),
  ('department.manage',   'departments', 'Create, rename, and delete departments', false),
  ('board.create',        'boards',      'Create new boards', false),
  ('board.update',        'boards',      'Edit boards and create, rename, reorder, or delete columns', false),
  ('board.delete',        'boards',      'Archive boards', false),
  ('task.create',         'tasks',       'Create tasks on boards', false),
  ('task.assign',         'tasks',       'Assign and unassign task members', false),
  ('task.update_any',     'tasks',       'Edit and move any visible task', false),
  ('task.update_assigned','tasks',       'Edit and move tasks assigned to the current user', false),
  ('task.delete',         'tasks',       'Soft-delete tasks and restore tasks from Trash', false),
  ('comment.create',      'comments',    'Post comments on visible tasks', false),
  ('comment.delete_any',  'comments',    'Delete comments authored by other members', false),
  ('reminder.configure',  'system',      'Configure deadline reminder milestones', false),
  ('audit.view',          'system',      'View administrative audit logs and permission history', false)
ON CONFLICT (code) DO UPDATE
SET
  group_name  = EXCLUDED.group_name,
  description = EXCLUDED.description,
  scopable    = EXCLUDED.scopable,
  updated_at  = now();

-- ---------------------------------------------------------------------------
-- 2. Canonical 3 Permission Presets (HANDOFF §3.5 & src/lib/permissions.ts)
-- ---------------------------------------------------------------------------
INSERT INTO permission_presets (id, code, name, description)
VALUES
  ('30000000-0000-4000-8000-000000000001', 'basic_member',    'Thành viên cơ bản', 'Default member permissions for viewing members, updating assigned tasks, and commenting'),
  ('30000000-0000-4000-8000-000000000002', 'department_lead', 'Trưởng ban',        'Basic member permissions plus member detail viewing, board management, and full task editing/assignment'),
  ('30000000-0000-4000-8000-000000000003', 'hr_manager',      'Quản lý nhân sự',   'Basic member permissions plus member detail viewing, creation, profile updates, and deactivation')
ON CONFLICT DO NOTHING;

UPDATE permission_presets AS p
SET
  name        = v.name,
  description = v.description,
  updated_at  = now()
FROM (
  VALUES
    ('basic_member',    'Thành viên cơ bản', 'Default member permissions for viewing members, updating assigned tasks, and commenting'),
    ('department_lead', 'Trưởng ban',        'Basic member permissions plus member detail viewing, board management, and full task editing/assignment'),
    ('hr_manager',      'Quản lý nhân sự',   'Basic member permissions plus member detail viewing, creation, profile updates, and deactivation')
) AS v(code, name, description)
WHERE p.code = v.code
  AND (p.name IS DISTINCT FROM v.name OR p.description IS DISTINCT FROM v.description);

INSERT INTO preset_permissions (preset_id, permission_code)
SELECT p.id, v.permission_code
FROM (
  VALUES
    -- basic_member (3)
    ('basic_member',    'member.view'),
    ('basic_member',    'task.update_assigned'),
    ('basic_member',    'comment.create'),
    -- department_lead (9)
    ('department_lead', 'member.view'),
    ('department_lead', 'task.update_assigned'),
    ('department_lead', 'comment.create'),
    ('department_lead', 'member.view_detail'),
    ('department_lead', 'board.create'),
    ('department_lead', 'board.update'),
    ('department_lead', 'task.create'),
    ('department_lead', 'task.assign'),
    ('department_lead', 'task.update_any'),
    -- hr_manager (7)
    ('hr_manager',      'member.view'),
    ('hr_manager',      'task.update_assigned'),
    ('hr_manager',      'comment.create'),
    ('hr_manager',      'member.view_detail'),
    ('hr_manager',      'member.create'),
    ('hr_manager',      'member.update'),
    ('hr_manager',      'member.deactivate')
) AS v(preset_code, permission_code)
JOIN permission_presets AS p ON p.code = v.preset_code
ON CONFLICT (preset_id, permission_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Default Deadline Reminder Settings (07:00 Asia/Ho_Chi_Minh, 2d/1d/overdue)
-- ---------------------------------------------------------------------------
INSERT INTO app_settings (key, value, updated_by)
VALUES ('reminders', '{"daysBefore":[2,1],"remindOverdue":true,"sendHourVn":7}'::jsonb, NULL)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Record Migration Version
-- ---------------------------------------------------------------------------
INSERT INTO schema_migrations (version)
VALUES ('0007_system_catalog_defaults')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- BEAM Club Management — Idempotent Development & Test Seed (Stage 0B / E0-02)
-- STRICTLY FAKE DEV/TEST DATA: No real student IDs (MSSV) or personal emails.
-- Safe to re-run repeatedly without errors or duplicate records.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Permissions Catalog (18 canonical permissions from AGENTS.md Appendix A)
-- ---------------------------------------------------------------------------
INSERT INTO permissions (code, group_name, description, scopable)
VALUES
  ('member.view',        'members',     'View member directory (full names and departments)', false),
  ('member.view_detail', 'members',     'View sensitive member identifiers (student_id, email)', false),
  ('member.create',      'members',     'Create new member accounts', false),
  ('member.update',      'members',     'Update member profile details and department assignments', false),
  ('member.deactivate',  'members',     'Activate or deactivate member accounts', false),
  ('department.manage',  'departments', 'Create, rename, and delete departments', false),
  ('board.create',       'boards',      'Create new boards', false),
  ('board.update',       'boards',      'Edit boards and create, rename, reorder, or delete columns', false),
  ('board.delete',       'boards',      'Archive boards', false),
  ('task.create',        'tasks',       'Create tasks on boards', false),
  ('task.assign',        'tasks',       'Assign and unassign task members', false),
  ('task.update_any',    'tasks',       'Edit and move any visible task', false),
  ('task.update_assigned','tasks',      'Edit and move tasks assigned to the current user', false),
  ('task.delete',        'tasks',       'Soft-delete tasks and restore tasks from Trash', false),
  ('comment.create',     'comments',    'Post comments on visible tasks', false),
  ('comment.delete_any', 'comments',    'Delete comments authored by other members', false),
  ('reminder.configure', 'system',      'Configure deadline reminder milestones', false),
  ('audit.view',         'system',      'View administrative audit logs and permission history', false)
ON CONFLICT (code) DO UPDATE
SET
  group_name  = EXCLUDED.group_name,
  description = EXCLUDED.description,
  scopable    = EXCLUDED.scopable;

-- ---------------------------------------------------------------------------
-- 2. Permission Presets (HANDOFF 3.5)
-- ---------------------------------------------------------------------------
INSERT INTO permission_presets (id, code, name, description)
VALUES
  ('30000000-0000-4000-8000-000000000001', 'basic_member',    'Thành viên cơ bản', 'Default member permissions for viewing members, updating assigned tasks, and commenting'),
  ('30000000-0000-4000-8000-000000000002', 'department_lead', 'Trưởng ban',        'Basic member permissions plus member detail viewing, board management, and full task editing/assignment'),
  ('30000000-0000-4000-8000-000000000003', 'hr_manager',      'Quản lý nhân sự',   'Basic member permissions plus member detail viewing, creation, profile updates, and deactivation')
ON CONFLICT (id) DO UPDATE
SET
  code        = EXCLUDED.code,
  name        = EXCLUDED.name,
  description = EXCLUDED.description;

INSERT INTO preset_permissions (preset_id, permission_code)
VALUES
  -- basic_member
  ('30000000-0000-4000-8000-000000000001', 'member.view'),
  ('30000000-0000-4000-8000-000000000001', 'task.update_assigned'),
  ('30000000-0000-4000-8000-000000000001', 'comment.create'),
  -- department_lead
  ('30000000-0000-4000-8000-000000000002', 'member.view'),
  ('30000000-0000-4000-8000-000000000002', 'task.update_assigned'),
  ('30000000-0000-4000-8000-000000000002', 'comment.create'),
  ('30000000-0000-4000-8000-000000000002', 'member.view_detail'),
  ('30000000-0000-4000-8000-000000000002', 'board.create'),
  ('30000000-0000-4000-8000-000000000002', 'board.update'),
  ('30000000-0000-4000-8000-000000000002', 'task.create'),
  ('30000000-0000-4000-8000-000000000002', 'task.assign'),
  ('30000000-0000-4000-8000-000000000002', 'task.update_any'),
  -- hr_manager
  ('30000000-0000-4000-8000-000000000003', 'member.view'),
  ('30000000-0000-4000-8000-000000000003', 'task.update_assigned'),
  ('30000000-0000-4000-8000-000000000003', 'comment.create'),
  ('30000000-0000-4000-8000-000000000003', 'member.view_detail'),
  ('30000000-0000-4000-8000-000000000003', 'member.create'),
  ('30000000-0000-4000-8000-000000000003', 'member.update'),
  ('30000000-0000-4000-8000-000000000003', 'member.deactivate')
ON CONFLICT (preset_id, permission_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Fake Dev/Test Profiles (2 active admins, 2 active members, 1 inactive)
-- ---------------------------------------------------------------------------
INSERT INTO profiles (id, student_id, email, full_name, is_admin, is_active, left_at, locale)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'MSSV-ADMIN-01', 'dev-admin-01@eiu.edu.vn',  'Admin One (Dev)',     true,  true,  NULL,                     'vi'),
  ('10000000-0000-4000-8000-000000000002', 'MSSV-ADMIN-02', 'dev-admin-02@eiu.edu.vn',  'Admin Two (Dev)',     true,  true,  NULL,                     'en'),
  ('10000000-0000-4000-8000-000000000003', 'MSSV-DEV-001',  'dev-member-01@eiu.edu.vn', 'Member Dev One',      false, true,  NULL,                     'vi'),
  ('10000000-0000-4000-8000-000000000004', 'MSSV-DEV-002',  'dev-member-02@eiu.edu.vn', 'Member Dev Two',      false, true,  NULL,                     'en'),
  ('10000000-0000-4000-8000-000000000005', 'MSSV-DEV-003',  'dev-member-03@eiu.edu.vn', 'Former Member (Dev)', false, false, '2026-09-01T00:00:00Z',   'vi')
ON CONFLICT (id) DO NOTHING;

-- Grant preset permissions to fake non-admin members for local testing
INSERT INTO user_permissions (user_id, permission_code, granted_by)
VALUES
  -- MSSV-DEV-001: department_lead
  ('10000000-0000-4000-8000-000000000003', 'member.view',          '10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000003', 'task.update_assigned', '10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000003', 'comment.create',       '10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000003', 'member.view_detail',   '10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000003', 'board.create',         '10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000003', 'board.update',         '10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000003', 'task.create',          '10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000003', 'task.assign',          '10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000003', 'task.update_any',      '10000000-0000-4000-8000-000000000001'),
  -- MSSV-DEV-002: basic_member
  ('10000000-0000-4000-8000-000000000004', 'member.view',          '10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000004', 'task.update_assigned', '10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000004', 'comment.create',       '10000000-0000-4000-8000-000000000001'),
  -- MSSV-DEV-003 (inactive): retained permissions row to verify is_active=false overrides grants
  ('10000000-0000-4000-8000-000000000005', 'member.view',          '10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000005', 'task.update_assigned', '10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000005', 'comment.create',       '10000000-0000-4000-8000-000000000001')
ON CONFLICT (user_id, permission_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. App Settings
-- ---------------------------------------------------------------------------
INSERT INTO app_settings (key, value, updated_by)
VALUES
  ('reminders', '{"daysBefore":[2,1],"remindOverdue":true,"sendHourVn":7}'::jsonb, '10000000-0000-4000-8000-000000000001')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Fake Departments & Multi-Department Membership
-- ---------------------------------------------------------------------------
INSERT INTO departments (id, name)
VALUES
  ('20000000-0000-4000-8000-000000000001', 'Ban Kỹ thuật (Sample)'),
  ('20000000-0000-4000-8000-000000000002', 'Ban Truyền thông (Sample)'),
  ('20000000-0000-4000-8000-000000000003', 'Ban Sự kiện (Sample)'),
  ('20000000-0000-4000-8000-000000000004', 'Ban Nhân sự (Sample)')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO member_departments (user_id, department_id)
VALUES
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004'),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000003'),
  ('10000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000003')
ON CONFLICT (user_id, department_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. Sample Board, 4 Columns, Tasks, Assignees, Comment & Initial Task Events
-- ---------------------------------------------------------------------------
INSERT INTO boards (id, name, department_id, created_by)
VALUES
  ('40000000-0000-4000-8000-000000000001', 'Sample Club Operations Board', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO columns (id, board_id, name, order_index)
VALUES
  ('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'Todo',   0),
  ('50000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001', 'Doing',  1),
  ('50000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000001', 'Review', 2),
  ('50000000-0000-4000-8000-000000000004', '40000000-0000-4000-8000-000000000001', 'Done',   3)
ON CONFLICT (id) DO NOTHING;

INSERT INTO tasks (id, board_id, column_id, title, description, due_at, priority, position, is_hidden, version, deleted_at, created_by)
VALUES
  -- Normal upcoming task (00:00 UTC+7, 2 days from current VN date)
  (
    '60000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'Prepare semester kickoff checklist',
    'Draft agenda and logistics items for the club kickoff meeting.',
    (date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') + interval '2 days') AT TIME ZONE 'Asia/Ho_Chi_Minh',
    2,
    1000,
    false,
    1,
    NULL,
    '10000000-0000-4000-8000-000000000001'
  ),
  -- Overdue task
  (
    '60000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000002',
    'Publish club event poster assets',
    'Finalize visual assets for social channels (sample overdue task).',
    '2026-01-14T17:00:00Z',
    4,
    1000,
    false,
    1,
    NULL,
    '10000000-0000-4000-8000-000000000003'
  ),
  -- Hidden task (visible only to creator Admin One, assignee Member Dev One, and admins)
  (
    '60000000-0000-4000-8000-000000000003',
    '40000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000003',
    'Internal leadership budget review (Hidden)',
    'Confidential internal planning task for hidden-task visibility testing.',
    (date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') + interval '1 day') AT TIME ZONE 'Asia/Ho_Chi_Minh',
    3,
    1000,
    true,
    1,
    NULL,
    '10000000-0000-4000-8000-000000000001'
  ),
  -- Done task assigned to inactive member (excluded from reminders)
  (
    '60000000-0000-4000-8000-000000000004',
    '40000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000004',
    'Archive previous semester inventory',
    'Completed handover item used to test Done column and inactive assignee display.',
    '2026-01-14T17:00:00Z',
    1,
    1000,
    false,
    1,
    NULL,
    '10000000-0000-4000-8000-000000000002'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO task_assignees (task_id, user_id)
VALUES
  ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003'),
  ('60000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003'),
  ('60000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000004'),
  ('60000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003'),
  ('60000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000005')
ON CONFLICT (task_id, user_id) DO NOTHING;

INSERT INTO comments (id, task_id, user_id, body)
VALUES
  (
    '70000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000003',
    'Sample kickoff comment: agenda draft is ready for review.'
  )
ON CONFLICT (id) DO NOTHING;

-- Initial append-only task_events (IDs and domain fields only; never store full names, MSSV, or emails)
INSERT INTO task_events (id, task_id, board_id, actor_id, type, changes, reverts_event_id, forced)
VALUES
  (
    '80000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'task.created',
    '{"column_id":"50000000-0000-4000-8000-000000000001","priority":2,"is_hidden":false,"assignee_ids":["10000000-0000-4000-8000-000000000003"]}'::jsonb,
    NULL,
    false
  ),
  (
    '80000000-0000-4000-8000-000000000002',
    '60000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000003',
    'task.created',
    '{"column_id":"50000000-0000-4000-8000-000000000002","priority":4,"is_hidden":false,"assignee_ids":["10000000-0000-4000-8000-000000000003","10000000-0000-4000-8000-000000000004"]}'::jsonb,
    NULL,
    false
  ),
  (
    '80000000-0000-4000-8000-000000000003',
    '60000000-0000-4000-8000-000000000003',
    '40000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'task.created',
    '{"column_id":"50000000-0000-4000-8000-000000000003","priority":3,"is_hidden":true,"assignee_ids":["10000000-0000-4000-8000-000000000003"]}'::jsonb,
    NULL,
    false
  ),
  (
    '80000000-0000-4000-8000-000000000004',
    '60000000-0000-4000-8000-000000000004',
    '40000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    'task.created',
    '{"column_id":"50000000-0000-4000-8000-000000000004","priority":1,"is_hidden":false,"assignee_ids":["10000000-0000-4000-8000-000000000005"]}'::jsonb,
    NULL,
    false
  ),
  (
    '80000000-0000-4000-8000-000000000005',
    '60000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000003',
    'comment.added',
    '{"comment_id":"70000000-0000-4000-8000-000000000001"}'::jsonb,
    NULL,
    false
  )
ON CONFLICT (id) DO NOTHING;

COMMIT;

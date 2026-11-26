-- BEAM Club Management — Department Leads, Calendar Tasks, Task Acceptance & Deliverables (CR-09)
-- Pure additive, re-runnable DDL.

BEGIN;

-- 1. Department Lead (zero automatic system permission grants; notification/grouping only)
ALTER TABLE departments
  ADD COLUMN IF NOT EXISTS lead_user_id uuid NULL REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS departments_lead_user_id_idx
  ON departments (lead_user_id)
  WHERE lead_user_id IS NOT NULL;

-- 2. Calendar Task Start Date & Independent Completion Tracking
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS start_at timestamptz NULL;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS is_completed boolean NOT NULL DEFAULT false;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS completed_at timestamptz NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_start_before_due_chk'
  ) THEN
    ALTER TABLE tasks
      ADD CONSTRAINT tasks_start_before_due_chk
      CHECK (start_at IS NULL OR due_at IS NULL OR start_at <= due_at);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS tasks_start_due_active_idx
  ON tasks (start_at, due_at)
  WHERE deleted_at IS NULL AND purged_at IS NULL;

-- 3. Assignee Task Acceptance Timestamp ("Đã nhận task")
ALTER TABLE task_assignees
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz NULL;

-- 4. Multi-Link Task Deliverables
CREATE TABLE IF NOT EXISTS task_deliverables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title text NOT NULL,
  url text NOT NULL,
  submitted_by uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_deliverables_title_chk
    CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
  CONSTRAINT task_deliverables_url_chk
    CHECK (char_length(url) BETWEEN 8 AND 2048 AND url ~* '^https?://')
);

CREATE INDEX IF NOT EXISTS task_deliverables_task_created_idx
  ON task_deliverables (task_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS task_deliverables_submitted_by_idx
  ON task_deliverables (submitted_by);

-- 5. Expand Notification Types for 3-Step Acceptance & Deliverable Reporting
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_chk;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_chk
  CHECK (
    type IN (
      'task.department_assigned',
      'task.assigned',
      'task.accepted',
      'task.deliverable_submitted'
    )
  );

INSERT INTO schema_migrations (version)
VALUES ('0008_calendar_tasks_leads_deliverables')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- BEAM Club Management — Department Task Assignment & Notifications (CR-03)
-- Pure additive, re-runnable DDL.
-- Adds task_departments and notifications with strict WQ-27 hidden-task
-- redaction semantics and non-cascading profile references.

BEGIN;

CREATE TABLE IF NOT EXISTS task_departments (
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, department_id)
);

CREATE INDEX IF NOT EXISTS task_departments_department_id_idx
  ON task_departments (department_id);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  type text NOT NULL,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  department_id uuid NULL REFERENCES departments(id) ON DELETE SET NULL,
  actor_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  is_hidden_task boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notifications_type_chk
    CHECK (type IN ('task.department_assigned', 'task.assigned'))
);

CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON notifications (user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS notifications_task_id_idx
  ON notifications (task_id);

CREATE INDEX IF NOT EXISTS notifications_actor_id_idx
  ON notifications (actor_id);

INSERT INTO schema_migrations (version)
VALUES ('0005_task_departments_and_notifications')
ON CONFLICT (version) DO NOTHING;

COMMIT;

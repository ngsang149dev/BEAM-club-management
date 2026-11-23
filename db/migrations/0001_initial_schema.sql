-- BEAM Club Management — Initial PostgreSQL 16 Schema (Stage 0B / E0-02)
-- Re-runnable, additive DDL. Timestamps stored as UTC timestamptz.
-- Email domain validation lives in server config (ALLOWED_EMAIL_DOMAIN), not SQL.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Migration tracking
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 1. Identity, Sessions, Login Attempts & App Settings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id text NOT NULL,
  email text NOT NULL,
  full_name text NOT NULL,
  is_admin boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  left_at timestamptz NULL,
  locale text NOT NULL DEFAULT 'vi',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_student_id_uq UNIQUE (student_id),
  CONSTRAINT profiles_locale_chk CHECK (locale IN ('vi', 'en'))
);

CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_lower_uq
  ON profiles (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  token_hash text NOT NULL,
  remember_me boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sessions_token_hash_uq UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx
  ON sessions (user_id);

CREATE INDEX IF NOT EXISTS sessions_expires_at_idx
  ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id text NOT NULL,
  ip text NOT NULL,
  success boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS login_attempts_ip_created_at_idx
  ON login_attempts (ip, created_at DESC);

CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by uuid NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 2. Departments & RBAC Permissions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT departments_name_uq UNIQUE (name)
);

CREATE UNIQUE INDEX IF NOT EXISTS departments_name_lower_uq
  ON departments (lower(btrim(name)));

CREATE TABLE IF NOT EXISTS member_departments (
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, department_id)
);

CREATE INDEX IF NOT EXISTS member_departments_department_id_idx
  ON member_departments (department_id);

CREATE TABLE IF NOT EXISTS permissions (
  code text PRIMARY KEY,
  group_name text NOT NULL,
  description text NOT NULL,
  scopable boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_permissions (
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  permission_code text NOT NULL REFERENCES permissions(code) ON DELETE RESTRICT,
  granted_by uuid NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  granted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission_code)
);

CREATE INDEX IF NOT EXISTS user_permissions_permission_code_idx
  ON user_permissions (permission_code);

CREATE TABLE IF NOT EXISTS permission_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  description text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT permission_presets_code_uq UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS preset_permissions (
  preset_id uuid NOT NULL REFERENCES permission_presets(id) ON DELETE CASCADE,
  permission_code text NOT NULL REFERENCES permissions(code) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (preset_id, permission_code)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  action text NOT NULL,
  target_user_id uuid NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx
  ON audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS audit_logs_target_user_id_created_at_idx
  ON audit_logs (target_user_id, created_at DESC)
  WHERE target_user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Boards, Columns, Tasks, Comments, Task Events & Reminders
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS boards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  department_id uuid NULL REFERENCES departments(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  archived_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS boards_department_id_idx
  ON boards (department_id)
  WHERE department_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS columns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name text NOT NULL,
  order_index integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS columns_board_id_order_index_idx
  ON columns (board_id, order_index);

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE RESTRICT,
  column_id uuid NULL REFERENCES columns(id) ON DELETE RESTRICT,
  title text NOT NULL,
  description text NULL,
  due_at timestamptz NULL,
  priority smallint NOT NULL DEFAULT 2,
  position numeric NOT NULL,
  is_hidden boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz NULL,
  created_by uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tasks_priority_chk CHECK (priority BETWEEN 1 AND 4),
  CONSTRAINT tasks_version_chk CHECK (version >= 1),
  -- Allow NULL column_id only when soft-deleted (supports WQ-33 when original column is deleted)
  CONSTRAINT tasks_active_column_not_null_chk CHECK (deleted_at IS NOT NULL OR column_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS tasks_board_column_position_active_idx
  ON tasks (board_id, column_id, position)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS tasks_due_at_active_idx
  ON tasks (due_at)
  WHERE deleted_at IS NULL AND due_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS tasks_board_deleted_at_idx
  ON tasks (board_id, deleted_at DESC)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS tasks_created_by_idx
  ON tasks (created_by);

CREATE TABLE IF NOT EXISTS task_assignees (
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, user_id)
);

CREATE INDEX IF NOT EXISTS task_assignees_user_id_idx
  ON task_assignees (user_id);

CREATE TABLE IF NOT EXISTS comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comments_task_id_created_at_idx
  ON comments (task_id, created_at);

CREATE TABLE IF NOT EXISTS task_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  type text NOT NULL,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  reverts_event_id uuid NULL REFERENCES task_events(id) ON DELETE RESTRICT,
  forced boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_events_task_id_created_at_idx
  ON task_events (task_id, created_at DESC);

CREATE INDEX IF NOT EXISTS task_events_reverts_event_id_idx
  ON task_events (reverts_event_id)
  WHERE reverts_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  kind text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reminders_task_user_kind_uq UNIQUE (task_id, user_id, kind)
);

-- ---------------------------------------------------------------------------
-- 4. Trigger Functions & Triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION prevent_student_id_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.student_id IS DISTINCT FROM OLD.student_id THEN
    RAISE EXCEPTION 'student_id is immutable after profile creation'
      USING HINT = 'STUDENT_ID_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

-- Drop legacy row-level guard if re-running on an older dev DB
DROP TRIGGER IF EXISTS prevent_last_active_admin_removal ON profiles;
DROP FUNCTION IF EXISTS prevent_last_active_admin_removal();

CREATE OR REPLACE FUNCTION prevent_last_active_admin_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM old_rows o
    JOIN new_rows n ON n.id = o.id
    WHERE (o.is_admin AND o.is_active)
      AND NOT (n.is_admin AND n.is_active)
  ) THEN
    PERFORM pg_advisory_xact_lock(hashtext('beam_active_admin_guard'));
    IF NOT EXISTS (
      SELECT 1
      FROM profiles
      WHERE is_admin = true
        AND is_active = true
    ) THEN
      RAISE EXCEPTION 'Cannot demote or deactivate the last active admin'
        USING HINT = 'LAST_ACTIVE_ADMIN';
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION prevent_last_active_admin_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM old_rows
    WHERE is_admin AND is_active
  ) THEN
    PERFORM pg_advisory_xact_lock(hashtext('beam_active_admin_guard'));
    IF NOT EXISTS (
      SELECT 1
      FROM profiles
      WHERE is_admin = true
        AND is_active = true
    ) THEN
      RAISE EXCEPTION 'Cannot delete the last active admin'
        USING HINT = 'LAST_ACTIVE_ADMIN';
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION prevent_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only; % is not permitted', TG_TABLE_NAME, TG_OP
    USING HINT = 'APPEND_ONLY_TABLE';
END;
$$;

-- Profiles invariants & updated_at
DROP TRIGGER IF EXISTS prevent_last_active_admin_update ON profiles;
CREATE TRIGGER prevent_last_active_admin_update
  AFTER UPDATE ON profiles
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION prevent_last_active_admin_update();

DROP TRIGGER IF EXISTS prevent_last_active_admin_delete ON profiles;
CREATE TRIGGER prevent_last_active_admin_delete
  AFTER DELETE ON profiles
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION prevent_last_active_admin_delete();

DROP TRIGGER IF EXISTS prevent_student_id_change ON profiles;
CREATE TRIGGER prevent_student_id_change
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION prevent_student_id_change();

DROP TRIGGER IF EXISTS set_updated_at ON profiles;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Mutable tables updated_at triggers
DROP TRIGGER IF EXISTS set_updated_at ON sessions;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON sessions
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON app_settings;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON app_settings
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON departments;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON departments
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON permissions;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON permissions
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON permission_presets;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON permission_presets
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON boards;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON boards
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON columns;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON columns
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON tasks;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Append-only protections
DROP TRIGGER IF EXISTS prevent_append_only_mutation ON task_events;
CREATE TRIGGER prevent_append_only_mutation
  BEFORE UPDATE OR DELETE OR TRUNCATE ON task_events
  FOR EACH STATEMENT
  EXECUTE FUNCTION prevent_append_only_mutation();

DROP TRIGGER IF EXISTS prevent_append_only_mutation ON audit_logs;
CREATE TRIGGER prevent_append_only_mutation
  BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_logs
  FOR EACH STATEMENT
  EXECUTE FUNCTION prevent_append_only_mutation();

-- ---------------------------------------------------------------------------
-- 5. Record Migration
-- ---------------------------------------------------------------------------
INSERT INTO schema_migrations (version)
VALUES ('0001_initial_schema')
ON CONFLICT (version) DO NOTHING;

COMMIT;

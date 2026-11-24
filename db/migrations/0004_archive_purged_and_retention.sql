-- BEAM Club Management — Unified Archive Center & Safe Purge (CR-04)
-- Pure additive, re-runnable DDL.
-- Adds purged_at to profiles/boards/tasks, guards against un-purging,
-- opens a one-way PII anonymization exception in prevent_student_id_change(),
-- and seeds default app_settings('archive_retention').

BEGIN;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS purged_at timestamptz NULL;

ALTER TABLE boards
  ADD COLUMN IF NOT EXISTS purged_at timestamptz NULL;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS purged_at timestamptz NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_purged_requires_inactive_chk'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_purged_requires_inactive_chk
      CHECK (purged_at IS NULL OR is_active = false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'boards_purged_requires_archived_chk'
  ) THEN
    ALTER TABLE boards
      ADD CONSTRAINT boards_purged_requires_archived_chk
      CHECK (purged_at IS NULL OR archived_at IS NOT NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_purged_requires_deleted_chk'
  ) THEN
    ALTER TABLE tasks
      ADD CONSTRAINT tasks_purged_requires_deleted_chk
      CHECK (purged_at IS NULL OR deleted_at IS NOT NULL);
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION prevent_student_id_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.purged_at IS NOT NULL AND NEW.purged_at IS NULL THEN
    RAISE EXCEPTION 'Purged profile cannot be restored'
      USING HINT = 'ALREADY_PURGED';
  END IF;

  IF NEW.student_id IS DISTINCT FROM OLD.student_id THEN
    IF OLD.purged_at IS NULL AND NEW.purged_at IS NOT NULL AND NEW.is_active = false THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'student_id is immutable after profile creation'
      USING HINT = 'STUDENT_ID_IMMUTABLE';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_student_id_change ON profiles;
CREATE TRIGGER prevent_student_id_change
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION prevent_student_id_change();

CREATE OR REPLACE FUNCTION prevent_entity_unpurge()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.purged_at IS NOT NULL AND NEW.purged_at IS NULL THEN
    RAISE EXCEPTION 'Purged record in % cannot be unpurged', TG_TABLE_NAME
      USING HINT = 'ALREADY_PURGED';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_entity_unpurge ON boards;
CREATE TRIGGER prevent_entity_unpurge
  BEFORE UPDATE ON boards
  FOR EACH ROW
  EXECUTE FUNCTION prevent_entity_unpurge();

DROP TRIGGER IF EXISTS prevent_entity_unpurge ON tasks;
CREATE TRIGGER prevent_entity_unpurge
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION prevent_entity_unpurge();

CREATE INDEX IF NOT EXISTS tasks_archive_deleted_at_idx
  ON tasks (deleted_at DESC, id DESC)
  WHERE deleted_at IS NOT NULL AND purged_at IS NULL;

CREATE INDEX IF NOT EXISTS boards_archive_archived_at_idx
  ON boards (archived_at DESC, id DESC)
  WHERE archived_at IS NOT NULL AND purged_at IS NULL;

CREATE INDEX IF NOT EXISTS profiles_archive_left_at_idx
  ON profiles (left_at DESC NULLS LAST, id DESC)
  WHERE is_active = false AND purged_at IS NULL;

INSERT INTO app_settings (key, value)
VALUES ('archive_retention', '{"retentionDays": null}'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO schema_migrations (version)
VALUES ('0004_archive_purged_and_retention')
ON CONFLICT (version) DO NOTHING;

COMMIT;

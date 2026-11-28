-- BEAM Club Management — Mandatory Task Start & Due Dates (CR-14 / A1)
-- Pure additive, re-runnable DDL.

BEGIN;

-- 1. Backfill existing rows before enforcing NOT NULL + start_at <= due_at
UPDATE tasks
SET start_at = LEAST(created_at, due_at)
WHERE start_at IS NULL AND due_at IS NOT NULL;

UPDATE tasks
SET due_at = GREATEST(created_at, start_at)
WHERE due_at IS NULL AND start_at IS NOT NULL;

UPDATE tasks
SET start_at = created_at,
    due_at = created_at
WHERE start_at IS NULL AND due_at IS NULL;

-- 2. Normalize NULL task dates strictly on BEFORE INSERT (never BEFORE UPDATE,
--    so explicit UPDATE tasks SET start_at = NULL still fails NOT NULL).
CREATE OR REPLACE FUNCTION normalize_task_dates_before_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.start_at IS NULL THEN
    NEW.start_at := LEAST(
      COALESCE(NEW.created_at, now()),
      COALESCE(NEW.due_at, COALESCE(NEW.created_at, now()))
    );
  END IF;

  IF NEW.due_at IS NULL THEN
    NEW.due_at := GREATEST(COALESCE(NEW.created_at, now()), NEW.start_at);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_normalize_dates_bi_trg ON tasks;
CREATE TRIGGER tasks_normalize_dates_bi_trg
  BEFORE INSERT ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION normalize_task_dates_before_insert();

-- 3. Require non-null start_at & due_at with default now() and start_at <= due_at
ALTER TABLE tasks
  ALTER COLUMN start_at SET DEFAULT now(),
  ALTER COLUMN start_at SET NOT NULL,
  ALTER COLUMN due_at SET DEFAULT now(),
  ALTER COLUMN due_at SET NOT NULL;

ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS tasks_start_before_due_chk;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_start_before_due_chk
  CHECK (start_at <= due_at);

DROP INDEX IF EXISTS tasks_due_at_active_idx;
CREATE INDEX IF NOT EXISTS tasks_due_at_active_idx
  ON tasks (due_at)
  WHERE deleted_at IS NULL;

INSERT INTO schema_migrations (version)
VALUES ('0009_require_task_dates')
ON CONFLICT (version) DO NOTHING;

COMMIT;

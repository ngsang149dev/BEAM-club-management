-- BEAM Club Management — Add Password Authentication Columns (CR-01)
-- Pure additive, re-runnable DDL. No secrets or passwords live in migrations.

BEGIN;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS password_hash text NULL;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

INSERT INTO schema_migrations (version)
VALUES ('0002_passwords')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- BEAM Club Management — Club Logo Assets & Member Avatars (CR-02)
-- Pure additive, re-runnable DDL enforcing <= 256 KB PNG/JPEG/WEBP (SVG disallowed).

BEGIN;

CREATE TABLE IF NOT EXISTS club_assets (
  key text PRIMARY KEY,
  mime_type text NOT NULL,
  data bytea NOT NULL,
  updated_by uuid NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT club_assets_mime_type_chk
    CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  CONSTRAINT club_assets_data_size_chk
    CHECK (octet_length(data) BETWEEN 1 AND 262144)
);

DROP TRIGGER IF EXISTS set_updated_at ON club_assets;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON club_assets
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS avatar_data bytea NULL;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS avatar_mime text NULL;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS avatar_updated_at timestamptz NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_avatar_mime_chk'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_avatar_mime_chk
      CHECK (
        avatar_mime IS NULL
        OR avatar_mime IN ('image/png', 'image/jpeg', 'image/webp')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_avatar_size_chk'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_avatar_size_chk
      CHECK (
        avatar_data IS NULL
        OR octet_length(avatar_data) BETWEEN 1 AND 262144
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_avatar_pair_chk'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_avatar_pair_chk
      CHECK (
        (avatar_data IS NULL AND avatar_mime IS NULL)
        OR (avatar_data IS NOT NULL AND avatar_mime IS NOT NULL)
      );
  END IF;
END
$$;

INSERT INTO schema_migrations (version)
VALUES ('0003_branding_and_avatars')
ON CONFLICT (version) DO NOTHING;

COMMIT;

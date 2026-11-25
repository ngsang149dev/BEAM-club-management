-- BEAM Club Management — Login Gallery Polaroid Items (CR-07)
-- Pure additive, re-runnable DDL enforcing <= 512 KB PNG/JPEG/WEBP (SVG disallowed).

BEGIN;

CREATE TABLE IF NOT EXISTS login_gallery_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  caption text NULL,
  mime_type text NOT NULL,
  data bytea NOT NULL,
  order_index integer NOT NULL,
  updated_by uuid NULL REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT login_gallery_items_title_chk
    CHECK (char_length(btrim(title)) BETWEEN 1 AND 80),
  CONSTRAINT login_gallery_items_caption_chk
    CHECK (caption IS NULL OR char_length(caption) <= 240),
  CONSTRAINT login_gallery_items_mime_type_chk
    CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  CONSTRAINT login_gallery_items_data_size_chk
    CHECK (octet_length(data) BETWEEN 1 AND 524288),
  CONSTRAINT login_gallery_items_order_index_chk
    CHECK (order_index >= 0)
);

DROP TRIGGER IF EXISTS set_updated_at ON login_gallery_items;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON login_gallery_items
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_login_gallery_items_order
  ON login_gallery_items (order_index, id);

INSERT INTO schema_migrations (version)
VALUES ('0006_login_gallery')
ON CONFLICT (version) DO NOTHING;

COMMIT;

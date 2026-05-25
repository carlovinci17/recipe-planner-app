-- Index of recipe titles extracted from Drive files.
-- One row per (household, Drive file). recipe_titles stores all recipe names
-- found inside the file so "Find by name" can search content, not just filenames.

CREATE TABLE drive_file_index (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id      uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  drive_file_id     text        NOT NULL,
  file_name         text        NOT NULL,
  folder_path       text        NOT NULL DEFAULT '',
  mime_type         text        NOT NULL,
  modified_time     timestamptz,
  index_status      text        NOT NULL DEFAULT 'pending',
  -- pending | indexing | done | failed
  recipe_titles     text[]      NOT NULL DEFAULT '{}',
  indexed_at        timestamptz,
  error             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, drive_file_id)
);

ALTER TABLE drive_file_index ENABLE ROW LEVEL SECURITY;

CREATE POLICY "household members can manage drive_file_index"
  ON drive_file_index FOR ALL
  USING (
    household_id IN (
      SELECT household_id FROM household_members WHERE user_id = auth.uid()
    )
  );

CREATE INDEX drive_file_index_household_status
  ON drive_file_index (household_id, index_status);

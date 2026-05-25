-- Add index_method column to track which extraction path was used per file.
-- Values: 'text', 'vision', 'text+vision', 'none'
ALTER TABLE public.drive_file_index
  ADD COLUMN IF NOT EXISTS index_method text;

-- Up-front page selection for PDF import.
--
-- When the user picks "2, 5-8, 13-15", `prepare` rasterizes ONLY those pages,
-- so `page_image_paths` holds 15 images rather than 300. That keeps every
-- downstream step (skim, selection, chunking, cover-picking) working on a
-- short document with no changes — but it loses the link back to the real
-- book page, and the skim picker shows the user "page 3" when they are
-- looking at page 14.
--
-- `page_numbers` restores that link: element i is the 1-based page of the
-- source PDF that produced `page_image_paths[i]`. Same order, same length.
--
-- NULL (and empty) means "no selection was made" — page i is simply page
-- i+1 — which is true for every row that already exists, so no backfill.

alter table public.ingestion_jobs
  add column if not exists page_numbers integer[];

comment on column public.ingestion_jobs.page_numbers is
  'Real 1-based source PDF page for each entry of page_image_paths, same order and length. NULL when the whole document was rasterized.';

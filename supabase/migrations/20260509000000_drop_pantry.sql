-- =====================================================================
-- Drop Pantry
-- =====================================================================
-- Pantry was a Phase 1 feature that we've cut. Drop the table, its
-- realtime publication entry, and any dependent policies. Idempotent.
-- =====================================================================

-- alter publication ... drop table doesn't support `if exists`, so wrap
-- in a do-block and swallow undefined_object errors.
do $$
begin
  alter publication supabase_realtime drop table public.pantry_items;
exception
  when undefined_object then null;
  when undefined_table then null;
end;
$$;

drop table if exists public.pantry_items cascade;

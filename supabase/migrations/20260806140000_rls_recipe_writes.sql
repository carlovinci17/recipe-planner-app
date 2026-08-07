-- ADR-002: bridge the recipes UPDATE and DELETE policies to app_uid(), so the
-- Drizzle-ported write methods (setFavorite, setRating, publish, archive, delete,
-- bulkDelete) run under RLS on a direct connection. The Supabase path still works
-- via the coalesce in app_uid().

drop policy if exists "recipes update by creator or owner" on public.recipes;
create policy "recipes update by creator or owner"
  on public.recipes for update
  using (
    created_by = public.app_uid()
    or public.is_household_owner(household_id, public.app_uid())
  )
  with check (
    created_by = public.app_uid()
    or public.is_household_owner(household_id, public.app_uid())
  );

drop policy if exists "recipes delete by creator or owner" on public.recipes;
create policy "recipes delete by creator or owner"
  on public.recipes for delete
  using (
    created_by = public.app_uid()
    or public.is_household_owner(household_id, public.app_uid())
  );

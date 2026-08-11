-- ADR-0005 / Module 4: bridge the recipes INSERT policy to app_uid() so
-- recipeService.createDraft (manual "New recipe") can insert on the Drizzle
-- connection under the Auth.js/Entra identity. app_uid() coalesces to auth.uid(),
-- so the Supabase path is unaffected.

drop policy if exists "recipes household write" on public.recipes;
create policy "recipes household write"
  on public.recipes for insert
  with check (public.is_household_member(household_id, public.app_uid()));

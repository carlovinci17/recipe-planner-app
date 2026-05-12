-- =====================================================================
-- Storage buckets and policies
-- =====================================================================
-- Two buckets:
--   recipe-uploads : raw uploads (PDFs, screenshots), private
--   recipe-images  : derived/cover images, private (served via signed URLs)
-- Path convention: <household_id>/<resource_id>/<filename>
-- The path-parsing helper lives in `public` (not `storage`) because the
-- migration role no longer has CREATE on the `storage` schema in Supabase
-- Cloud. Policies on storage.objects are still allowed.
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('recipe-uploads', 'recipe-uploads', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('recipe-images', 'recipe-images', false)
on conflict (id) do nothing;

-- Helper: extract the household_id segment of an object path
create or replace function public.storage_path_household_id(name text)
returns uuid
language sql
immutable
as $$
  select case
    when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(name, '/', 1)::uuid
    else null
  end;
$$;

-- recipe-uploads policies
create policy "uploads household read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'recipe-uploads'
    and public.is_household_member(public.storage_path_household_id(name), auth.uid())
  );

create policy "uploads household write"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'recipe-uploads'
    and public.is_household_member(public.storage_path_household_id(name), auth.uid())
  );

create policy "uploads household update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'recipe-uploads'
    and public.is_household_member(public.storage_path_household_id(name), auth.uid())
  );

create policy "uploads household delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'recipe-uploads'
    and public.is_household_member(public.storage_path_household_id(name), auth.uid())
  );

-- recipe-images policies
create policy "images household read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'recipe-images'
    and public.is_household_member(public.storage_path_household_id(name), auth.uid())
  );

create policy "images household write"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'recipe-images'
    and public.is_household_member(public.storage_path_household_id(name), auth.uid())
  );

create policy "images household update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'recipe-images'
    and public.is_household_member(public.storage_path_household_id(name), auth.uid())
  );

create policy "images household delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'recipe-images'
    and public.is_household_member(public.storage_path_household_id(name), auth.uid())
  );

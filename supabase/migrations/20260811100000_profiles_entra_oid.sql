-- Module 4 / ADR-0005: profiles becomes the identity root for Auth.js + Microsoft
-- Entra External ID. Two changes:
--   1. Add `entra_oid` — the link to the Entra object id (oid claim).
--   2. Let profiles be inserted independently of Supabase's `auth.users`: drop the
--      FK and give `id` its own default. The `handle_new_user` trigger (Supabase
--      path) still sets `id` explicitly, so the default only applies to
--      Auth.js-provisioned rows. Trigger is kept until cutover (Module 9).

alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.profiles alter column id set default gen_random_uuid();
alter table public.profiles add column if not exists entra_oid text;

create unique index if not exists profiles_entra_oid_key on public.profiles (entra_oid);

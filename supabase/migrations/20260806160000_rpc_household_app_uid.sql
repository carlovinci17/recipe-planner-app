-- ADR-002 / Lesson 3.4: bridge the household RPCs to app_uid() so create/accept
-- run on the Drizzle connection. Only the `auth.uid()` -> `public.app_uid()`
-- line changes in each; app_uid() coalesces to auth.uid() so the Supabase path
-- is unaffected.

create or replace function public.create_household_with_owner(_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := public.app_uid();
  _hid uuid;
begin
  if _uid is null then
    raise exception 'not authenticated';
  end if;

  insert into public.households (name, created_by)
  values (_name, _uid)
  returning id into _hid;

  insert into public.household_members (household_id, user_id, role)
  values (_hid, _uid, 'owner');

  return _hid;
end;
$$;

create or replace function public.accept_household_invite(_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := public.app_uid();
  _email citext;
  _invite public.household_invites;
begin
  if _uid is null then
    raise exception 'not authenticated';
  end if;

  select email into _email from public.profiles where id = _uid;

  select * into _invite
    from public.household_invites
   where token = _token
     and accepted_at is null
     and expires_at > now()
   for update;

  if _invite.id is null then
    raise exception 'invalid or expired invite';
  end if;

  if _invite.email <> _email then
    raise exception 'invite is for a different email';
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (_invite.household_id, _uid, _invite.role)
  on conflict do nothing;

  update public.household_invites
     set accepted_at = now()
   where id = _invite.id;

  return _invite.household_id;
end;
$$;

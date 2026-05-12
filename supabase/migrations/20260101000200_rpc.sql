-- =====================================================================
-- Stored procedures used by the app
-- =====================================================================

-- ---------------------------------------------------------------------
-- create_household_with_owner
-- Atomically creates a household and adds the creator as 'owner'.
-- Bypasses the (chicken-and-egg) RLS check on household_members.
-- ---------------------------------------------------------------------
create or replace function public.create_household_with_owner(_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
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

grant execute on function public.create_household_with_owner(text) to authenticated;

-- ---------------------------------------------------------------------
-- accept_household_invite(token)
-- Adds the calling user as a member of the household referenced by token.
-- ---------------------------------------------------------------------
create or replace function public.accept_household_invite(_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
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

grant execute on function public.accept_household_invite(text) to authenticated;

-- ---------------------------------------------------------------------
-- generate_shopping_list_from_planner(household_id, week_start)
-- Aggregates ingredients across the planner week into a new shopping list.
-- ---------------------------------------------------------------------
create or replace function public.generate_shopping_list_from_planner(
  _household_id uuid,
  _week_start date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _list_id uuid;
begin
  if not public.is_household_member(_household_id, _uid) then
    raise exception 'forbidden';
  end if;

  insert into public.shopping_lists (household_id, name, week_start, created_by)
  values (_household_id,
          'Week of ' || to_char(_week_start, 'Mon DD'),
          _week_start,
          _uid)
  returning id into _list_id;

  -- Aggregate ingredients across all planner entries for the week.
  -- Quantities are summed when unit matches; otherwise rows are kept distinct.
  with planned as (
    select pe.recipe_id, pe.servings, r.servings as recipe_servings
      from public.planner_entries pe
      join public.recipes r on r.id = pe.recipe_id
     where pe.household_id = _household_id
       and pe.date >= _week_start
       and pe.date < _week_start + interval '7 days'
       and pe.recipe_id is not null
  ),
  scaled as (
    select ri.ingredient,
           ri.unit,
           sum(
             ri.quantity *
             coalesce(p.servings::numeric / nullif(p.recipe_servings, 0)::numeric, 1)
           ) as quantity,
           array_agg(distinct p.recipe_id) as source_recipe_ids
      from planned p
      join public.recipe_ingredients ri on ri.recipe_id = p.recipe_id
     where ri.ingredient is not null
     group by ri.ingredient, ri.unit
  )
  insert into public.shopping_list_items (list_id, ingredient, quantity, unit, source_recipe_ids)
  select _list_id, ingredient, quantity, unit, source_recipe_ids
    from scaled;

  return _list_id;
end;
$$;

grant execute on function public.generate_shopping_list_from_planner(uuid, date) to authenticated;

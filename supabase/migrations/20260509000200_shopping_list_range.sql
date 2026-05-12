-- =====================================================================
-- Shopping list: arbitrary date range
-- =====================================================================
-- Replaces the week-only generator with one that takes (start_date, num_days),
-- so users can build lists for "next 3 days", "this weekend", etc.
-- The original 7-day RPC is kept as a thin wrapper for backwards compat.
-- =====================================================================

create or replace function public.generate_shopping_list_from_planner_range(
  _household_id uuid,
  _start_date date,
  _num_days int
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _list_id uuid;
  _label text;
begin
  if not public.is_household_member(_household_id, _uid) then
    raise exception 'forbidden';
  end if;

  if _num_days < 1 or _num_days > 31 then
    raise exception 'num_days must be between 1 and 31';
  end if;

  if _num_days = 1 then
    _label := to_char(_start_date, 'Mon DD');
  else
    _label := 'Shopping ' || to_char(_start_date, 'Mon DD')
              || '-' || to_char(_start_date + (_num_days - 1) * interval '1 day', 'Mon DD');
  end if;

  insert into public.shopping_lists (household_id, name, week_start, created_by)
  values (_household_id, _label, _start_date, _uid)
  returning id into _list_id;

  with planned as (
    select pe.recipe_id, pe.servings, r.servings as recipe_servings
      from public.planner_entries pe
      join public.recipes r on r.id = pe.recipe_id
     where pe.household_id = _household_id
       and pe.date >= _start_date
       and pe.date < _start_date + (_num_days * interval '1 day')
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

grant execute on function public.generate_shopping_list_from_planner_range(uuid, date, int)
  to authenticated;

-- Keep the old 7-day RPC as a thin wrapper so the planner page's existing
-- "Build shopping list" button keeps working without an immediate UI change.
create or replace function public.generate_shopping_list_from_planner(
  _household_id uuid,
  _week_start date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.generate_shopping_list_from_planner_range(_household_id, _week_start, 7);
end;
$$;

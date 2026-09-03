-- Harden browser access without changing the portal's existing role matrix.
-- API-server requests use the service role and continue to bypass these policies.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.current_profile_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(regexp_replace(p.role, '[\s_-]', '', 'g'))
  from public.profiles p
  where p.id = (select auth.uid())
    and p.is_active = true
  limit 1
$$;

revoke all on function private.current_profile_role() from public;
grant execute on function private.current_profile_role() to authenticated;

-- Remove the original blanket policies and the unsafe self-profile update.
do $$
declare
  policy_row record;
begin
  for policy_row in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and (
        policyname like 'auth_all_%'
        or policyname in ('profiles_select', 'profiles_update_own')
        or policyname like 'invendis_%'
      )
  loop
    execute format('drop policy if exists %I on public.%I', policy_row.policyname, policy_row.tablename);
  end loop;
end
$$;

-- A user may always read their own profile. Only active administrators may
-- enumerate profiles for the User Management page.
create policy invendis_profiles_read
on public.profiles for select
to authenticated
using (
  id = (select auth.uid())
  or (select private.current_profile_role()) = 'admin'
);

-- Active portal users retain the read access the current UI expects. Sensitive
-- write access is narrowed below to the same roles exposed by usePermissions().
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'districts', 'chiefdoms', 'sections', 'communities', 'value_chains',
    'warehouses', 'distribution_sites', 'farmers', 'input_items',
    'stock_ledger', 'stock_balance', 'procurement_orders', 'procurement_items',
    'campaigns', 'campaign_items', 'allocations', 'vehicles', 'drivers',
    'gps_track', 'dispatches', 'dispatch_items', 'pod', 'reconciliations',
    'audit_logs', 'users', 'incidents', 'otp_codes', 'system_settings'
  ]
  loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format(
        'create policy invendis_active_read on public.%I for select to authenticated using ((select private.current_profile_role()) is not null)',
        table_name
      );
    end if;
  end loop;
end
$$;

-- Create INSERT/UPDATE/DELETE policies for a table group and allowed roles.
do $$
declare
  table_name text;
  role_expression text;
begin
  -- Farmer registry and incident resolution.
  role_expression := '(select private.current_profile_role()) = any (array[''admin'',''projectmanager'',''districtcoordinator''])';
  foreach table_name in array array['farmers', 'allocations', 'incidents'] loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('create policy invendis_role_insert on public.%I for insert to authenticated with check (%s)', table_name, role_expression);
      execute format('create policy invendis_role_update on public.%I for update to authenticated using (%s) with check (%s)', table_name, role_expression, role_expression);
      execute format('create policy invendis_role_delete on public.%I for delete to authenticated using (%s)', table_name, role_expression);
    end if;
  end loop;

  -- Campaign management.
  role_expression := '(select private.current_profile_role()) = any (array[''admin'',''projectmanager''])';
  foreach table_name in array array['campaigns', 'campaign_items'] loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('create policy invendis_role_insert on public.%I for insert to authenticated with check (%s)', table_name, role_expression);
      execute format('create policy invendis_role_update on public.%I for update to authenticated using (%s) with check (%s)', table_name, role_expression, role_expression);
      execute format('create policy invendis_role_delete on public.%I for delete to authenticated using (%s)', table_name, role_expression);
    end if;
  end loop;

  -- Supply chain, fleet and distribution management.
  role_expression := '(select private.current_profile_role()) = any (array[''admin'',''projectmanager'',''warehousemanager''])';
  foreach table_name in array array[
    'input_items', 'stock_ledger', 'stock_balance', 'procurement_orders',
    'procurement_items', 'vehicles', 'drivers', 'dispatches', 'dispatch_items',
    'reconciliations'
  ] loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('create policy invendis_role_insert on public.%I for insert to authenticated with check (%s)', table_name, role_expression);
      execute format('create policy invendis_role_update on public.%I for update to authenticated using (%s) with check (%s)', table_name, role_expression, role_expression);
      execute format('create policy invendis_role_delete on public.%I for delete to authenticated using (%s)', table_name, role_expression);
    end if;
  end loop;

  -- PoD review is shared across management roles.
  role_expression := '(select private.current_profile_role()) = any (array[''admin'',''projectmanager'',''districtcoordinator'',''warehousemanager''])';
  if to_regclass('public.pod') is not null then
    execute format('create policy invendis_role_insert on public.pod for insert to authenticated with check (%s)', role_expression);
    execute format('create policy invendis_role_update on public.pod for update to authenticated using (%s) with check (%s)', role_expression, role_expression);
    execute format('create policy invendis_role_delete on public.pod for delete to authenticated using (%s)', role_expression);
  end if;

  -- Master data is managed by Admin and Project Manager roles.
  role_expression := '(select private.current_profile_role()) = any (array[''admin'',''projectmanager''])';
  foreach table_name in array array[
    'districts', 'chiefdoms', 'sections', 'communities', 'value_chains',
    'warehouses', 'distribution_sites', 'system_settings'
  ] loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('create policy invendis_role_insert on public.%I for insert to authenticated with check (%s)', table_name, role_expression);
      execute format('create policy invendis_role_update on public.%I for update to authenticated using (%s) with check (%s)', table_name, role_expression, role_expression);
      execute format('create policy invendis_role_delete on public.%I for delete to authenticated using (%s)', table_name, role_expression);
    end if;
  end loop;
end
$$;

-- Atomic inventory receipt. An advisory transaction lock serializes receipts
-- for the same warehouse/item pair without requiring a risky data cleanup or a
-- new uniqueness constraint on an existing production table.
create or replace function public.receive_stock_atomic(
  p_warehouse_id integer,
  p_input_item_id integer,
  p_quantity double precision,
  p_reference text default null,
  p_notes text default null
)
returns setof public.stock_ledger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  balance_id integer;
  ledger_row public.stock_ledger;
begin
  if not coalesce(
    (select private.current_profile_role()) = any (array['admin','projectmanager','warehousemanager']),
    false
  ) then
    raise exception 'Insufficient permissions' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be greater than zero' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(p_warehouse_id, p_input_item_id);

  select sb.id
  into balance_id
  from public.stock_balance sb
  where sb.warehouse_id = p_warehouse_id
    and sb.input_item_id = p_input_item_id
  order by sb.id
  limit 1
  for update;

  if balance_id is null then
    insert into public.stock_balance (warehouse_id, input_item_id, available)
    values (p_warehouse_id, p_input_item_id, p_quantity);
  else
    update public.stock_balance
    set available = available + p_quantity,
        updated_at = pg_catalog.now()
    where id = balance_id;
  end if;

  insert into public.stock_ledger (
    warehouse_id, input_item_id, txn_type, quantity, reference, notes
  ) values (
    p_warehouse_id, p_input_item_id, 'RECEIVE', p_quantity, p_reference, p_notes
  )
  returning * into ledger_row;

  return next ledger_row;
end
$$;

revoke all on function public.receive_stock_atomic(integer, integer, double precision, text, text) from public, anon;
grant execute on function public.receive_stock_atomic(integer, integer, double precision, text, text) to authenticated;

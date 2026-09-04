-- Harden web authorization, public card tokens, audit integrity, and stock mutations.
-- Apply to the Invendis Supabase project before removing API compatibility fallbacks.

BEGIN;

-- Older production databases predate the incident-management feature even
-- though the current API and web portal already expose it. Create the missing
-- table before grants, triggers, and policies reference it.
CREATE TABLE IF NOT EXISTS public.incidents (
  id               serial PRIMARY KEY,
  incident_code    text NOT NULL UNIQUE,
  type             text,
  title            text,
  description      text,
  dispatch_id      integer REFERENCES public.dispatches(id),
  field_officer_id integer REFERENCES public.users(id),
  reported_by      text,
  latitude         double precision,
  longitude        double precision,
  photo_url        text,
  status           text NOT NULL DEFAULT 'Open',
  resolution_notes text,
  resolved_by      integer REFERENCES public.users(id),
  resolved_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS incidents_status_idx ON public.incidents (status);
CREATE INDEX IF NOT EXISTS incidents_field_officer_idx ON public.incidents (field_officer_id);

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.invendis_has_role(allowed_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = (SELECT auth.uid())
      AND p.is_active IS TRUE
      AND lower(regexp_replace(p.role, '[\s_-]', '', 'g')) = ANY (allowed_roles)
  );
$$;
REVOKE ALL ON FUNCTION private.invendis_has_role(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.invendis_has_role(text[]) TO authenticated;

-- Stop safely rather than silently changing an already-printed duplicate card.
-- If this raises, run the preflight query supplied with the release and resolve
-- those farmers before applying the migration again.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.farmers
    WHERE barcode_token IS NOT NULL AND btrim(barcode_token) <> ''
    GROUP BY barcode_token HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate farmer barcode tokens exist; migration made no changes';
  END IF;
END $$;

-- Fill missing public card tokens before enforcing uniqueness. Existing tokens
-- are preserved so already-printed cards continue to work.
UPDATE public.farmers
SET barcode_token = 'BC-' || replace(gen_random_uuid()::text, '-', '')
WHERE barcode_token IS NULL
   OR btrim(barcode_token) = '';

CREATE UNIQUE INDEX IF NOT EXISTS farmers_barcode_token_unique_idx
  ON public.farmers (barcode_token)
  WHERE barcode_token IS NOT NULL;

ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS user_agent text;

-- Remove permissive policies, including historical auth_all_* policies.
DO $$
DECLARE policy_row record;
BEGIN
  FOR policy_row IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY (ARRAY[
        'profiles','districts','chiefdoms','sections','communities','value_chains',
        'warehouses','distribution_sites','farmers','input_items','stock_ledger',
        'stock_balance','procurement_orders','procurement_items','campaigns',
        'campaign_items','allocations','vehicles','drivers','gps_track','dispatches',
        'dispatch_items','pod','reconciliations','audit_logs','users','incidents',
        'otp_codes','system_settings'
      ])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', policy_row.policyname, policy_row.schemaname, policy_row.tablename);
  END LOOP;
END $$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'profiles','districts','chiefdoms','sections','communities','value_chains',
    'warehouses','distribution_sites','farmers','input_items','stock_ledger',
    'stock_balance','procurement_orders','procurement_items','campaigns',
    'campaign_items','allocations','vehicles','drivers','gps_track','dispatches',
    'dispatch_items','pod','reconciliations','audit_logs','users','incidents',
    'otp_codes','system_settings'
  ]
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    END IF;
  END LOOP;
END $$;

CREATE POLICY profiles_read ON public.profiles
FOR SELECT TO authenticated
USING (
  id = (SELECT auth.uid())
  OR private.invendis_has_role(ARRAY['admin'])
);

-- Active management users may read operational data. OTP secrets and audit
-- logs are deliberately excluded and receive narrower policies below.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'districts','chiefdoms','sections','communities','value_chains','warehouses',
    'distribution_sites','farmers','input_items','stock_ledger','stock_balance',
    'procurement_orders','procurement_items','campaigns','campaign_items',
    'allocations','vehicles','drivers','gps_track','dispatches','dispatch_items',
    'pod','reconciliations','users','incidents','system_settings'
  ]
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format(
        'CREATE POLICY management_read ON public.%I FOR SELECT TO authenticated USING (private.invendis_has_role(ARRAY[''admin'',''projectmanager'',''districtcoordinator'',''warehousemanager'',''viewer'']))',
        table_name
      );
    END IF;
  END LOOP;
END $$;

CREATE POLICY audit_read ON public.audit_logs
FOR SELECT TO authenticated
USING (private.invendis_has_role(ARRAY['admin','projectmanager']));

-- Each write policy mirrors the web route permissions. UPDATE policies use
-- both USING and WITH CHECK so a row cannot be changed into an unauthorized state.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['districts','chiefdoms','sections','communities','value_chains','distribution_sites','system_settings']
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('CREATE POLICY project_admin_write ON public.%I FOR ALL TO authenticated USING (private.invendis_has_role(ARRAY[''admin'',''projectmanager''])) WITH CHECK (private.invendis_has_role(ARRAY[''admin'',''projectmanager'']))', table_name);
    END IF;
  END LOOP;

  FOREACH table_name IN ARRAY ARRAY['farmers','allocations']
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('CREATE POLICY field_operations_write ON public.%I FOR ALL TO authenticated USING (private.invendis_has_role(ARRAY[''admin'',''projectmanager'',''districtcoordinator''])) WITH CHECK (private.invendis_has_role(ARRAY[''admin'',''projectmanager'',''districtcoordinator'']))', table_name);
    END IF;
  END LOOP;

  FOREACH table_name IN ARRAY ARRAY['campaigns','campaign_items']
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('CREATE POLICY campaign_write ON public.%I FOR ALL TO authenticated USING (private.invendis_has_role(ARRAY[''admin'',''projectmanager''])) WITH CHECK (private.invendis_has_role(ARRAY[''admin'',''projectmanager'']))', table_name);
    END IF;
  END LOOP;

  FOREACH table_name IN ARRAY ARRAY['warehouses','input_items','stock_ledger','stock_balance','procurement_orders','procurement_items','vehicles','drivers','dispatches','dispatch_items','reconciliations']
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('CREATE POLICY supply_chain_write ON public.%I FOR ALL TO authenticated USING (private.invendis_has_role(ARRAY[''admin'',''projectmanager'',''warehousemanager''])) WITH CHECK (private.invendis_has_role(ARRAY[''admin'',''projectmanager'',''warehousemanager'']))', table_name);
    END IF;
  END LOOP;

  FOREACH table_name IN ARRAY ARRAY['pod','incidents']
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('CREATE POLICY supervision_write ON public.%I FOR ALL TO authenticated USING (private.invendis_has_role(ARRAY[''admin'',''projectmanager'',''districtcoordinator'',''warehousemanager''])) WITH CHECK (private.invendis_has_role(ARRAY[''admin'',''projectmanager'',''districtcoordinator'',''warehousemanager'']))', table_name);
    END IF;
  END LOOP;
END $$;

-- Table privileges are a second boundary in addition to RLS.
REVOKE ALL ON public.profiles, public.districts, public.chiefdoms, public.sections,
  public.communities, public.value_chains, public.warehouses, public.distribution_sites,
  public.farmers, public.input_items, public.stock_ledger, public.stock_balance,
  public.procurement_orders, public.procurement_items, public.campaigns,
  public.campaign_items, public.allocations, public.vehicles, public.drivers,
  public.gps_track, public.dispatches, public.dispatch_items, public.pod,
  public.reconciliations, public.audit_logs, public.users, public.incidents,
  public.otp_codes, public.system_settings FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.profiles, public.districts, public.chiefdoms,
  public.sections, public.communities, public.value_chains, public.warehouses,
  public.distribution_sites, public.farmers, public.input_items, public.stock_ledger,
  public.stock_balance, public.procurement_orders, public.procurement_items,
  public.campaigns, public.campaign_items, public.allocations, public.vehicles,
  public.drivers, public.gps_track, public.dispatches, public.dispatch_items,
  public.pod, public.reconciliations, public.audit_logs, public.users,
  public.incidents, public.otp_codes, public.system_settings FROM authenticated;
GRANT SELECT ON public.profiles, public.districts, public.chiefdoms, public.sections,
  public.communities, public.value_chains, public.warehouses, public.distribution_sites,
  public.farmers, public.input_items, public.stock_ledger, public.stock_balance,
  public.procurement_orders, public.procurement_items, public.campaigns,
  public.campaign_items, public.allocations, public.vehicles, public.drivers,
  public.gps_track, public.dispatches, public.dispatch_items, public.pod,
  public.reconciliations, public.audit_logs, public.users, public.incidents,
  public.system_settings TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.districts, public.chiefdoms, public.sections,
  public.communities, public.value_chains, public.warehouses, public.distribution_sites,
  public.farmers, public.input_items, public.stock_ledger, public.stock_balance,
  public.procurement_orders, public.procurement_items, public.campaigns,
  public.campaign_items, public.allocations, public.vehicles, public.drivers,
  public.dispatches, public.dispatch_items, public.pod, public.reconciliations,
  public.incidents, public.system_settings TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Immutable, database-generated audit entries for browser-originated writes.
CREATE OR REPLACE FUNCTION private.audit_business_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE row_data jsonb;
BEGIN
  row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  INSERT INTO public.audit_logs (user_id, username, action, module, description, entity_type, entity_id, metadata)
  VALUES (
    NULL,
    COALESCE((SELECT auth.jwt() ->> 'email'), 'system'),
    TG_OP,
    TG_TABLE_NAME,
    format('%s on %s #%s', TG_OP, TG_TABLE_NAME, COALESCE(row_data ->> 'id', '?')),
    TG_TABLE_NAME,
    CASE WHEN row_data ->> 'id' ~ '^[0-9]+$' THEN (row_data ->> 'id')::integer ELSE NULL END,
    jsonb_build_object('source', 'database_trigger')::text
  );
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION private.audit_business_change() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'districts','chiefdoms','sections','communities','value_chains','warehouses',
    'distribution_sites','farmers','input_items','stock_ledger','stock_balance',
    'procurement_orders','procurement_items','campaigns','campaign_items',
    'allocations','vehicles','drivers','dispatches','dispatch_items','pod',
    'reconciliations','incidents','system_settings'
  ]
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS audit_business_change ON public.%I', table_name);
      EXECUTE format('CREATE TRIGGER audit_business_change AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.audit_business_change()', table_name);
    END IF;
  END LOOP;
END $$;

-- One short transaction protects each balance/ledger mutation. Advisory locks
-- serialize the rare case where a balance row does not exist yet.
CREATE OR REPLACE FUNCTION public.receive_stock_atomic(
  p_warehouse_id integer,
  p_input_item_id integer,
  p_quantity double precision,
  p_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE ledger_id integer;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'Quantity must be positive'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(p_warehouse_id, p_input_item_id);
  UPDATE public.stock_balance
  SET available = available + p_quantity, updated_at = now()
  WHERE warehouse_id = p_warehouse_id AND input_item_id = p_input_item_id;
  IF NOT FOUND THEN
    INSERT INTO public.stock_balance (warehouse_id, input_item_id, available)
    VALUES (p_warehouse_id, p_input_item_id, p_quantity);
  END IF;
  INSERT INTO public.stock_ledger (warehouse_id, input_item_id, txn_type, quantity, reference, notes)
  VALUES (p_warehouse_id, p_input_item_id, 'RECEIVE', p_quantity, p_reference, p_notes)
  RETURNING id INTO ledger_id;
  RETURN jsonb_build_object('ledger_id', ledger_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.transfer_stock_atomic(
  p_from_warehouse_id integer,
  p_to_warehouse_id integer,
  p_input_item_id integer,
  p_quantity double precision,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE source_id integer; source_available double precision; out_id integer; in_id integer;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'Quantity must be positive'; END IF;
  IF p_from_warehouse_id = p_to_warehouse_id THEN RAISE EXCEPTION 'Warehouses must differ'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(LEAST(p_from_warehouse_id, p_to_warehouse_id), p_input_item_id);
  PERFORM pg_catalog.pg_advisory_xact_lock(GREATEST(p_from_warehouse_id, p_to_warehouse_id), p_input_item_id);
  SELECT id, available INTO source_id, source_available
  FROM public.stock_balance
  WHERE warehouse_id = p_from_warehouse_id AND input_item_id = p_input_item_id
  FOR UPDATE;
  IF source_id IS NULL OR source_available < p_quantity THEN RAISE EXCEPTION 'Insufficient available stock'; END IF;
  UPDATE public.stock_balance SET available = available - p_quantity, updated_at = now() WHERE id = source_id;
  UPDATE public.stock_balance SET available = available + p_quantity, updated_at = now()
  WHERE warehouse_id = p_to_warehouse_id AND input_item_id = p_input_item_id;
  IF NOT FOUND THEN
    INSERT INTO public.stock_balance (warehouse_id, input_item_id, available)
    VALUES (p_to_warehouse_id, p_input_item_id, p_quantity);
  END IF;
  INSERT INTO public.stock_ledger (warehouse_id, input_item_id, txn_type, quantity, notes)
  VALUES (p_from_warehouse_id, p_input_item_id, 'TRANSFER_OUT', -p_quantity, p_notes) RETURNING id INTO out_id;
  INSERT INTO public.stock_ledger (warehouse_id, input_item_id, txn_type, quantity, notes)
  VALUES (p_to_warehouse_id, p_input_item_id, 'TRANSFER_IN', p_quantity, p_notes) RETURNING id INTO in_id;
  RETURN jsonb_build_object('out_ledger_id', out_id, 'in_ledger_id', in_id);
END;
$$;

REVOKE ALL ON FUNCTION public.receive_stock_atomic(integer, integer, double precision, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transfer_stock_atomic(integer, integer, integer, double precision, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receive_stock_atomic(integer, integer, double precision, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.transfer_stock_atomic(integer, integer, integer, double precision, text) TO service_role;

COMMIT;

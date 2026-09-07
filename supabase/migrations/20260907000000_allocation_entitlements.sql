-- Allocation entitlements.
--
-- Until now a campaign item carried a single flat number, quantity_per_farmer,
-- and every beneficiary was entitled to exactly that. Most beneficiaries are
-- farmer groups, so the flat number was wrong in two directions at once: a
-- tractor is one per group however large the group, while hoes and cutlasses
-- are one per member. Stock reservation multiplied the flat number by the
-- number of allocations, so a campaign serving fifty groups of twenty reserved
-- fifty hoes instead of a thousand.
--
-- The rate is now read against a basis, and the resulting per-beneficiary
-- entitlement is materialised into allocation_items. Reservation sums those
-- rows, delivery credits them, and an allocation only closes once every line
-- on the package is fulfilled.

-- ── Beneficiary shape ────────────────────────────────────────────────────────
-- The application has read these two columns since the bulk-import RPC landed,
-- but the tracked schema never declared them; a database built from schema.sql
-- alone would not have them.
ALTER TABLE public.farmers
  ADD COLUMN IF NOT EXISTS beneficiary_type text NOT NULL DEFAULT 'individual';
ALTER TABLE public.farmers
  ADD COLUMN IF NOT EXISTS group_size integer;

DO $$ BEGIN
  ALTER TABLE public.farmers ADD CONSTRAINT farmers_beneficiary_type_valid
    CHECK (beneficiary_type IN ('individual','group')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.farmers ADD CONSTRAINT farmers_group_size_positive
    CHECK (group_size IS NULL OR group_size > 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Basis on the campaign package line ───────────────────────────────────────
ALTER TABLE public.campaign_items
  ADD COLUMN IF NOT EXISTS basis text NOT NULL DEFAULT 'per_beneficiary';

DO $$ BEGIN
  ALTER TABLE public.campaign_items ADD CONSTRAINT campaign_items_basis_valid
    CHECK (basis IN ('per_beneficiary','per_member','per_hectare')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.campaign_items.quantity_per_farmer IS
  'Rate applied against basis: units per beneficiary, per group member, or per hectare.';
COMMENT ON COLUMN public.campaign_items.basis IS
  'per_beneficiary = one issue per farmer or group (a tractor, a power tiller); '
  'per_member = multiplied by group_size (hoes, cutlasses); '
  'per_hectare = multiplied by farm_size.';

-- Partial delivery is now a reachable state, so widen the status constraint
-- before anything can write it.
ALTER TABLE public.allocations DROP CONSTRAINT IF EXISTS allocations_status_valid;
ALTER TABLE public.allocations ADD CONSTRAINT allocations_status_valid
  CHECK (status IN ('Pending','Partially Delivered','Delivered','Cancelled')) NOT VALID;

-- ── Reusable package templates ───────────────────────────────────────────────
-- The same package recurs season after season for a given value chain or
-- intervention, so it is defined once and applied to a campaign.
CREATE TABLE IF NOT EXISTS public.campaign_item_templates (
  id             serial PRIMARY KEY,
  name           text NOT NULL,
  description    text,
  value_chain_id integer REFERENCES public.value_chains(id),
  is_active      integer NOT NULL DEFAULT 1,
  created_by     uuid REFERENCES public.profiles(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_item_templates_name_unique
  ON public.campaign_item_templates (lower(btrim(name)));

CREATE TABLE IF NOT EXISTS public.campaign_item_template_lines (
  id            serial PRIMARY KEY,
  template_id   integer NOT NULL REFERENCES public.campaign_item_templates(id) ON DELETE CASCADE,
  input_item_id integer NOT NULL REFERENCES public.input_items(id),
  quantity      double precision NOT NULL CHECK (quantity > 0),
  basis         text NOT NULL DEFAULT 'per_beneficiary'
                  CHECK (basis IN ('per_beneficiary','per_member','per_hectare')),
  UNIQUE (template_id, input_item_id)
);

-- ── Per-beneficiary entitlement ──────────────────────────────────────────────
-- One row per allocation per package line. quantity_entitled is derived from
-- the campaign item unless a coordinator has overridden it, in which case
-- re-materialising the campaign leaves the manual figure alone.
CREATE TABLE IF NOT EXISTS public.allocation_items (
  id                 bigserial PRIMARY KEY,
  allocation_id      integer NOT NULL REFERENCES public.allocations(id) ON DELETE CASCADE,
  input_item_id      integer NOT NULL REFERENCES public.input_items(id),
  basis              text NOT NULL DEFAULT 'per_beneficiary'
                       CHECK (basis IN ('per_beneficiary','per_member','per_hectare')),
  rate               double precision NOT NULL CHECK (rate > 0),
  quantity_entitled  double precision NOT NULL CHECK (quantity_entitled > 0),
  quantity_delivered double precision NOT NULL DEFAULT 0 CHECK (quantity_delivered >= 0),
  is_overridden      boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (allocation_id, input_item_id)
);
CREATE INDEX IF NOT EXISTS allocation_items_item_idx
  ON public.allocation_items (input_item_id);

-- ── Access control, matching the hardened tables ─────────────────────────────
DO $$
DECLARE t text; p record;
BEGIN
  FOREACH t IN ARRAY ARRAY['campaign_item_templates','campaign_item_template_lines','allocation_items'] LOOP
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, t);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY management_read ON public.%I FOR SELECT TO authenticated USING (private.invendis_has_role(ARRAY[''admin'',''projectmanager'',''districtcoordinator'',''warehousemanager'',''viewer'']))',
      t);
  END LOOP;
END $$;

-- Every mutation runs through the API server's validated routes, so browser
-- sessions get read access only.
REVOKE ALL ON public.campaign_item_templates, public.campaign_item_template_lines,
  public.allocation_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.campaign_item_templates, public.campaign_item_template_lines,
  public.allocation_items TO authenticated;
GRANT ALL ON public.campaign_item_templates, public.campaign_item_template_lines,
  public.allocation_items TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.campaign_item_templates_id_seq,
  public.campaign_item_template_lines_id_seq, public.allocation_items_id_seq TO service_role;

-- ── Entitlement arithmetic ───────────────────────────────────────────────────
-- Raises rather than silently returning zero: a beneficiary whose entitlement
-- cannot be computed must block approval, because stock that is never reserved
-- is stock the warehouse will not have on delivery day.
CREATE OR REPLACE FUNCTION public.allocation_entitlement(
  p_basis text,
  p_rate double precision,
  p_beneficiary_type text,
  p_group_size integer,
  p_farm_size double precision,
  p_label text
) RETURNS double precision
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v_members integer;
BEGIN
  IF p_rate IS NULL OR p_rate <= 0 THEN
    RAISE EXCEPTION 'Entitlement rate for % must be greater than zero', coalesce(p_label,'beneficiary')
      USING ERRCODE = '22023';
  END IF;

  IF p_basis = 'per_beneficiary' THEN
    RETURN p_rate;

  ELSIF p_basis = 'per_member' THEN
    v_members := CASE WHEN p_beneficiary_type = 'group' THEN p_group_size ELSE 1 END;
    IF v_members IS NULL OR v_members <= 0 THEN
      RAISE EXCEPTION
        'Beneficiary % is a group with no recorded group size, so a per-member entitlement cannot be calculated',
        coalesce(p_label,'(unknown)') USING ERRCODE = '22023';
    END IF;
    RETURN p_rate * v_members;

  ELSIF p_basis = 'per_hectare' THEN
    IF p_farm_size IS NULL OR p_farm_size <= 0 THEN
      RAISE EXCEPTION
        'Beneficiary % has no recorded farm size, so a per-hectare entitlement cannot be calculated',
        coalesce(p_label,'(unknown)') USING ERRCODE = '22023';
    END IF;
    RETURN p_rate * p_farm_size;
  END IF;

  RAISE EXCEPTION 'Unknown allocation basis %', coalesce(p_basis,'(null)') USING ERRCODE = '22023';
END $$;

GRANT EXECUTE ON FUNCTION
  public.allocation_entitlement(text, double precision, text, integer, double precision, text)
  TO authenticated, service_role;

-- ── Materialisation ──────────────────────────────────────────────────────────
-- Idempotent: safe to re-run whenever the package or the beneficiary list
-- changes. Manual overrides survive; lines for items dropped from the campaign
-- and lines belonging to cancelled allocations do not.
CREATE OR REPLACE FUNCTION public.materialize_allocation_items(p_campaign_id integer)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows integer;
BEGIN
  DELETE FROM allocation_items ai
  USING allocations a
  WHERE ai.allocation_id = a.id
    AND a.campaign_id = p_campaign_id
    AND (a.status = 'Cancelled'
         OR NOT EXISTS (
           SELECT 1 FROM campaign_items ci
           WHERE ci.campaign_id = p_campaign_id AND ci.input_item_id = ai.input_item_id));

  INSERT INTO allocation_items (allocation_id, input_item_id, basis, rate, quantity_entitled)
  SELECT a.id, ci.input_item_id, ci.basis, ci.quantity_per_farmer,
         public.allocation_entitlement(
           ci.basis, ci.quantity_per_farmer, f.beneficiary_type,
           f.group_size, f.farm_size, coalesce(f.farmer_group, f.farmer_code))
  FROM allocations a
  JOIN farmers f ON f.id = a.farmer_id
  JOIN campaign_items ci ON ci.campaign_id = a.campaign_id
  WHERE a.campaign_id = p_campaign_id AND a.status <> 'Cancelled'
  ON CONFLICT (allocation_id, input_item_id) DO UPDATE
    SET basis = excluded.basis,
        rate  = excluded.rate,
        quantity_entitled = CASE WHEN allocation_items.is_overridden
                                 THEN allocation_items.quantity_entitled
                                 ELSE excluded.quantity_entitled END,
        updated_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END $$;

REVOKE ALL ON FUNCTION public.materialize_allocation_items(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.materialize_allocation_items(integer) TO service_role;

-- ── Reservation follows the materialised entitlements ────────────────────────
-- Redeployed from 20260905005100. Two changes: entitlements are recomputed as
-- part of submission and approval, and the reservation reserves their sum
-- instead of quantity_per_farmer multiplied by the number of allocations.
CREATE OR REPLACE FUNCTION public.transition_campaign_atomic(
  p_campaign_id integer, p_target_status text, p_actor uuid DEFAULT NULL, p_reason text DEFAULT NULL
) RETURNS public.campaigns
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.campaigns%ROWTYPE; v_allocations integer; v_delivered integer;
DECLARE item record; v_available double precision; v_other_reserved double precision; v_required double precision;
BEGIN
  SELECT * INTO c FROM public.campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Campaign not found'; END IF;

  IF p_target_status = 'Submitted' AND c.status NOT IN ('Draft','Rejected') THEN
    RAISE EXCEPTION 'Only Draft or Rejected campaigns can be submitted';
  ELSIF p_target_status IN ('Approved','Rejected') AND c.status <> 'Submitted' THEN
    RAISE EXCEPTION 'Only Submitted campaigns can be approved or rejected';
  ELSIF p_target_status = 'Cancelled' AND c.status NOT IN ('Draft','Rejected','Submitted','Approved') THEN
    RAISE EXCEPTION 'This campaign cannot be cancelled from status %', c.status;
  ELSIF p_target_status = 'Completed' AND c.status NOT IN ('Approved','Active') THEN
    RAISE EXCEPTION 'Only Approved or Active campaigns can be completed';
  ELSIF p_target_status NOT IN ('Submitted','Approved','Rejected','Cancelled','Completed') THEN
    RAISE EXCEPTION 'Unsupported campaign transition';
  END IF;

  IF p_target_status IN ('Submitted','Approved') THEN
    IF nullif(btrim(c.name),'') IS NULL OR nullif(btrim(c.season),'') IS NULL OR
       c.district_id IS NULL OR c.value_chain_id IS NULL OR c.distribution_site_id IS NULL OR
       c.source_warehouse_id IS NULL OR c.start_date IS NULL OR c.end_date IS NULL OR c.end_date < c.start_date THEN
      RAISE EXCEPTION 'Campaign requires complete dates, season, district, value chain, destination and source warehouse';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.distribution_sites s WHERE s.id=c.distribution_site_id
      AND s.district_id=c.district_id AND s.is_active=1 AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL) THEN
      RAISE EXCEPTION 'Distribution site is inactive, outside the district, or missing GPS coordinates';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.campaign_items WHERE campaign_id=c.id) THEN
      RAISE EXCEPTION 'Campaign requires at least one item';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.allocations WHERE campaign_id=c.id AND status <> 'Cancelled') THEN
      RAISE EXCEPTION 'Campaign requires at least one farmer allocation';
    END IF;
    IF EXISTS (SELECT 1 FROM public.allocations a JOIN public.farmers f ON f.id=a.farmer_id
      WHERE a.campaign_id=c.id AND a.status <> 'Cancelled' AND
      (lower(f.status) <> 'approved' OR f.district_id IS DISTINCT FROM c.district_id OR
       (f.value_chain_id IS NOT NULL AND f.value_chain_id IS DISTINCT FROM c.value_chain_id))) THEN
      RAISE EXCEPTION 'All farmers must be approved and match the campaign district and value chain';
    END IF;
    -- Recompute every beneficiary's entitlement from the package rules so a
    -- reviewer sees, and stock is reserved against, the same figures.
    PERFORM public.materialize_allocation_items(c.id);
  END IF;

  IF p_target_status = 'Approved' THEN
    DELETE FROM public.campaign_stock_reservations WHERE campaign_id=c.id;
    FOR item IN
      SELECT ai.input_item_id, sum(ai.quantity_entitled) AS required
        FROM public.allocation_items ai
        JOIN public.allocations a ON a.id=ai.allocation_id
       WHERE a.campaign_id=c.id AND a.status <> 'Cancelled'
       GROUP BY ai.input_item_id
       ORDER BY ai.input_item_id
    LOOP
      v_required := item.required;
      SELECT available INTO v_available FROM public.stock_balance
       WHERE warehouse_id=c.source_warehouse_id AND input_item_id=item.input_item_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'No stock balance exists for campaign item %', item.input_item_id; END IF;
      SELECT coalesce(sum(r.reserved_quantity),0) INTO v_other_reserved
        FROM public.campaign_stock_reservations r JOIN public.campaigns rc ON rc.id=r.campaign_id
       WHERE r.warehouse_id=c.source_warehouse_id AND r.input_item_id=item.input_item_id
         AND r.campaign_id<>c.id AND rc.status IN ('Approved','Active');
      IF coalesce(v_available,0)-v_other_reserved < v_required THEN
        RAISE EXCEPTION 'Insufficient unreserved stock for item %: required %, available %',
          item.input_item_id, v_required, greatest(coalesce(v_available,0)-v_other_reserved,0);
      END IF;
      INSERT INTO public.campaign_stock_reservations(campaign_id,warehouse_id,input_item_id,reserved_quantity)
      VALUES(c.id,c.source_warehouse_id,item.input_item_id,v_required)
      ON CONFLICT(campaign_id,input_item_id) DO UPDATE SET reserved_quantity=excluded.reserved_quantity,updated_at=now();
    END LOOP;
  END IF;

  IF p_target_status = 'Completed' THEN
    SELECT count(*) FILTER (WHERE status<>'Cancelled'), count(*) FILTER (WHERE status='Delivered')
      INTO v_allocations,v_delivered FROM public.allocations WHERE campaign_id=c.id;
    IF v_allocations=0 OR v_allocations<>v_delivered THEN
      RAISE EXCEPTION 'Campaign can only complete after every active allocation has verified PoD';
    END IF;
  END IF;
  IF p_target_status = 'Rejected' AND nullif(btrim(p_reason),'') IS NULL THEN
    RAISE EXCEPTION 'A rejection reason is required';
  END IF;
  IF p_target_status = 'Cancelled' AND EXISTS (
    SELECT 1 FROM public.dispatches WHERE campaign_id=c.id AND status NOT IN ('Draft','Pending','Cancelled')
  ) THEN RAISE EXCEPTION 'Campaign with an active dispatch cannot be cancelled'; END IF;

  UPDATE public.campaigns SET status=p_target_status,
    approved_by=CASE WHEN p_target_status='Approved' THEN p_actor ELSE approved_by END,
    approved_at=CASE WHEN p_target_status='Approved' THEN now() ELSE approved_at END,
    rejection_reason=CASE WHEN p_target_status='Rejected' THEN p_reason ELSE rejection_reason END,
    cancelled_at=CASE WHEN p_target_status='Cancelled' THEN now() ELSE cancelled_at END,
    completed_at=CASE WHEN p_target_status='Completed' THEN now() ELSE completed_at END,
    updated_at=now() WHERE id=c.id RETURNING * INTO c;
  IF p_target_status IN ('Rejected','Cancelled','Completed') THEN
    DELETE FROM public.campaign_stock_reservations WHERE campaign_id=c.id;
  END IF;
  RETURN c;
END $$;
REVOKE ALL ON FUNCTION public.transition_campaign_atomic(integer,text,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_campaign_atomic(integer,text,uuid,text) TO service_role;

-- ── Delivery credits the entitlement lines ───────────────────────────────────
-- Redeployed from 20260905003100. Previously the first approved PoD marked the
-- whole allocation Delivered even when only one item of the package had been
-- handed over, which let a campaign auto-complete on partial distribution.
--
-- 20260905004200 renamed that accounting body to approve_pods_atomic_unchecked
-- and put a wrapper of the same name in front of it that rejects an inactive or
-- unprivileged approver and duplicate-flagged PoDs. The accounting body is what
-- changes here; replacing the wrapper instead would silently drop those checks.
CREATE OR REPLACE FUNCTION public.approve_pods_atomic_unchecked(
  p_pod_ids jsonb,
  p_approved_by integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids integer[];
  v_requested_count integer;
  v_pod record;
  v_delivery record;
  v_dispatch_item record;
  v_campaign_id integer;
  v_dispatch_id integer;
  v_dispatch_status text;
  v_credit record;
  v_entitled double precision;
  v_already double precision;
BEGIN
  IF jsonb_typeof(p_pod_ids) <> 'array' OR jsonb_array_length(p_pod_ids) = 0 THEN
    RAISE EXCEPTION 'pod IDs must be a non-empty array' USING ERRCODE = '22023';
  END IF;

  SELECT count(*), array_agg(DISTINCT value::integer ORDER BY value::integer)
  INTO v_requested_count, v_ids
  FROM jsonb_array_elements_text(p_pod_ids);
  IF cardinality(v_ids) <> v_requested_count THEN
    RAISE EXCEPTION 'duplicate pod IDs are not allowed' USING ERRCODE = '22023';
  END IF;

  -- Require every requested row to exist and still be Pending while locked.
  FOR v_pod IN
    SELECT id, status
    FROM pod
    WHERE id = ANY(v_ids)
    ORDER BY id
    FOR UPDATE
  LOOP
    IF v_pod.status <> 'Pending' THEN
      RAISE EXCEPTION 'PoD % has already been processed (status: %)', v_pod.id, v_pod.status
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pod WHERE id = ANY(v_ids)) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'one or more PoDs do not exist' USING ERRCODE = 'P0002';
  END IF;

  -- Follow the lifecycle lock order used by start_dispatch_atomic: linked
  -- dispatch rows first, then dispatch_items, then stock balances. Non-dispatch
  -- PoDs intentionally skip this validation.
  FOR v_dispatch_id, v_dispatch_status IN
    SELECT d.id, d.status
    FROM dispatches d
    WHERE d.id IN (
      SELECT DISTINCT dispatch_id FROM pod WHERE id = ANY(v_ids) AND dispatch_id IS NOT NULL
    )
    ORDER BY d.id
    FOR UPDATE
  LOOP
    IF v_dispatch_status NOT IN ('In Transit', 'Arrived') THEN
      RAISE EXCEPTION 'dispatch % cannot approve deliveries from status %',v_dispatch_id,v_dispatch_status
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  -- Serialize accounting for all affected manifest rows in deterministic order.
  PERFORM di.id
  FROM dispatch_items di
  WHERE di.dispatch_id IN (
    SELECT DISTINCT dispatch_id FROM pod WHERE id = ANY(v_ids) AND dispatch_id IS NOT NULL
  )
  ORDER BY di.dispatch_id, di.id
  FOR UPDATE;

  -- Aggregate multi-item rows, falling back to the legacy fields only when a
  -- PoD has no pod_items rows.
  FOR v_delivery IN
    SELECT p.dispatch_id, delivered.input_item_id, sum(delivered.quantity_delivered) AS quantity
    FROM pod p
    CROSS JOIN LATERAL (
      SELECT pi.input_item_id, pi.quantity_delivered
      FROM pod_items pi
      WHERE pi.pod_id = p.id
      UNION ALL
      SELECT p.input_item_id, p.quantity_delivered
      WHERE p.input_item_id IS NOT NULL
        AND p.quantity_delivered IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM pod_items pi WHERE pi.pod_id = p.id)
    ) delivered
    WHERE p.id = ANY(v_ids) AND p.dispatch_id IS NOT NULL
    GROUP BY p.dispatch_id, delivered.input_item_id
    ORDER BY p.dispatch_id, delivered.input_item_id
  LOOP
    IF v_delivery.input_item_id IS NULL OR v_delivery.quantity IS NULL
       OR v_delivery.quantity <= 0
       OR v_delivery.quantity IN ('Infinity'::float8, '-Infinity'::float8, 'NaN'::float8) THEN
      RAISE EXCEPTION 'PoD delivery quantities must be positive and finite' USING ERRCODE = '22023';
    END IF;

    SELECT id, quantity_loaded, COALESCE(quantity_delivered, 0) AS quantity_delivered
    INTO v_dispatch_item
    FROM dispatch_items
    WHERE dispatch_id = v_delivery.dispatch_id
      AND input_item_id = v_delivery.input_item_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'item % is not on dispatch %', v_delivery.input_item_id, v_delivery.dispatch_id
        USING ERRCODE = '23503';
    END IF;
    IF v_dispatch_item.quantity_delivered + v_delivery.quantity > v_dispatch_item.quantity_loaded THEN
      RAISE EXCEPTION 'approval quantity for item % exceeds loaded quantity on dispatch %',
        v_delivery.input_item_id, v_delivery.dispatch_id USING ERRCODE = '22023';
    END IF;

    UPDATE dispatch_items
    SET quantity_delivered = v_dispatch_item.quantity_delivered + v_delivery.quantity
    WHERE id = v_dispatch_item.id;

    -- Keep warehouse movement counters in the same approval transaction.
    UPDATE stock_balance sb
    SET loaded = GREATEST(0, COALESCE(sb.loaded, 0) - v_delivery.quantity),
        delivered = COALESCE(sb.delivered, 0) + v_delivery.quantity,
        updated_at = now()
    FROM dispatches d
    WHERE d.id = v_delivery.dispatch_id
      AND sb.warehouse_id = d.warehouse_id
      AND sb.input_item_id = v_delivery.input_item_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stock balance is missing for item % on dispatch %',
        v_delivery.input_item_id, v_delivery.dispatch_id USING ERRCODE = '23503';
    END IF;
  END LOOP;

  UPDATE pod
  SET status = 'Verified', approved_by = p_approved_by, approved_at = now()
  WHERE id = ANY(v_ids);

  -- Credit what was actually handed over against each entitlement line. The
  -- lateral mirrors the dispatch accounting above so a PoD without pod_items
  -- rows still contributes its legacy single-item quantity.
  FOR v_credit IN
    SELECT a.id AS allocation_id, delivered.input_item_id,
           sum(delivered.quantity_delivered) AS quantity
    FROM pod p
    JOIN allocations a
      ON a.farmer_id = p.farmer_id AND a.campaign_id = p.campaign_id
    CROSS JOIN LATERAL (
      SELECT pi.input_item_id, pi.quantity_delivered
      FROM pod_items pi
      WHERE pi.pod_id = p.id
      UNION ALL
      SELECT p.input_item_id, p.quantity_delivered
      WHERE p.input_item_id IS NOT NULL
        AND p.quantity_delivered IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM pod_items pi WHERE pi.pod_id = p.id)
    ) delivered
    WHERE p.id = ANY(v_ids)
      AND p.campaign_id IS NOT NULL
      AND delivered.input_item_id IS NOT NULL
      AND delivered.quantity_delivered IS NOT NULL
    GROUP BY a.id, delivered.input_item_id
    ORDER BY a.id, delivered.input_item_id
  LOOP
    -- Refuse to credit more than the beneficiary is owed. Dispatch accounting
    -- only caps a delivery at what the truck carried, which says nothing about
    -- how much of it belonged to this beneficiary. The epsilon tolerates float
    -- error on fractional quantities without tolerating a real overage.
    SELECT quantity_entitled, COALESCE(quantity_delivered, 0)
      INTO v_entitled, v_already
      FROM allocation_items
     WHERE allocation_id = v_credit.allocation_id
       AND input_item_id = v_credit.input_item_id
     FOR UPDATE;
    IF FOUND AND v_already + v_credit.quantity > v_entitled + 1e-9 THEN
      RAISE EXCEPTION
        'Delivery of % for item % exceeds the beneficiary entitlement of % (already delivered %)',
        v_credit.quantity, v_credit.input_item_id, v_entitled, v_already
        USING ERRCODE = '22023';
    END IF;

    UPDATE allocation_items
    SET quantity_delivered = COALESCE(quantity_delivered, 0) + v_credit.quantity,
        updated_at = now()
    WHERE allocation_id = v_credit.allocation_id
      AND input_item_id = v_credit.input_item_id;
  END LOOP;

  -- An allocation closes only once every line on its package is fulfilled.
  -- Allocations with no materialised lines predate entitlement tracking, so
  -- they keep the old behaviour of closing on the first approved PoD. The
  -- epsilon absorbs float error on fractional quantities such as fertiliser.
  UPDATE allocations a
  SET status = CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM allocation_items ai WHERE ai.allocation_id = a.id
        ) THEN 'Delivered'
        WHEN EXISTS (
          SELECT 1 FROM allocation_items ai
          WHERE ai.allocation_id = a.id
            AND COALESCE(ai.quantity_delivered, 0) < ai.quantity_entitled - 1e-9
        ) THEN 'Partially Delivered'
        ELSE 'Delivered'
      END,
      updated_at = now()
  FROM (
    SELECT DISTINCT farmer_id, campaign_id
    FROM pod
    WHERE id = ANY(v_ids)
  ) approved
  WHERE a.farmer_id = approved.farmer_id
    AND a.campaign_id = approved.campaign_id
    AND a.status NOT IN ('Delivered', 'Cancelled');

  FOR v_campaign_id IN
    SELECT DISTINCT campaign_id FROM pod WHERE id = ANY(v_ids) AND campaign_id IS NOT NULL ORDER BY campaign_id
  LOOP
    UPDATE campaigns
    SET delivered_count = (
      SELECT count(*) FROM allocations
      WHERE campaign_id = v_campaign_id AND status = 'Delivered'
    )
    WHERE id = v_campaign_id;
  END LOOP;

  FOR v_dispatch_id IN
    SELECT DISTINCT dispatch_id FROM pod WHERE id = ANY(v_ids) AND dispatch_id IS NOT NULL ORDER BY dispatch_id
  LOOP
    UPDATE dispatches
    SET delivered_packages = round((
      SELECT COALESCE(sum(quantity_delivered), 0)
      FROM dispatch_items
      WHERE dispatch_id = v_dispatch_id
    ))::integer,
    updated_at = now()
    WHERE id = v_dispatch_id;
  END LOOP;

  RETURN cardinality(v_ids);
END;
$$;

-- The implementation stays reachable only through the guarded wrapper.
REVOKE ALL ON FUNCTION public.approve_pods_atomic_unchecked(jsonb, integer)
  FROM PUBLIC, anon, authenticated, service_role;

-- ── Follow-up deliveries ─────────────────────────────────────────────────────
-- pod_one_active_delivery_per_farmer_campaign counted 'Verified' rows, so a
-- beneficiary could receive exactly one delivery per campaign, ever. That was
-- survivable while the first approved PoD closed the allocation outright; now
-- that a short delivery leaves the allocation open, it would strand it with no
-- way to deliver the balance. A tractor and its fertiliser rarely travel on the
-- same truck, so split deliveries are a real requirement.
--
-- The rule becomes: one OPEN delivery at a time, and a follow-up only while
-- something on the package is still owed. Double submission is still blocked by
-- pod_submission_key_unique, and over-delivery by the trigger below, so this is
-- narrower than it looks.
DROP INDEX IF EXISTS public.pod_one_active_delivery_per_farmer_campaign;
CREATE UNIQUE INDEX IF NOT EXISTS pod_one_open_delivery_per_farmer_campaign
  ON public.pod (farmer_id, campaign_id)
  WHERE farmer_id IS NOT NULL AND campaign_id IS NOT NULL
    AND status IN ('Pending', 'Exception') AND COALESCE(duplicate_flag, false) = false;

CREATE OR REPLACE FUNCTION public.reject_delivery_when_entitlement_met()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_alloc integer;
BEGIN
  IF NEW.farmer_id IS NULL OR NEW.campaign_id IS NULL OR COALESCE(NEW.duplicate_flag, false) THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_alloc FROM allocations
   WHERE campaign_id = NEW.campaign_id AND farmer_id = NEW.farmer_id AND status <> 'Cancelled'
   LIMIT 1;
  IF v_alloc IS NULL THEN RETURN NEW; END IF;

  -- Campaigns that predate entitlement tracking have no materialised lines, so
  -- they keep the historical rule of a single verified delivery.
  IF NOT EXISTS (SELECT 1 FROM allocation_items WHERE allocation_id = v_alloc) THEN
    IF EXISTS (
      SELECT 1 FROM pod
       WHERE farmer_id = NEW.farmer_id AND campaign_id = NEW.campaign_id
         AND id IS DISTINCT FROM NEW.id AND status = 'Verified'
         AND COALESCE(duplicate_flag, false) = false
    ) THEN
      RAISE EXCEPTION 'This beneficiary already has a verified delivery for the campaign'
        USING ERRCODE = '23505';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM allocation_items
     WHERE allocation_id = v_alloc
       AND COALESCE(quantity_delivered, 0) < quantity_entitled - 1e-9
  ) THEN
    RAISE EXCEPTION 'This beneficiary has already received the full package for the campaign'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.reject_delivery_when_entitlement_met() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_delivery_when_entitlement_met() TO service_role;

DROP TRIGGER IF EXISTS pod_rejects_delivery_when_entitlement_met ON public.pod;
CREATE TRIGGER pod_rejects_delivery_when_entitlement_met
BEFORE INSERT ON public.pod
FOR EACH ROW EXECUTE FUNCTION public.reject_delivery_when_entitlement_met();

-- ── Applying a package template ──────────────────────────────────────────────
-- Replacing a campaign's package is a delete followed by an insert. Done from
-- the API that is two round trips, and a failure between them leaves the
-- campaign with no items at all — which reads as "no package configured"
-- rather than as an error. Doing it here makes it one transaction, and puts
-- the eligibility rules next to the data they protect.
CREATE OR REPLACE FUNCTION public.apply_campaign_item_template(
  p_campaign_id integer,
  p_template_id integer
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.campaigns%ROWTYPE;
  t public.campaign_item_templates%ROWTYPE;
  v_lines integer;
  v_bad text;
BEGIN
  SELECT * INTO c FROM public.campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campaign not found' USING ERRCODE = 'P0002';
  END IF;
  IF c.status NOT IN ('Draft', 'Rejected') THEN
    RAISE EXCEPTION 'Campaign items can only change while Draft or Rejected'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO t FROM public.campaign_item_templates WHERE id = p_template_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template not found' USING ERRCODE = 'P0002';
  END IF;
  IF t.is_active <> 1 THEN
    RAISE EXCEPTION 'Template % is inactive', t.name USING ERRCODE = '55000';
  END IF;
  -- A template with no value chain is general purpose; one that names a value
  -- chain must not be applied to a campaign running a different intervention.
  IF t.value_chain_id IS NOT NULL
     AND c.value_chain_id IS DISTINCT FROM t.value_chain_id THEN
    RAISE EXCEPTION 'Template % belongs to a different value chain', t.name
      USING ERRCODE = '55000';
  END IF;

  SELECT string_agg(i.name, ', ') INTO v_bad
    FROM public.campaign_item_template_lines l
    JOIN public.input_items i ON i.id = l.input_item_id
   WHERE l.template_id = p_template_id AND i.is_active <> 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Template refers to input items that are no longer available: %', v_bad
      USING ERRCODE = '55000';
  END IF;

  SELECT count(*) INTO v_lines
    FROM public.campaign_item_template_lines WHERE template_id = p_template_id;
  IF v_lines = 0 THEN
    RAISE EXCEPTION 'Template % has no items', t.name USING ERRCODE = '55000';
  END IF;

  DELETE FROM public.campaign_items WHERE campaign_id = p_campaign_id;
  INSERT INTO public.campaign_items (campaign_id, input_item_id, quantity_per_farmer, basis, unit)
  SELECT p_campaign_id, l.input_item_id, l.quantity, l.basis, i.unit
    FROM public.campaign_item_template_lines l
    JOIN public.input_items i ON i.id = l.input_item_id
   WHERE l.template_id = p_template_id;

  RETURN v_lines;
END $$;

REVOKE ALL ON FUNCTION public.apply_campaign_item_template(integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_campaign_item_template(integer, integer) TO service_role;

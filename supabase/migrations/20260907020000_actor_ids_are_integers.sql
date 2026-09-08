-- Actor columns hold the integer users.id, not a profiles uuid.
--
-- The portal has always written the integer id — lib/db.ts resolves it through
-- intUid() for exactly this reason — and audit_logs.user_id, pod.approved_by and
-- pod.field_officer_id are all integer in a running database. The API server was
-- the outlier: it sent req.supabaseUser.id, a Supabase auth uuid, so creating a
-- campaign failed with "invalid input syntax for type integer".
--
-- schema.sql declared these columns uuid, which is why a database built from it
-- disagreed with production. This converts any that are still uuid, mapping each
-- profile to its operational user by email, and is a no-op where they are
-- already integer.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.table_name, c.column_name
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.data_type = 'uuid'
       AND (c.table_name, c.column_name) IN (
         ('campaigns', 'created_by'), ('campaigns', 'approved_by'),
         ('allocations', 'allocated_by'))
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',
      r.table_name, r.table_name || '_' || r.column_name || '_fkey');
    -- A cast cannot carry a lookup, so the mapped values land in a new column
    -- that then takes the old one's name. Each actor is matched to its
    -- operational user by the profile's email, which is how a portal account and
    -- its users row are linked; an actor with no users row becomes NULL rather
    -- than blocking the conversion.
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN %I integer',
      r.table_name, r.column_name || '_int');
    EXECUTE format($f$
      UPDATE public.%1$I t
         SET %2$I = u.id
        FROM public.profiles p
        JOIN public.users u ON lower(u.email) = lower(p.email)
       WHERE p.id = t.%3$I
    $f$, r.table_name, r.column_name || '_int', r.column_name);
    EXECUTE format('ALTER TABLE public.%I DROP COLUMN %I', r.table_name, r.column_name);
    EXECUTE format('ALTER TABLE public.%I RENAME COLUMN %I TO %I',
      r.table_name, r.column_name || '_int', r.column_name);
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.users(id)',
      r.table_name, r.table_name || '_' || r.column_name || '_fkey', r.column_name);
    RAISE NOTICE 'converted %.% to integer', r.table_name, r.column_name;
  END LOOP;
END $$;

-- The transition RPC took a uuid actor and wrote it straight into approved_by,
-- so campaign approval would have failed the same way. Dropped rather than
-- overloaded: two signatures differing only in the actor type would leave
-- PostgREST to guess which one a request meant.
DROP FUNCTION IF EXISTS public.transition_campaign_atomic(integer, text, uuid, text);

CREATE OR REPLACE FUNCTION public.transition_campaign_atomic(
  p_campaign_id integer, p_target_status text, p_actor integer DEFAULT NULL, p_reason text DEFAULT NULL
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
REVOKE ALL ON FUNCTION public.transition_campaign_atomic(integer,text,integer,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_campaign_atomic(integer,text,integer,text) TO service_role;

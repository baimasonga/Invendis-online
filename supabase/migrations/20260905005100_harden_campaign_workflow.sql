-- Campaign workflow integrity. Additive and safe for older deployed schemas.

UPDATE public.campaigns SET status = CASE lower(status)
  WHEN 'draft' THEN 'Draft' WHEN 'submitted' THEN 'Submitted'
  WHEN 'approved' THEN 'Approved' WHEN 'active' THEN 'Active'
  WHEN 'completed' THEN 'Completed' WHEN 'rejected' THEN 'Rejected'
  WHEN 'cancelled' THEN 'Cancelled' ELSE status END;
UPDATE public.allocations SET status = CASE lower(status)
  WHEN 'pending' THEN 'Pending' WHEN 'delivered' THEN 'Delivered'
  WHEN 'cancelled' THEN 'Cancelled' ELSE status END;

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS source_warehouse_id integer REFERENCES public.warehouses(id),
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

ALTER TABLE public.campaign_items
  ALTER COLUMN quantity_per_farmer TYPE double precision
  USING quantity_per_farmer::double precision;

-- Preserve one meaningful row before adding uniqueness constraints.
WITH ranked AS (
  SELECT id, campaign_id, farmer_id,
         min(id) OVER (PARTITION BY campaign_id, farmer_id) AS keep_id,
         bool_or(status = 'Delivered') OVER (PARTITION BY campaign_id, farmer_id) AS delivered
  FROM public.allocations
), merged AS (
  UPDATE public.allocations a
     SET status = CASE WHEN r.delivered THEN 'Delivered' ELSE a.status END
    FROM ranked r WHERE a.id = r.keep_id
  RETURNING a.id
)
DELETE FROM public.allocations a USING ranked r
 WHERE a.id = r.id AND r.id <> r.keep_id;

WITH ranked AS (
  SELECT id, campaign_id, input_item_id,
         min(id) OVER (PARTITION BY campaign_id, input_item_id) AS keep_id,
         max(quantity_per_farmer) OVER (PARTITION BY campaign_id, input_item_id) AS quantity
  FROM public.campaign_items
), merged AS (
  UPDATE public.campaign_items ci SET quantity_per_farmer = r.quantity
    FROM ranked r WHERE ci.id = r.keep_id
  RETURNING ci.id
)
DELETE FROM public.campaign_items ci USING ranked r
 WHERE ci.id = r.id AND r.id <> r.keep_id;

CREATE UNIQUE INDEX IF NOT EXISTS allocations_campaign_farmer_unique
  ON public.allocations (campaign_id, farmer_id);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_items_campaign_input_unique
  ON public.campaign_items (campaign_id, input_item_id);
CREATE INDEX IF NOT EXISTS allocations_campaign_status_idx
  ON public.allocations (campaign_id, status);
CREATE INDEX IF NOT EXISTS campaigns_district_status_idx
  ON public.campaigns (district_id, status);
CREATE INDEX IF NOT EXISTS campaigns_source_warehouse_idx
  ON public.campaigns (source_warehouse_id);
CREATE INDEX IF NOT EXISTS campaigns_distribution_site_idx
  ON public.campaigns (distribution_site_id);
CREATE INDEX IF NOT EXISTS dispatch_items_input_item_idx
  ON public.dispatch_items (input_item_id);

DO $$ BEGIN
  ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_status_valid
    CHECK (lower(status) IN ('draft','submitted','approved','active','completed','rejected','cancelled')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_date_order_valid
    CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_counts_nonnegative
    CHECK (coalesce(total_farmers,0) >= 0 AND coalesce(allocated_farmers,0) >= 0 AND coalesce(delivered_count,0) >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.allocations ADD CONSTRAINT allocations_status_valid
    CHECK (status IN ('Pending','Delivered','Cancelled')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.campaign_items ADD CONSTRAINT campaign_items_quantity_positive
    CHECK (quantity_per_farmer > 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.campaign_stock_reservations (
  id bigserial PRIMARY KEY,
  campaign_id integer NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  warehouse_id integer NOT NULL REFERENCES public.warehouses(id),
  input_item_id integer NOT NULL REFERENCES public.input_items(id),
  reserved_quantity double precision NOT NULL CHECK (reserved_quantity >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, input_item_id)
);
CREATE INDEX IF NOT EXISTS campaign_reservations_stock_idx
  ON public.campaign_stock_reservations (warehouse_id, input_item_id);
ALTER TABLE public.campaign_stock_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.campaign_stock_reservations FROM anon, authenticated;
GRANT ALL ON public.campaign_stock_reservations TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.campaign_stock_reservations_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_campaign_counts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_campaign_id integer; v_allocated integer; v_delivered integer; v_status text;
BEGIN
  v_campaign_id := coalesce(NEW.campaign_id, OLD.campaign_id);
  SELECT count(*) FILTER (WHERE status <> 'Cancelled'),
         count(*) FILTER (WHERE status = 'Delivered')
    INTO v_allocated, v_delivered
    FROM public.allocations WHERE campaign_id = v_campaign_id;
  UPDATE public.campaigns SET allocated_farmers = v_allocated,
         delivered_count = v_delivered, updated_at = now()
   WHERE id = v_campaign_id RETURNING status INTO v_status;
  IF v_allocated > 0 AND v_allocated = v_delivered AND v_status IN ('Approved','Active') THEN
    UPDATE public.campaigns SET status = 'Completed', completed_at = now(), updated_at = now()
     WHERE id = v_campaign_id;
    DELETE FROM public.campaign_stock_reservations WHERE campaign_id = v_campaign_id;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.refresh_campaign_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_campaign_counts() TO service_role;
DROP TRIGGER IF EXISTS allocations_refresh_campaign_counts ON public.allocations;
CREATE TRIGGER allocations_refresh_campaign_counts
AFTER INSERT OR DELETE OR UPDATE OF status, campaign_id ON public.allocations
FOR EACH ROW EXECUTE FUNCTION public.refresh_campaign_counts();

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
  END IF;

  IF p_target_status = 'Approved' THEN
    DELETE FROM public.campaign_stock_reservations WHERE campaign_id=c.id;
    SELECT count(*) INTO v_allocations FROM public.allocations
      WHERE campaign_id=c.id AND status <> 'Cancelled';
    FOR item IN SELECT input_item_id, quantity_per_farmer FROM public.campaign_items WHERE campaign_id=c.id LOOP
      v_required := item.quantity_per_farmer * v_allocations;
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

CREATE OR REPLACE FUNCTION public.enforce_campaign_dispatch_integrity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.campaigns%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.campaigns WHERE id=NEW.campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Campaign not found'; END IF;
  IF TG_OP='INSERT' OR NEW.status IN ('Approved','In Transit')
     OR (TG_OP='UPDATE' AND NEW.campaign_id IS DISTINCT FROM OLD.campaign_id) THEN
    IF lower(c.status) NOT IN ('approved','active') THEN
      RAISE EXCEPTION 'Dispatch requires an Approved or Active campaign';
    END IF;
  END IF;
  IF c.source_warehouse_id IS NOT NULL AND NEW.warehouse_id<>c.source_warehouse_id THEN
    RAISE EXCEPTION 'Dispatch warehouse must match the campaign source warehouse';
  END IF;
  IF NEW.status='In Transit' AND EXISTS (
    SELECT 1 FROM public.campaign_stock_reservations WHERE campaign_id=NEW.campaign_id
  ) AND EXISTS (
    SELECT 1 FROM public.dispatch_items di
    LEFT JOIN public.campaign_stock_reservations r
      ON r.campaign_id=NEW.campaign_id AND r.input_item_id=di.input_item_id
    WHERE di.dispatch_id=NEW.id AND di.quantity_loaded>coalesce(r.reserved_quantity,0)
  ) THEN RAISE EXCEPTION 'Dispatch quantities exceed the campaign stock reservation'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_campaign_dispatch_integrity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_campaign_dispatch_integrity() TO service_role;
DROP TRIGGER IF EXISTS dispatch_campaign_integrity ON public.dispatches;
CREATE TRIGGER dispatch_campaign_integrity BEFORE INSERT OR UPDATE OF campaign_id,warehouse_id,status
ON public.dispatches FOR EACH ROW EXECUTE FUNCTION public.enforce_campaign_dispatch_integrity();

CREATE OR REPLACE FUNCTION public.activate_campaign_on_dispatch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.status='In Transit' AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.campaigns SET status='Active',updated_at=now()
      WHERE id=NEW.campaign_id AND lower(status)='approved';
    UPDATE public.campaign_stock_reservations r
       SET reserved_quantity=greatest(0,r.reserved_quantity-di.quantity_loaded),updated_at=now()
      FROM public.dispatch_items di
     WHERE di.dispatch_id=NEW.id AND r.campaign_id=NEW.campaign_id AND r.input_item_id=di.input_item_id;
    DELETE FROM public.campaign_stock_reservations WHERE campaign_id=NEW.campaign_id AND reserved_quantity<=0;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.activate_campaign_on_dispatch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_campaign_on_dispatch() TO service_role;
DROP TRIGGER IF EXISTS dispatch_activate_campaign ON public.dispatches;
CREATE TRIGGER dispatch_activate_campaign AFTER UPDATE OF status ON public.dispatches
FOR EACH ROW EXECUTE FUNCTION public.activate_campaign_on_dispatch();

CREATE OR REPLACE FUNCTION public.enforce_campaign_dispatch_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_campaign_id integer;
BEGIN
  IF NEW.quantity_loaded<=0 THEN RAISE EXCEPTION 'Dispatch quantity must be positive'; END IF;
  SELECT campaign_id INTO v_campaign_id FROM public.dispatches WHERE id=NEW.dispatch_id;
  IF EXISTS (SELECT 1 FROM public.campaign_items WHERE campaign_id=v_campaign_id) AND NOT EXISTS (
    SELECT 1 FROM public.campaign_items WHERE campaign_id=v_campaign_id AND input_item_id=NEW.input_item_id
  ) THEN RAISE EXCEPTION 'Dispatch item is not configured for this campaign'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_campaign_dispatch_item() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_campaign_dispatch_item() TO service_role;
DROP TRIGGER IF EXISTS dispatch_item_campaign_integrity ON public.dispatch_items;
CREATE TRIGGER dispatch_item_campaign_integrity BEFORE INSERT OR UPDATE OF dispatch_id,input_item_id,quantity_loaded
ON public.dispatch_items FOR EACH ROW EXECUTE FUNCTION public.enforce_campaign_dispatch_item();

-- Campaign writes must pass through the authenticated API/service role.
REVOKE INSERT, UPDATE, DELETE ON public.campaigns, public.campaign_items, public.allocations FROM authenticated;

-- Keep mobile PoD and server-side vehicle evidence independent and fast.
-- Additive and safe to apply after 05100 and 05200.

BEGIN;

ALTER TABLE public.gps_track
  ADD COLUMN IF NOT EXISTS source text;

UPDATE public.gps_track
SET source = 'legacy'
WHERE source IS NULL;

ALTER TABLE public.gps_track
  ALTER COLUMN source SET DEFAULT 'legacy',
  ALTER COLUMN source SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'gps_track_source_check'
      AND conrelid = 'public.gps_track'::regclass
  ) THEN
    ALTER TABLE public.gps_track
      ADD CONSTRAINT gps_track_source_check
      CHECK (source IN ('hardware', 'mobile', 'legacy')) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.gps_track
  VALIDATE CONSTRAINT gps_track_source_check;

-- The existing GPS-Trace poller predates the source column. Recognize only its
-- server-side shape and attach the linked vehicle's active dispatch. Explicit
-- `mobile` and `hardware` values from current API routes are never rewritten.
CREATE OR REPLACE FUNCTION public.classify_linked_hardware_gps_track()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.source = 'legacy'
     AND NEW.dispatch_id IS NULL
     AND NEW.accuracy IS NULL
     AND EXISTS (
       SELECT 1 FROM public.vehicles v
       WHERE v.id = NEW.vehicle_id AND v.gps_device_id IS NOT NULL
     ) THEN
    SELECT d.id INTO NEW.dispatch_id
    FROM public.dispatches d
    WHERE d.vehicle_id = NEW.vehicle_id
      AND d.status = 'In Transit'
    ORDER BY d.created_at DESC
    LIMIT 1;
    IF NEW.dispatch_id IS NOT NULL THEN NEW.source := 'hardware'; END IF;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.classify_linked_hardware_gps_track()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.classify_linked_hardware_gps_track()
  TO service_role;

DROP TRIGGER IF EXISTS classify_gps_track_source ON public.gps_track;
CREATE TRIGGER classify_gps_track_source
BEFORE INSERT ON public.gps_track
FOR EACH ROW EXECUTE FUNCTION public.classify_linked_hardware_gps_track();

CREATE INDEX IF NOT EXISTS gps_track_dispatch_vehicle_hardware_recorded_idx
  ON public.gps_track (dispatch_id, vehicle_id, recorded_at DESC)
  WHERE source = 'hardware';

CREATE OR REPLACE FUNCTION public.verify_pod_against_hardware_gps()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_vehicle_id integer;
  v_plate text;
  v_captured_at timestamptz;
  v_point record;
  v_match_radius double precision := 500;
  v_near_radius double precision := 2000;
  v_max_age_minutes double precision := 30;
  v_distance double precision;
  v_age_seconds integer;
  v_status text := 'NoVehicleLocation';
  v_haversine double precision;
  v_has_point boolean := false;
BEGIN
  IF NEW.dispatch_id IS NULL THEN RETURN NEW; END IF;
  SELECT d.vehicle_id, v.plate_number
  INTO v_vehicle_id, v_plate
  FROM public.dispatches d
  LEFT JOIN public.vehicles v ON v.id = d.vehicle_id
  WHERE d.id = NEW.dispatch_id;

  BEGIN
    v_captured_at := NULLIF(NEW.vehicle_gps_snapshot #>> '{mobile,capturedAt}', '')::timestamptz;
  EXCEPTION WHEN invalid_datetime_format THEN
    v_captured_at := NULL;
  END;
  v_captured_at := COALESCE(v_captured_at, NEW.submitted_at, now());

  SELECT
    COALESCE(max(value::double precision) FILTER (
      WHERE key='pod_vehicle_gps_match_radius_m' AND value ~ '^[0-9]+([.][0-9]+)?$'
    ), v_match_radius),
    COALESCE(max(value::double precision) FILTER (
      WHERE key='pod_vehicle_gps_near_radius_m' AND value ~ '^[0-9]+([.][0-9]+)?$'
    ), v_near_radius),
    COALESCE(max(value::double precision) FILTER (
      WHERE key='pod_vehicle_gps_max_age_minutes' AND value ~ '^[0-9]+([.][0-9]+)?$'
    ), v_max_age_minutes)
  INTO v_match_radius, v_near_radius, v_max_age_minutes
  FROM public.system_settings
  WHERE key IN ('pod_vehicle_gps_match_radius_m','pod_vehicle_gps_near_radius_m','pod_vehicle_gps_max_age_minutes');
  v_match_radius := LEAST(5000, GREATEST(50, v_match_radius));
  v_near_radius := LEAST(20000, GREATEST(v_match_radius, v_near_radius));
  v_max_age_minutes := LEAST(1440, GREATEST(1, v_max_age_minutes));

  IF v_vehicle_id IS NOT NULL THEN
    SELECT g.latitude, g.longitude, g.accuracy, g.recorded_at
    INTO v_point
    FROM public.gps_track g
    WHERE g.dispatch_id = NEW.dispatch_id
      AND g.vehicle_id = v_vehicle_id
      AND g.source = 'hardware'
      AND g.recorded_at BETWEEN v_captured_at - make_interval(mins => ceil(v_max_age_minutes)::integer)
                            AND v_captured_at + make_interval(mins => ceil(v_max_age_minutes)::integer)
    ORDER BY abs(extract(epoch FROM (g.recorded_at - v_captured_at)))
    LIMIT 1;
    v_has_point := FOUND;
  END IF;

  IF v_has_point AND NEW.farmer_latitude IS NOT NULL AND NEW.farmer_longitude IS NOT NULL THEN
    v_haversine := power(sin(radians(v_point.latitude - NEW.farmer_latitude) / 2), 2)
      + cos(radians(NEW.farmer_latitude)) * cos(radians(v_point.latitude))
      * power(sin(radians(v_point.longitude - NEW.farmer_longitude) / 2), 2);
    v_distance := round((6371000 * 2 * asin(sqrt(LEAST(1, GREATEST(0, v_haversine)))))::numeric);
    v_age_seconds := round(abs(extract(epoch FROM (v_point.recorded_at - v_captured_at))))::integer;
    v_status := CASE
      WHEN v_age_seconds > v_max_age_minutes * 60 THEN 'StaleVehicleLocation'
      WHEN v_distance <= v_match_radius THEN 'Matched'
      WHEN v_distance <= v_near_radius THEN 'NearMatch'
      ELSE 'Mismatch'
    END;
  ELSIF NEW.farmer_latitude IS NULL OR NEW.farmer_longitude IS NULL THEN
    v_status := 'NoMobileLocation';
  END IF;

  NEW.vehicle_gps_status := v_status;
  NEW.vehicle_gps_snapshot := jsonb_build_object(
    'lat', CASE WHEN v_has_point THEN v_point.latitude ELSE NULL END,
    'lng', CASE WHEN v_has_point THEN v_point.longitude ELSE NULL END,
    'plateNumber', COALESCE(v_plate, ''),
    'recordedAt', CASE WHEN v_has_point THEN v_point.recorded_at ELSE NULL END,
    'accuracyM', CASE WHEN v_has_point THEN v_point.accuracy ELSE NULL END,
    'source', CASE WHEN v_has_point THEN 'history-nearest-capture' ELSE 'hardware-unavailable' END,
    'ageSeconds', v_age_seconds,
    'distanceM', v_distance,
    'status', v_status,
    'matchRadiusM', v_match_radius,
    'nearRadiusM', v_near_radius,
    'maxAgeMinutes', v_max_age_minutes,
    'mobile', jsonb_build_object(
      'lat', NEW.farmer_latitude,
      'lng', NEW.farmer_longitude,
      'capturedAt', v_captured_at
    )
  );
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.verify_pod_against_hardware_gps()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_pod_against_hardware_gps()
  TO service_role;

DROP TRIGGER IF EXISTS pod_hardware_gps_verification ON public.pod;
CREATE TRIGGER pod_hardware_gps_verification
BEFORE INSERT ON public.pod
FOR EACH ROW EXECUTE FUNCTION public.verify_pod_against_hardware_gps();

CREATE INDEX IF NOT EXISTS dispatches_field_officer_idx
  ON public.dispatches (field_officer_id)
  WHERE field_officer_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.require_dispatch_field_officer_on_start()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'In Transit'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
     AND NEW.field_officer_id IS NULL THEN
    RAISE EXCEPTION 'Assign a field officer before starting this dispatch'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.require_dispatch_field_officer_on_start()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.require_dispatch_field_officer_on_start()
  TO service_role;

DROP TRIGGER IF EXISTS dispatch_requires_field_officer ON public.dispatches;
CREATE TRIGGER dispatch_requires_field_officer
BEFORE INSERT OR UPDATE OF status, field_officer_id ON public.dispatches
FOR EACH ROW EXECUTE FUNCTION public.require_dispatch_field_officer_on_start();

-- Repair only the unambiguous part of legacy campaign setup: when every
-- existing dispatch for a campaign came from one warehouse, retain that source
-- warehouse. Distribution sites, campaign quantities and officer assignments
-- are deliberately not guessed.
WITH unambiguous_source AS (
  SELECT campaign_id, min(warehouse_id) AS warehouse_id
  FROM public.dispatches
  WHERE campaign_id IS NOT NULL AND warehouse_id IS NOT NULL
  GROUP BY campaign_id
  HAVING count(DISTINCT warehouse_id) = 1
)
UPDATE public.campaigns c
SET source_warehouse_id = u.warehouse_id,
    updated_at = now()
FROM unambiguous_source u
WHERE c.id = u.campaign_id
  AND c.source_warehouse_id IS NULL;

COMMIT;

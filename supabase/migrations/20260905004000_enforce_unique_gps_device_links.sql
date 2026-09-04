-- A hardware GPS device must belong to at most one vehicle. The API performs
-- friendly preflight checks, while this index closes the remaining race
-- between concurrent link requests at the database boundary.
CREATE UNIQUE INDEX IF NOT EXISTS vehicles_gps_device_id_unique
  ON public.vehicles (gps_device_id)
  WHERE gps_device_id IS NOT NULL AND btrim(gps_device_id) <> '';

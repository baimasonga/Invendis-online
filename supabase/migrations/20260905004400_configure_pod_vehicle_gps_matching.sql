-- Additive settings only: deployments retain safe defaults even before this
-- migration is applied, and existing PoD rows remain valid.
INSERT INTO public.system_settings (key, value, description) VALUES
  ('pod_vehicle_gps_match_radius_m', '500', 'Maximum vehicle-to-mobile distance for a confirmed PoD GPS match'),
  ('pod_vehicle_gps_near_radius_m', '2000', 'Maximum vehicle-to-mobile distance shown as a near match requiring review'),
  ('pod_vehicle_gps_max_age_minutes', '30', 'Maximum age of the vehicle tracker position used for PoD matching')
ON CONFLICT (key) DO NOTHING;

-- Supports the two nearest-position lookups used during PoD submission.
CREATE INDEX IF NOT EXISTS gps_track_vehicle_recorded_idx
  ON public.gps_track (vehicle_id, recorded_at DESC);

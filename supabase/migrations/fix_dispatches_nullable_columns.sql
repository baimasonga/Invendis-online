-- Fix dispatches table: allow nullable vehicle_id and driver_id
-- (needed for Excel import where vehicle may not be assigned yet)
ALTER TABLE dispatches ALTER COLUMN vehicle_id DROP NOT NULL;
ALTER TABLE dispatches ALTER COLUMN driver_id DROP NOT NULL;
ALTER TABLE dispatches ALTER COLUMN warehouse_id DROP NOT NULL;

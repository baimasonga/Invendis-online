-- Campaign items may have been imported with explicit IDs before inserts were
-- changed to rely on PostgreSQL's sequence. Move the sequence beyond live data
-- so the first database-generated ID cannot collide.
DO $$
DECLARE
  sequence_name text;
  max_id bigint;
BEGIN
  IF to_regclass('public.campaign_items') IS NULL THEN
    RETURN;
  END IF;

  sequence_name := pg_get_serial_sequence('public.campaign_items', 'id');
  IF sequence_name IS NULL THEN
    RAISE EXCEPTION 'Missing ID sequence for public.campaign_items';
  END IF;

  SELECT COALESCE(MAX(id), 0)
  INTO max_id
  FROM public.campaign_items;

  PERFORM setval(sequence_name, GREATEST(max_id, 1), max_id > 0);
END $$;
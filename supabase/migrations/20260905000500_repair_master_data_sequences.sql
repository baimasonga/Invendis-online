-- Imported rows may carry explicit IDs, which does not advance PostgreSQL
-- sequences.  Bring every application-owned serial sequence forward before the
-- API relies on database-generated IDs.  setval(..., true) makes the next
-- nextval greater than the current maximum; empty tables start at 1.
DO $$
DECLARE
  target_table text;
  sequence_name text;
  max_id bigint;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'districts', 'chiefdoms', 'sections', 'communities', 'value_chains',
    'warehouses', 'distribution_sites', 'input_items', 'farmers',
    'campaigns', 'dispatches', 'dispatch_items', 'pod', 'pod_items'
  ]
  LOOP
    -- Some older installations receive feature tables in later migrations.
    -- Skip tables that do not exist rather than failing the sequence repair.
    IF to_regclass('public.' || target_table) IS NULL THEN
      CONTINUE;
    END IF;
    sequence_name := pg_get_serial_sequence('public.' || target_table, 'id');
    IF sequence_name IS NOT NULL THEN
      EXECUTE format('SELECT COALESCE(MAX(id), 0) FROM public.%I', target_table)
        INTO max_id;
      PERFORM setval(sequence_name, GREATEST(max_id, 1), max_id > 0);
    END IF;
  END LOOP;
END $$;
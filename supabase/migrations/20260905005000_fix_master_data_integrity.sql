-- Follow-up to the sequence synchronization and atomic workflow migrations.
-- Repair missing ID defaults, consolidate duplicate value chains, and suppress
-- telemetry-only vehicle audit noise. Safe to run more than once on older schemas.

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;

-- Existing imports may have advanced IDs without advancing their sequences, or
-- an older schema may have lost the ID default entirely. Restore a sequence-backed
-- default and synchronize it with the current maximum ID.
DO $$
DECLARE
  table_name text;
  sequence_name text;
  maximum_id bigint;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'districts', 'chiefdoms', 'value_chains', 'warehouses',
    'distribution_sites', 'input_items', 'farmers', 'campaign_items'
  ]
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NULL THEN
      CONTINUE;
    END IF;

    sequence_name := pg_get_serial_sequence(format('public.%I', table_name), 'id');
    IF sequence_name IS NULL THEN
      sequence_name := format('public.%I', table_name || '_id_seq');
      EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %s', sequence_name);
      EXECUTE format(
        'ALTER TABLE public.%I ALTER COLUMN id SET DEFAULT nextval(%L::regclass)',
        table_name,
        sequence_name
      );
      EXECUTE format('ALTER SEQUENCE %s OWNED BY public.%I.id', sequence_name, table_name);
    END IF;

    EXECUTE format('SELECT COALESCE(max(id), 0) FROM public.%I', table_name)
      INTO maximum_id;
    PERFORM pg_catalog.setval(sequence_name::regclass, GREATEST(maximum_id, 1), maximum_id > 0);
  END LOOP;
END $$;

-- Consolidate duplicate value-chain names case-insensitively. Prefer an active
-- record, repoint every single-column foreign key discovered from the catalog,
-- then delete the unused duplicate row.
DO $$
DECLARE
  duplicate_group record;
  duplicate_row record;
  foreign_key record;
BEGIN
  IF to_regclass('public.value_chains') IS NOT NULL THEN
    FOR duplicate_group IN
      SELECT
        lower(btrim(name)) AS normalized_name,
        (array_agg(id ORDER BY is_active DESC, id ASC))[1] AS keep_id
      FROM public.value_chains
      WHERE btrim(name) <> ''
      GROUP BY lower(btrim(name))
      HAVING count(*) > 1
    LOOP
      FOR duplicate_row IN
        SELECT id, description, is_active
        FROM public.value_chains
        WHERE lower(btrim(name)) = duplicate_group.normalized_name
          AND id <> duplicate_group.keep_id
      LOOP
        FOR foreign_key IN
          SELECT
            source_namespace.nspname AS schema_name,
            source_table.relname AS table_name,
            source_column.attname AS column_name
          FROM pg_catalog.pg_constraint AS constraint_row
          JOIN pg_catalog.pg_class AS source_table
            ON source_table.oid = constraint_row.conrelid
          JOIN pg_catalog.pg_namespace AS source_namespace
            ON source_namespace.oid = source_table.relnamespace
          JOIN pg_catalog.pg_attribute AS source_column
            ON source_column.attrelid = constraint_row.conrelid
           AND source_column.attnum = constraint_row.conkey[1]
          WHERE constraint_row.contype = 'f'
            AND constraint_row.confrelid = 'public.value_chains'::regclass
            AND array_length(constraint_row.conkey, 1) = 1
            AND array_length(constraint_row.confkey, 1) = 1
        LOOP
          EXECUTE format(
            'UPDATE %I.%I SET %I = $1 WHERE %I = $2',
            foreign_key.schema_name,
            foreign_key.table_name,
            foreign_key.column_name,
            foreign_key.column_name
          ) USING duplicate_group.keep_id, duplicate_row.id;
        END LOOP;

        UPDATE public.value_chains
        SET
          is_active = GREATEST(is_active, duplicate_row.is_active),
          description = COALESCE(NULLIF(description, ''), duplicate_row.description)
        WHERE id = duplicate_group.keep_id;

        DELETE FROM public.value_chains WHERE id = duplicate_row.id;
      END LOOP;
    END LOOP;

    CREATE UNIQUE INDEX IF NOT EXISTS value_chains_normalized_name_unique_idx
      ON public.value_chains (lower(btrim(name)))
      WHERE btrim(name) <> '';
  END IF;
END $$;

-- GPS polling updates these three vehicle fields frequently. Keep audit entries
-- for tracker assignment and every business edit, but not telemetry-only refreshes.
CREATE OR REPLACE FUNCTION private.audit_business_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE row_data jsonb;
BEGIN
  IF TG_TABLE_NAME = 'vehicles'
     AND TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - ARRAY['last_latitude', 'last_longitude', 'last_ping'])
       = (to_jsonb(OLD) - ARRAY['last_latitude', 'last_longitude', 'last_ping']) THEN
    RETURN NEW;
  END IF;

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

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Fail the transaction if the integrity repair did not reach its postconditions.
DO $$
DECLARE table_name text;
BEGIN
  IF to_regclass('public.value_chains') IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.value_chains
    WHERE btrim(name) <> ''
    GROUP BY lower(btrim(name))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate value chains remain after repair';
  END IF;

  FOREACH table_name IN ARRAY ARRAY[
    'districts', 'chiefdoms', 'value_chains', 'warehouses',
    'distribution_sites', 'input_items', 'farmers', 'campaign_items'
  ]
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL
       AND pg_get_serial_sequence(format('public.%I', table_name), 'id') IS NULL THEN
      RAISE EXCEPTION 'Missing ID sequence for public.%', table_name;
    END IF;
  END LOOP;
END $$;

COMMIT;

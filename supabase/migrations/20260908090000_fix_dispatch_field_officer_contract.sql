-- Dispatch ownership is an operational user id everywhere in the API, portal,
-- field app, pod and incidents tables. Some deployed databases still have the
-- old profiles(uuid) foreign key, which makes every officer assignment fail.
--
-- Convert without discarding existing assignments. A profile is linked to its
-- operational user by email, the same bridge used by login/provisioning code.
DO $$
DECLARE
  v_type text;
  v_constraint record;
  v_ambiguous text;
  v_unmapped text;
BEGIN
  SELECT data_type INTO v_type
    FROM information_schema.columns
   WHERE table_schema='public'
     AND table_name='dispatches'
     AND column_name='field_officer_id';

  IF v_type IS NULL THEN
    RAISE EXCEPTION 'public.dispatches.field_officer_id does not exist';
  END IF;

  IF v_type = 'uuid' THEN
    IF to_regprocedure('public.require_dispatch_field_officer_on_start()') IS NULL THEN
      RAISE EXCEPTION 'public.require_dispatch_field_officer_on_start() does not exist';
    END IF;
    SELECT string_agg(p.id::text, ', ' ORDER BY p.id::text) INTO v_ambiguous
      FROM public.profiles p
      JOIN public.dispatches d ON d.field_officer_id=p.id
     WHERE (SELECT count(*) FROM public.users u
             WHERE lower(u.email)=lower(p.email)) > 1;
    IF v_ambiguous IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot convert dispatch officers: profiles map to multiple users: %', v_ambiguous;
    END IF;

    SELECT string_agg(d.id::text, ', ' ORDER BY d.id) INTO v_unmapped
      FROM public.dispatches d
      LEFT JOIN public.profiles p ON p.id=d.field_officer_id
      LEFT JOIN public.users u ON lower(u.email)=lower(p.email)
     WHERE d.field_officer_id IS NOT NULL AND u.id IS NULL;
    IF v_unmapped IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot convert dispatch officers: dispatches have no operational user mapping: %', v_unmapped;
    END IF;

    FOR v_constraint IN
      SELECT con.conname
        FROM pg_constraint con
        JOIN pg_attribute att
          ON att.attrelid=con.conrelid AND att.attnum=ANY(con.conkey)
       WHERE con.conrelid='public.dispatches'::regclass
         AND con.contype='f'
         AND att.attname='field_officer_id'
    LOOP
      EXECUTE format('ALTER TABLE public.dispatches DROP CONSTRAINT %I', v_constraint.conname);
    END LOOP;

    CREATE OR REPLACE FUNCTION pg_temp.invendis_dispatch_user_id(p_profile_id uuid)
    RETURNS integer
    LANGUAGE sql
    STABLE
    STRICT
    SET search_path = ''
    AS $fn$
      SELECT u.id
        FROM public.profiles p
        JOIN public.users u ON lower(u.email)=lower(p.email)
       WHERE p.id=p_profile_id
    $fn$;

    -- PostgreSQL will not change the type of a column named by UPDATE OF.
    -- Recreate the existing guard in the same transaction so there is never a
    -- committed state in which an in-transit dispatch can lack an officer.
    DROP TRIGGER IF EXISTS dispatch_requires_field_officer ON public.dispatches;
    ALTER TABLE public.dispatches
      ALTER COLUMN field_officer_id TYPE integer
      USING pg_temp.invendis_dispatch_user_id(field_officer_id);
    CREATE TRIGGER dispatch_requires_field_officer
      BEFORE INSERT OR UPDATE OF status, field_officer_id ON public.dispatches
      FOR EACH ROW
      EXECUTE FUNCTION public.require_dispatch_field_officer_on_start();
  ELSIF v_type <> 'integer' THEN
    RAISE EXCEPTION 'Unexpected dispatches.field_officer_id type: %', v_type;
  END IF;

  -- Repair the foreign key even where the column type was already integer.
  FOR v_constraint IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_attribute att
        ON att.attrelid=con.conrelid AND att.attnum=ANY(con.conkey)
     WHERE con.conrelid='public.dispatches'::regclass
       AND con.contype='f'
       AND att.attname='field_officer_id'
  LOOP
    EXECUTE format('ALTER TABLE public.dispatches DROP CONSTRAINT %I', v_constraint.conname);
  END LOOP;

  ALTER TABLE public.dispatches
    ADD CONSTRAINT dispatches_field_officer_id_fkey
    FOREIGN KEY (field_officer_id) REFERENCES public.users(id) NOT VALID;
  ALTER TABLE public.dispatches
    VALIDATE CONSTRAINT dispatches_field_officer_id_fkey;
END $$;

CREATE INDEX IF NOT EXISTS dispatches_field_officer_idx
  ON public.dispatches(field_officer_id)
  WHERE field_officer_id IS NOT NULL;

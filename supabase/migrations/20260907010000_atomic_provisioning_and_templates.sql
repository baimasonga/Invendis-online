-- Two provisioning paths that wrote in more than one step, and the sequence
-- drift one of them caused.

-- ── Portal user provisioning ─────────────────────────────────────────────────
-- A portal-only account has no integer users row until one is provisioned. The
-- API did that by reading max(id) and inserting that id + 1 explicitly, which
-- never advances users_id_seq. POST /api/users inserts without an id and so
-- takes nextval — once provisioning has written an id the sequence has not seen,
-- the next ordinary user creation collides on the primary key.
--
-- Provisioning now happens here in one statement: the sequence is repaired if it
-- lags, the insert takes its id from the sequence like every other path, and a
-- concurrent winner is resolved by returning the row it created.
CREATE OR REPLACE FUNCTION public.provision_user_account(
  p_email text,
  p_username text,
  p_password_hash text,
  p_full_name text,
  p_role text,
  p_district_id integer
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id integer;
  v_seq text;
  v_max bigint;
BEGIN
  IF nullif(btrim(p_email), '') IS NULL THEN
    RAISE EXCEPTION 'An email is required to provision a user' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_id FROM users WHERE email = p_email LIMIT 1;
  IF FOUND THEN RETURN v_id; END IF;

  -- Historic imports carry explicit ids, so the sequence can sit behind the
  -- table. Bring it forward before relying on it.
  v_seq := pg_get_serial_sequence('public.users', 'id');
  IF v_seq IS NOT NULL THEN
    SELECT COALESCE(max(id), 0) INTO v_max FROM users;
    IF v_max > COALESCE((SELECT last_value FROM pg_sequences
                          WHERE schemaname = 'public' AND sequencename = split_part(v_seq, '.', 2)), 0) THEN
      PERFORM setval(v_seq, v_max, true);
    END IF;
  END IF;

  BEGIN
    INSERT INTO users (username, password_hash, full_name, email, role, district_id, is_active)
    VALUES (p_username, p_password_hash, p_full_name, p_email,
            COALESCE(nullif(btrim(p_role), ''), 'Viewer'), p_district_id, true)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- A concurrent request provisioned the same account first.
    SELECT id INTO v_id FROM users WHERE email = p_email LIMIT 1;
    IF NOT FOUND THEN RAISE; END IF;
  END;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.provision_user_account(text, text, text, text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_user_account(text, text, text, text, text, integer)
  TO service_role;

-- Repair the drift the old provisioning path has already caused. users was not
-- in the 20260905000500 repair list, and the mobile login path still assigns
-- explicit ids, so this makes the next nextval clear the current maximum.
DO $$
DECLARE v_seq text; v_max bigint;
BEGIN
  v_seq := pg_get_serial_sequence('public.users', 'id');
  IF v_seq IS NOT NULL THEN
    SELECT COALESCE(max(id), 0) INTO v_max FROM public.users;
    PERFORM setval(v_seq, GREATEST(v_max, 1), v_max > 0);
  END IF;
END $$;

-- ── Template editing ─────────────────────────────────────────────────────────
-- Editing a template updated the header, deleted its lines and inserted the
-- replacements as three separate requests. A failure on the insert — a stale
-- input item, a foreign key violation — left the template with no lines at all
-- and a header already changed, which reads as an empty template rather than as
-- a failed edit. One statement, so a rejected edit leaves the previous template
-- exactly as it was.
CREATE OR REPLACE FUNCTION public.save_campaign_item_template(
  p_template_id integer,
  p_name text,
  p_description text,
  p_value_chain_id integer,
  p_lines jsonb,
  p_created_by uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id integer := p_template_id;
  v_bad text;
  v_count integer;
BEGIN
  IF nullif(btrim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'A template name is required' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'A template needs at least one item' USING ERRCODE = '22023';
  END IF;

  -- Reject the whole edit if any line names an item that is gone or retired,
  -- before anything is written.
  SELECT string_agg(DISTINCT l.input_item_id::text, ', ') INTO v_bad
    FROM jsonb_to_recordset(p_lines)
      AS l(input_item_id integer, quantity double precision, basis text)
   WHERE NOT EXISTS (
     SELECT 1 FROM input_items i WHERE i.id = l.input_item_id AND i.is_active = 1
   );
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Input items are unavailable: %', v_bad USING ERRCODE = '23503';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO campaign_item_templates (name, description, value_chain_id, created_by)
    VALUES (btrim(p_name), p_description, p_value_chain_id, p_created_by)
    RETURNING id INTO v_id;
  ELSE
    UPDATE campaign_item_templates
       SET name = btrim(p_name), description = p_description,
           value_chain_id = p_value_chain_id, updated_at = now()
     WHERE id = v_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Template not found' USING ERRCODE = 'P0002';
    END IF;
    DELETE FROM campaign_item_template_lines WHERE template_id = v_id;
  END IF;

  INSERT INTO campaign_item_template_lines (template_id, input_item_id, quantity, basis)
  SELECT v_id, l.input_item_id, l.quantity, COALESCE(l.basis, 'per_beneficiary')
    FROM jsonb_to_recordset(p_lines)
      AS l(input_item_id integer, quantity double precision, basis text);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'A template needs at least one item' USING ERRCODE = '22023';
  END IF;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.save_campaign_item_template(integer, text, text, integer, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_campaign_item_template(integer, text, text, integer, jsonb, uuid)
  TO service_role;

-- Provisioning a portal user, and editing a template, as single statements.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.expect(p_ok boolean, p_what text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'FAILED: %', p_what; END IF;
  RAISE NOTICE '  ok  %', p_what;
END $$;

-- ── Provisioning must not strand the sequence behind the table ───────────────
BEGIN;
\i supabase/tests/10_fixtures.sql
-- Align the sequence with the table first: that is the healthy state, and the
-- one where the old provisioning collided. Writing max(id) + 1 explicitly left
-- the sequence untouched, so the next insert that takes nextval got the very
-- same id. (A lagging sequence is covered too — the RPC repairs it first.)
SELECT setval(pg_get_serial_sequence('public.users', 'id'), (SELECT max(id) FROM users), true);
SELECT public.provision_user_account(
  'portal@example.test', 'portal@example.test', 'hash', 'Portal User', 'ProjectManager', 901
) AS provisioned \gset
SELECT pg_temp.expect(
  (SELECT count(*) FROM users WHERE email = 'portal@example.test') = 1,
  'a portal-only account is provisioned');
SELECT pg_temp.expect(
  :provisioned > 903,
  'the provisioned id clears the ids already in the table');

-- The next ordinary creation takes nextval, which is what POST /api/users does.
INSERT INTO users(username, password_hash, full_name, role, is_active)
VALUES ('after-provisioning', 'x', 'Created Normally', 'Admin', true);
SELECT pg_temp.expect(
  (SELECT count(*) FROM users WHERE username = 'after-provisioning') = 1,
  'creating a user after provisioning does not collide on the primary key');

-- Prove the test bites: the old approach, replayed here, does collide.
DO $$
DECLARE v_next integer;
BEGIN
  PERFORM setval(pg_get_serial_sequence('public.users', 'id'), (SELECT max(id) FROM users), true);
  SELECT COALESCE(max(id), 0) + 1 INTO v_next FROM users;
  INSERT INTO users(id, username, password_hash, full_name, role, is_active)
  VALUES (v_next, 'old-style-provisioning', 'x', 'Explicit Id', 'Viewer', true);
  INSERT INTO users(username, password_hash, full_name, role, is_active)
  VALUES ('next-ordinary-user', 'x', 'Sequence Id', 'Viewer', true);
  RAISE EXCEPTION 'FAILED: assigning max(id) + 1 no longer collides, so this test proves nothing';
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE '  ok  the old max(id) + 1 provisioning does collide, so the fix is load-bearing';
END $$;

-- Provisioning the same account again returns the existing row.
SELECT public.provision_user_account(
  'portal@example.test', 'portal@example.test', 'hash2', 'Portal User', 'Admin', 901
) AS again \gset
SELECT pg_temp.expect(
  :again = :provisioned,
  'provisioning an existing account returns the row already there');
SELECT pg_temp.expect(
  (SELECT count(*) FROM users WHERE email = 'portal@example.test') = 1,
  'provisioning twice does not create a second account');
ROLLBACK;

-- ── A rejected template edit leaves the previous template intact ─────────────
BEGIN;
\i supabase/tests/10_fixtures.sql
SELECT public.save_campaign_item_template(
  NULL, 'Rice Package', 'First version', 901,
  '[{"input_item_id":902,"quantity":2,"basis":"per_member"}]'::jsonb, NULL
) AS tpl \gset
SELECT pg_temp.expect(
  (SELECT count(*) FROM campaign_item_template_lines WHERE template_id = :tpl) = 1,
  'a template is created with its lines');

DO $$
DECLARE v_tpl integer;
BEGIN
  SELECT id INTO v_tpl FROM campaign_item_templates WHERE name = 'Rice Package';
  -- 904 is the retired input item in the fixtures.
  PERFORM public.save_campaign_item_template(
    v_tpl, 'Rice Package Renamed', 'Second version', 901,
    '[{"input_item_id":904,"quantity":1,"basis":"per_beneficiary"}]'::jsonb, NULL);
  RAISE EXCEPTION 'FAILED: an edit naming a retired item was accepted';
EXCEPTION WHEN sqlstate '23503' THEN
  RAISE NOTICE '  ok  an edit naming a retired input item is refused';
END $$;

SELECT pg_temp.expect(
  (SELECT count(*) FROM campaign_item_template_lines WHERE template_id = :tpl) = 1,
  'the refused edit left the original lines in place');
SELECT pg_temp.expect(
  (SELECT name FROM campaign_item_templates WHERE id = :tpl) = 'Rice Package',
  'the refused edit left the original header in place');

-- A valid edit replaces the lines wholesale.
SELECT public.save_campaign_item_template(
  :tpl, 'Rice Package', 'Third version', 901,
  '[{"input_item_id":901,"quantity":1,"basis":"per_beneficiary"},
    {"input_item_id":903,"quantity":2,"basis":"per_hectare"}]'::jsonb, NULL
);
SELECT pg_temp.expect(
  (SELECT count(*) FROM campaign_item_template_lines WHERE template_id = :tpl) = 2
  AND NOT EXISTS (SELECT 1 FROM campaign_item_template_lines
                   WHERE template_id = :tpl AND input_item_id = 902),
  'a valid edit replaces the lines wholesale');

DO $$
DECLARE v_tpl integer;
BEGIN
  SELECT id INTO v_tpl FROM campaign_item_templates WHERE name = 'Rice Package';
  PERFORM public.save_campaign_item_template(v_tpl, 'Rice Package', NULL, 901, '[]'::jsonb, NULL);
  RAISE EXCEPTION 'FAILED: a template was emptied of its items';
EXCEPTION WHEN sqlstate '22023' THEN
  RAISE NOTICE '  ok  an edit that would leave no items is refused';
END $$;
ROLLBACK;

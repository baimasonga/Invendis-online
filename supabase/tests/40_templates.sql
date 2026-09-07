-- Applying a saved package to a campaign.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.expect(p_ok boolean, p_what text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'FAILED: %', p_what; END IF;
  RAISE NOTICE '  ok  %', p_what;
END $$;

BEGIN;
\i supabase/tests/10_fixtures.sql
INSERT INTO campaign_item_templates(id, name, value_chain_id, is_active) VALUES
  (901, 'Test Rice Package',     901, 1),
  (902, 'Test Retired Package',  901, 0),
  (903, 'Test Cassava Package',  902, 1),
  (904, 'Test Universal Package', NULL, 1),
  (905, 'Test Broken Package',   901, 1),
  (906, 'Test Empty Package',    901, 1);
INSERT INTO campaign_item_template_lines(template_id, input_item_id, quantity, basis) VALUES
  (901, 902, 2, 'per_member'),
  (902, 902, 1, 'per_member'),
  (903, 902, 1, 'per_member'),
  (904, 903, 1, 'per_hectare'),
  (905, 904, 1, 'per_beneficiary');

SELECT pg_temp.expect(
  public.apply_campaign_item_template(901, 901) = 1,
  'a matching active template replaces the package');
SELECT pg_temp.expect(
  (SELECT count(*) FROM campaign_items WHERE campaign_id = 901) = 1
  AND (SELECT basis FROM campaign_items WHERE campaign_id = 901) = 'per_member',
  'the applied package carries the template basis and nothing else');

SELECT pg_temp.expect(
  public.apply_campaign_item_template(901, 904) = 1,
  'a template with no value chain applies to any campaign');

DO $$ BEGIN
  PERFORM public.apply_campaign_item_template(901, 902);
  RAISE EXCEPTION 'FAILED: an inactive template was applied';
EXCEPTION WHEN sqlstate '55000' THEN
  RAISE NOTICE '  ok  an inactive template is refused';
END $$;

DO $$ BEGIN
  PERFORM public.apply_campaign_item_template(901, 903);
  RAISE EXCEPTION 'FAILED: a template from another value chain was applied';
EXCEPTION WHEN sqlstate '55000' THEN
  RAISE NOTICE '  ok  a template from another value chain is refused';
END $$;

DO $$ BEGIN
  PERFORM public.apply_campaign_item_template(901, 905);
  RAISE EXCEPTION 'FAILED: a template naming a retired input item was applied';
EXCEPTION WHEN sqlstate '55000' THEN
  RAISE NOTICE '  ok  a template naming a retired input item is refused';
END $$;

DO $$ BEGIN
  PERFORM public.apply_campaign_item_template(901, 906);
  RAISE EXCEPTION 'FAILED: an empty template was applied';
EXCEPTION WHEN sqlstate '55000' THEN
  RAISE NOTICE '  ok  an empty template is refused';
END $$;

-- A refused application must not have emptied the package on its way out.
SELECT pg_temp.expect(
  (SELECT count(*) FROM campaign_items WHERE campaign_id = 901) = 1,
  'a refused application leaves the existing package intact');

UPDATE campaigns SET status = 'Approved' WHERE id = 901;
DO $$ BEGIN
  PERFORM public.apply_campaign_item_template(901, 901);
  RAISE EXCEPTION 'FAILED: an approved campaign had its package replaced';
EXCEPTION WHEN sqlstate '55000' THEN
  RAISE NOTICE '  ok  an approved campaign refuses a package change';
END $$;
ROLLBACK;

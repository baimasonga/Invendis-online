-- Post-deployment check for the 20260907* migrations.
--
-- Run against the deployed database (the Supabase SQL editor is fine). Every
-- row should match its "expect" column. Two are worth reading closely:
--
--   transition_campaign_atomic actor  still reading uuid means 20260907020000
--                                     did not take, and campaign approval will
--                                     fail on a signature that no longer exists.
--   users sequence clears max(id)     LAGGING means the next ordinary user
--                                     creation will collide on the primary key;
--                                     re-running 20260907010000 repairs it.
--
-- The last row counts usable delivery sites. Zero means no campaign can be
-- created, whatever else is correct.

SELECT 'campaign_items.basis' AS check,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema='public' AND table_name='campaign_items' AND column_name='basis')::text AS found,
       '1 expected' AS expect
UNION ALL SELECT 'allocation_items table',
       (SELECT count(*) FROM information_schema.tables
         WHERE table_schema='public' AND table_name='allocation_items')::text, '1 expected'
UNION ALL SELECT 'campaigns.created_by type',
       (SELECT data_type FROM information_schema.columns
         WHERE table_schema='public' AND table_name='campaigns' AND column_name='created_by'), 'integer'
UNION ALL SELECT 'campaigns.approved_by type',
       (SELECT data_type FROM information_schema.columns
         WHERE table_schema='public' AND table_name='campaigns' AND column_name='approved_by'), 'integer'
UNION ALL SELECT 'allocations.allocated_by type',
       (SELECT data_type FROM information_schema.columns
         WHERE table_schema='public' AND table_name='allocations' AND column_name='allocated_by'), 'integer'
UNION ALL SELECT 'transition_campaign_atomic actor',
       (SELECT pg_get_function_arguments(oid) FROM pg_proc
         WHERE proname='transition_campaign_atomic'), 'p_actor integer'
UNION ALL SELECT 'new RPCs present',
       (SELECT string_agg(proname, ', ' ORDER BY proname) FROM pg_proc
         WHERE proname IN ('provision_user_account','save_campaign_item_template',
                           'apply_campaign_item_template','materialize_allocation_items')),
       'all four'
UNION ALL SELECT 'users sequence clears max(id)',
       (SELECT CASE WHEN COALESCE((SELECT max(id) FROM users),0)
                       <= COALESCE((SELECT last_value FROM pg_sequences
                                     WHERE schemaname='public' AND sequencename='users_id_seq'),0)
                    THEN 'ok' ELSE 'LAGGING - rerun 20260907010000' END), 'ok'
UNION ALL SELECT 'delivery sites with GPS',
       (SELECT count(*)::text FROM distribution_sites
         WHERE is_active=1 AND latitude IS NOT NULL AND longitude IS NOT NULL),
       'at least 1 per district';

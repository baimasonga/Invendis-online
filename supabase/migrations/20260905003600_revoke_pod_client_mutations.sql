-- PoD writes must flow through the authenticated API and its transactional
-- service-role RPCs. Browser roles retain read access for the portal.
BEGIN;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.pod, public.pod_items
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.pod, public.pod_items TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.pod, public.pod_items TO service_role;

-- pod already has the management_read policy from the web-security hardening
-- migration. Apply the equivalent read-only policy to its line items.
ALTER TABLE public.pod_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pod_items_management_read ON public.pod_items;
CREATE POLICY pod_items_management_read ON public.pod_items
  FOR SELECT TO authenticated
  USING (private.invendis_has_role(ARRAY[
    'admin', 'projectmanager', 'districtcoordinator', 'warehousemanager', 'viewer'
  ]));

COMMIT;
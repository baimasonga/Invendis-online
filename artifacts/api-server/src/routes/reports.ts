import { Router } from "express";
import { supa, snakeToCamel } from "../lib/supabase.js";
import { requireAuth } from "../lib/auth.js";

const router = Router();

router.get("/api/reports/farmer-beneficiary", requireAuth, async (req, res) => {
  const { campaignId } = req.query as Record<string, string>;
  let q = supa.from("allocations").select("*").order("created_at", { ascending: false });
  if (campaignId) q = q.eq("campaign_id", Number(campaignId)) as typeof q;
  const { data, error } = await q;
  if (error) { res.status(500).json({ error: error.message }); return; }
  const farmerIds = [...new Set((data ?? []).map((r: any) => r.farmer_id).filter(Boolean))];
  const campaignIds = [...new Set((data ?? []).map((r: any) => r.campaign_id).filter(Boolean))];
  const [{ data: farmers }, { data: campaigns }] = await Promise.all([
    farmerIds.length > 0 ? supa.from("farmers").select("id,farmer_code,first_name,last_name,gender,phone,district_id,value_chain_id").in("id", farmerIds) : { data: [] },
    campaignIds.length > 0 ? supa.from("campaigns").select("id,name").in("id", campaignIds) : { data: [] },
  ]);
  const farmerMap = Object.fromEntries((farmers ?? []).map((f: any) => [f.id, f]));
  const campaignMap = Object.fromEntries((campaigns ?? []).map((c: any) => [c.id, c]));
  const rows = (data ?? []).map((r: any) => ({
    farmerId: r.farmer_id,
    farmerCode: farmerMap[r.farmer_id]?.farmer_code ?? null,
    firstName: farmerMap[r.farmer_id]?.first_name ?? null,
    lastName: farmerMap[r.farmer_id]?.last_name ?? null,
    gender: farmerMap[r.farmer_id]?.gender ?? null,
    phone: farmerMap[r.farmer_id]?.phone ?? null,
    districtId: farmerMap[r.farmer_id]?.district_id ?? null,
    valueChainId: farmerMap[r.farmer_id]?.value_chain_id ?? null,
    campaignId: r.campaign_id,
    campaignName: campaignMap[r.campaign_id]?.name ?? null,
    allocationStatus: r.status,
  }));
  res.json({ data: rows, total: rows.length });
});

router.get("/api/reports/stock-movement", requireAuth, async (req, res) => {
  const { warehouseId, inputItemId, fromDate, toDate } = req.query as Record<string, string>;
  let q = supa.from("stock_ledger").select("*").order("created_at", { ascending: false });
  if (warehouseId) q = q.eq("warehouse_id", Number(warehouseId)) as typeof q;
  if (inputItemId) q = q.eq("input_item_id", Number(inputItemId)) as typeof q;
  if (fromDate) q = q.gte("created_at", fromDate) as typeof q;
  if (toDate) q = q.lte("created_at", toDate) as typeof q;
  const { data, error } = await q;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ data: snakeToCamel(data ?? []), total: (data ?? []).length });
});

router.get("/api/reports/distribution", requireAuth, async (req, res) => {
  const { campaignId, fromDate, toDate } = req.query as Record<string, string>;
  let q = supa.from("dispatches").select("id,manifest_code,campaign_id,status,total_packages,delivered_packages,departed_at,arrived_at").order("created_at", { ascending: false });
  if (campaignId) q = q.eq("campaign_id", Number(campaignId)) as typeof q;
  if (fromDate) q = q.gte("created_at", fromDate) as typeof q;
  if (toDate) q = q.lte("created_at", toDate) as typeof q;
  const { data, error } = await q;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ data: snakeToCamel(data ?? []), total: (data ?? []).length });
});

export default router;

import { Router } from "express";
import { supa, snakeToCamel, camelToSnake } from "../lib/supabase.js";
import { requireAuth } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";

const router = Router();

router.get("/api/dispatch", requireAuth, async (req, res) => {
  const { campaignId, status, page = "1", limit = "20" } = req.query as Record<string, string>;
  const offset = (Number(page) - 1) * Number(limit);
  let q = supa.from("dispatches").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(offset, offset + Number(limit) - 1);
  if (campaignId) q = q.eq("campaign_id", Number(campaignId)) as typeof q;
  if (status) q = q.eq("status", status) as typeof q;
  const { data, count, error } = await q;
  if (error) { res.status(500).json({ error: error.message }); return; }
  const rows = data ?? [];
  const campaignIds = [...new Set(rows.map((r: any) => r.campaign_id).filter(Boolean))];
  const { data: campaigns } = campaignIds.length > 0
    ? await supa.from("campaigns").select("id,name,district_id").in("id", campaignIds)
    : { data: [] };
  const districtIds = [...new Set((campaigns ?? []).map((c: any) => c.district_id).filter(Boolean))];
  const { data: districts } = districtIds.length > 0
    ? await supa.from("districts").select("id,name").in("id", districtIds)
    : { data: [] };
  const campaignMap = Object.fromEntries((campaigns ?? []).map((c: any) => [c.id, c]));
  const districtMap = Object.fromEntries((districts ?? []).map((d: any) => [d.id, d]));
  const enriched = rows.map((r: any) => {
    const campaign = campaignMap[r.campaign_id];
    const district = campaign ? districtMap[campaign.district_id] : null;
    return {
      ...snakeToCamel(r),
      campaignName: campaign?.name ?? null,
      destinationDistrict: district?.name ?? null,
      destinationCommunity: null,
    };
  });
  res.json({ data: enriched, total: count ?? 0, page: Number(page), limit: Number(limit) });
});

router.post("/api/dispatch", requireAuth, async (req, res) => {
  const manifestCode = "MAN-" + Date.now().toString(36).toUpperCase();
  const body = camelToSnake(req.body);
  const { data, error } = await supa.from("dispatches").insert({ ...body, manifest_code: manifestCode, created_by: req.user!.userId }).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "CREATE", "Dispatch", `Created dispatch manifest: ${manifestCode}`, "dispatch", (data as any).id);
  res.status(201).json(snakeToCamel(data));
});

router.get("/api/dispatch/:id", requireAuth, async (req, res) => {
  const { data: row, error } = await supa.from("dispatches").select("*").eq("id", Number(req.params.id)).single();
  if (error || !row) { res.status(404).json({ error: "Not found" }); return; }
  const { data: items } = await supa.from("dispatch_items").select("*").eq("dispatch_id", (row as any).id);
  const itemIds = (items ?? []).map((i: any) => i.input_item_id).filter(Boolean);
  const { data: inputItems } = itemIds.length > 0
    ? await supa.from("input_items").select("id,name,unit").in("id", itemIds)
    : { data: [] };
  const itemMap = Object.fromEntries((inputItems ?? []).map((ii: any) => [ii.id, ii]));
  const mappedItems = (items ?? []).map((i: any) => ({
    id: i.id, dispatchId: i.dispatch_id, inputItemId: i.input_item_id,
    inputItemName: itemMap[i.input_item_id]?.name ?? null,
    unit: itemMap[i.input_item_id]?.unit ?? null,
    quantityLoaded: i.quantity_loaded, quantityDelivered: i.quantity_delivered, quantityReturned: i.quantity_returned,
  }));
  res.json({ ...snakeToCamel(row), items: mappedItems });
});

router.post("/api/dispatch/:id/items", requireAuth, async (req, res) => {
  const dispatchId = Number(req.params.id);
  const { inputItemId, quantityLoaded } = req.body as { inputItemId: number; quantityLoaded: number };
  const { data: item, error } = await supa.from("dispatch_items").insert({ dispatch_id: dispatchId, input_item_id: inputItemId, quantity_loaded: quantityLoaded }).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  const { data: allItems } = await supa.from("dispatch_items").select("quantity_loaded").eq("dispatch_id", dispatchId);
  const total = (allItems ?? []).reduce((s: number, i: any) => s + (i.quantity_loaded ?? 0), 0);
  await supa.from("dispatches").update({ total_packages: Math.round(total), updated_at: new Date().toISOString() }).eq("id", dispatchId);
  await logAudit(req, "ADD_ITEM", "Dispatch", `Added item to manifest ID ${dispatchId}`, "dispatch", dispatchId);
  res.status(201).json(snakeToCamel(item));
});

router.post("/api/dispatch/:id/approve", requireAuth, async (req, res) => {
  const { data: row, error } = await supa.from("dispatches").update({ status: "Approved", approved_by: req.user!.userId, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", Number(req.params.id)).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "APPROVE", "Dispatch", `Approved dispatch ID ${req.params.id}`, "dispatch", (row as any).id);
  res.json(snakeToCamel(row));
});

router.post("/api/dispatch/:id/dispatch", requireAuth, async (req, res) => {
  const { data: row, error } = await supa.from("dispatches").update({ status: "In Transit", departed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", Number(req.params.id)).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  if ((row as any).vehicle_id) await supa.from("vehicles").update({ status: "InTransit" }).eq("id", (row as any).vehicle_id);
  await logAudit(req, "DISPATCH", "Dispatch", `Started dispatch ID ${req.params.id}`, "dispatch", (row as any).id);
  res.json(snakeToCamel(row));
});

router.post("/api/dispatch/:id/arrive", requireAuth, async (req, res) => {
  const { data: row, error } = await supa.from("dispatches").update({ status: "Arrived", arrived_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", Number(req.params.id)).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  if ((row as any).vehicle_id) await supa.from("vehicles").update({ status: "Active" }).eq("id", (row as any).vehicle_id);
  await logAudit(req, "ARRIVE", "Dispatch", `Marked dispatch ID ${req.params.id} arrived`, "dispatch", (row as any).id);
  res.json(snakeToCamel(row));
});

export default router;

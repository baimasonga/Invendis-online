import { Router } from "express";
import { supa, snakeToCamel, camelToSnake } from "../lib/supabase.js";
import { requireAuth, requireRoles } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { sendSms } from "../lib/sms.js";

const router = Router();

async function sendAllocationNotification(
  farmerId: number,
  campaignId: number,
  log: { warn: (obj: object, msg: string) => void }
): Promise<void> {
  try {
    const [
      { data: farmer },
      { data: campaign },
      { data: cItems },
    ] = await Promise.all([
      supa.from("farmers").select("first_name, last_name, farmer_group, phone, community_id").eq("id", farmerId).single(),
      supa.from("campaigns").select("name").eq("id", campaignId).single(),
      supa.from("campaign_items").select("quantity_per_farmer, input_item_id").eq("campaign_id", campaignId),
    ]);

    const f = farmer as any;
    if (!f?.phone) return;

    const farmerName = f.farmer_group || `${f.first_name ?? ""} ${f.last_name ?? ""}`.trim() || "Beneficiary";
    const campaignName = (campaign as any)?.name ?? "an upcoming campaign";

    // Resolve community name
    let communityName = "";
    if (f.community_id) {
      const { data: comm } = await supa.from("communities").select("name").eq("id", f.community_id).single();
      communityName = (comm as any)?.name ?? "";
    }

    // Build items list
    let itemsText = "inputs";
    if (cItems?.length) {
      const itemIds = (cItems as any[]).map(i => i.input_item_id).filter(Boolean);
      const { data: inputItems } = itemIds.length
        ? await supa.from("input_items").select("id,name,unit").in("id", itemIds)
        : { data: [] };
      const inputMap = Object.fromEntries((inputItems ?? []).map((ii: any) => [ii.id, ii]));
      const parts = (cItems as any[])
        .map(i => {
          const ii = inputMap[i.input_item_id];
          if (!ii) return null;
          const qty = i.quantity_per_farmer ?? 1;
          return `${ii.name} x${qty}${ii.unit ? " " + ii.unit : ""}`;
        })
        .filter(Boolean);
      if (parts.length) itemsText = parts.join(", ");
    }

    const communityPart = communityName ? ` in ${communityName}` : "";
    const msg = `Dear ${farmerName}, a delivery is coming to your community${communityPart} for ${campaignName}. You will receive: ${itemsText}. Please be available. — Invendis SL`;
    await sendSms(f.phone, msg);
  } catch (err: any) {
    log.warn({ err: err.message }, "Allocation announcement SMS failed");
  }
}

router.get("/api/campaigns", requireAuth, async (req, res) => {
  const { status, districtId, page = "1", limit = "20" } = req.query as Record<string, string>;
  const offset = (Number(page) - 1) * Number(limit);
  let q = supa.from("campaigns").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(offset, offset + Number(limit) - 1);
  if (status) q = q.eq("status", status) as typeof q;
  if (districtId) q = q.eq("district_id", Number(districtId)) as typeof q;
  const { data, count, error } = await q;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ data: snakeToCamel(data ?? []), total: count ?? 0, page: Number(page), limit: Number(limit) });
});

router.post("/api/campaigns", requireAuth, requireRoles("Admin", "ProjectManager"), async (req, res) => {
  const campaignCode = "CAM-" + Date.now().toString(36).toUpperCase();
  const body = camelToSnake(req.body);
  const { data, error } = await supa.from("campaigns").insert({ ...body, campaign_code: campaignCode, created_by: req.user!.userId }).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "CREATE", "Campaigns", `Created campaign: ${(data as any).name}`, "campaign", (data as any).id);
  res.status(201).json(snakeToCamel(data));
});

router.get("/api/campaigns/stats", requireAuth, async (_req, res) => {
  const { data } = await supa.from("campaigns").select("status,total_farmers,delivered_count");
  const rows = data ?? [];
  res.json({
    total: rows.length,
    active: rows.filter((r: any) => r.status === "Active").length,
    draft: rows.filter((r: any) => r.status === "Draft").length,
    completed: rows.filter((r: any) => r.status === "Completed").length,
    totalFarmers: rows.reduce((s: number, r: any) => s + (r.total_farmers ?? 0), 0),
    deliveredCount: rows.reduce((s: number, r: any) => s + (r.delivered_count ?? 0), 0),
  });
});

router.get("/api/campaigns/:id", requireAuth, async (req, res) => {
  const { data: row, error } = await supa.from("campaigns").select("*").eq("id", Number(req.params.id)).single();
  if (error || !row) { res.status(404).json({ error: "Not found" }); return; }
  const { data: items } = await supa.from("campaign_items").select("*").eq("campaign_id", (row as any).id);
  const itemIds = (items ?? []).map((i: any) => i.input_item_id).filter(Boolean);
  const { data: inputItems } = itemIds.length > 0
    ? await supa.from("input_items").select("id,name,unit").in("id", itemIds)
    : { data: [] };
  const itemMap = Object.fromEntries((inputItems ?? []).map((ii: any) => [ii.id, ii]));
  const mappedItems = (items ?? []).map((i: any) => ({
    ...snakeToCamel(i),
    inputItemName: itemMap[i.input_item_id]?.name ?? null,
    unit: itemMap[i.input_item_id]?.unit ?? null,
  }));
  res.json({ ...snakeToCamel(row), items: mappedItems });
});

router.put("/api/campaigns/:id", requireAuth, requireRoles("Admin", "ProjectManager"), async (req, res) => {
  const body = camelToSnake(req.body);
  const { data, error } = await supa.from("campaigns").update({ ...body, updated_at: new Date().toISOString() }).eq("id", Number(req.params.id)).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "UPDATE", "Campaigns", `Updated campaign ID ${req.params.id}`, "campaign", (data as any).id);
  res.json(snakeToCamel(data));
});

router.post("/api/campaigns/:id/approve", requireAuth, requireRoles("Admin", "ProjectManager"), async (req, res) => {
  const { data, error } = await supa.from("campaigns").update({ status: "Approved", approved_by: req.user!.userId, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", Number(req.params.id)).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "APPROVE", "Campaigns", `Approved campaign ID ${req.params.id}`, "campaign", (data as any).id);
  res.json(snakeToCamel(data));
});

router.post("/api/campaigns/:id/submit", requireAuth, requireRoles("Admin", "ProjectManager"), async (req, res) => {
  const { data, error } = await supa.from("campaigns").update({ status: "Submitted", updated_at: new Date().toISOString() }).eq("id", Number(req.params.id)).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "SUBMIT", "Campaigns", `Submitted campaign ID ${req.params.id}`, "campaign", (data as any).id);
  res.json(snakeToCamel(data));
});

// Allocations
router.get("/api/allocations", requireAuth, async (req, res) => {
  const { campaignId, page = "1", limit = "20" } = req.query as Record<string, string>;
  const offset = (Number(page) - 1) * Number(limit);
  let q = supa.from("allocations").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(offset, offset + Number(limit) - 1);
  if (campaignId) q = q.eq("campaign_id", Number(campaignId)) as typeof q;
  const { data, count, error } = await q;
  if (error) { res.status(500).json({ error: error.message }); return; }
  const farmerIds = [...new Set((data ?? []).map((r: any) => r.farmer_id).filter(Boolean))];
  const campaignIds = [...new Set((data ?? []).map((r: any) => r.campaign_id).filter(Boolean))];
  const [{ data: farmers }, { data: campaigns }] = await Promise.all([
    farmerIds.length > 0 ? supa.from("farmers").select("id,first_name,last_name,farmer_code").in("id", farmerIds) : { data: [] },
    campaignIds.length > 0 ? supa.from("campaigns").select("id,name").in("id", campaignIds) : { data: [] },
  ]);
  const farmerMap = Object.fromEntries((farmers ?? []).map((f: any) => [f.id, f]));
  const campaignMap = Object.fromEntries((campaigns ?? []).map((c: any) => [c.id, c]));
  const mapped = (data ?? []).map((r: any) => ({
    ...snakeToCamel(r),
    farmerName: farmerMap[r.farmer_id] ? `${farmerMap[r.farmer_id].first_name} ${farmerMap[r.farmer_id].last_name}` : null,
    farmerCode: farmerMap[r.farmer_id]?.farmer_code ?? null,
    campaignName: campaignMap[r.campaign_id]?.name ?? null,
  }));
  res.json({ data: mapped, total: count ?? 0, page: Number(page), limit: Number(limit) });
});

router.post("/api/allocations", requireAuth, requireRoles("Admin", "ProjectManager", "DistrictCoordinator"), async (req, res) => {
  const body = camelToSnake(req.body);
  const { data, error } = await supa.from("allocations").insert({ ...body, allocated_by: req.user!.userId }).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  // Update campaign allocated_farmers count
  const cid = req.body.campaignId;
  if (cid) {
    const { count } = await supa.from("allocations").select("*", { count: "exact", head: true }).eq("campaign_id", Number(cid));
    await supa.from("campaigns").update({ allocated_farmers: count ?? 0, updated_at: new Date().toISOString() }).eq("id", Number(cid));
  }
  await logAudit(req, "CREATE", "Allocations", `Allocated farmer ${req.body.farmerId} to campaign ${req.body.campaignId}`, "allocation", (data as any).id);
  // Send campaign announcement SMS to farmer (non-fatal)
  if (req.body.farmerId && cid) {
    sendAllocationNotification(Number(req.body.farmerId), Number(cid), req.log);
  }
  res.status(201).json(snakeToCamel(data));
});

router.post("/api/allocations/bulk", requireAuth, requireRoles("Admin", "ProjectManager", "DistrictCoordinator"), async (req, res) => {
  const { campaignId, farmerIds } = req.body as { campaignId: number; farmerIds: number[] };
  if (!Array.isArray(farmerIds) || farmerIds.length === 0) {
    res.status(400).json({ error: "farmerIds must be a non-empty array" });
    return;
  }
  const values = farmerIds.map((farmerId: number) => ({ campaign_id: campaignId, farmer_id: farmerId, allocated_by: req.user!.userId }));
  const { data, error } = await supa.from("allocations").insert(values).select();
  if (error) { res.status(500).json({ error: error.message }); return; }
  // Update campaign allocated_farmers count
  const { count } = await supa.from("allocations").select("*", { count: "exact", head: true }).eq("campaign_id", campaignId);
  await supa.from("campaigns").update({ allocated_farmers: count ?? 0, updated_at: new Date().toISOString() }).eq("id", campaignId);
  await logAudit(req, "BULK_ALLOCATE", "Allocations", `Bulk allocated ${farmerIds.length} farmers to campaign ${campaignId}`, "allocation", campaignId);
  // Send campaign announcement SMS to each farmer (non-fatal, fire-and-forget)
  for (const fid of farmerIds) {
    sendAllocationNotification(fid, campaignId, req.log);
  }
  res.status(201).json(snakeToCamel(data));
});

export default router;

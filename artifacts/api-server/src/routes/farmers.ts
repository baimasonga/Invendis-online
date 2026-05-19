import { Router } from "express";
import { supa, snakeToCamel, camelToSnake } from "../lib/supabase.js";
import { requireAuth } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { randomBytes } from "crypto";

const router = Router();

function generateFarmerCode() {
  return "FRM-" + Date.now().toString(36).toUpperCase() + randomBytes(2).toString("hex").toUpperCase();
}
function generateBarcode() {
  return "BC" + String(Date.now()).slice(-8).padStart(8, "0");
}

router.get("/api/farmers", requireAuth, async (req, res) => {
  const { page = "1", limit = "20", search, status, districtId, valueChainId } = req.query as Record<string, string>;
  const offset = (Number(page) - 1) * Number(limit);
  let q = supa.from("farmers").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(offset, offset + Number(limit) - 1);
  if (search) q = q.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,farmer_code.ilike.%${search}%`) as typeof q;
  if (status) q = q.eq("status", status) as typeof q;
  if (districtId) q = q.eq("district_id", Number(districtId)) as typeof q;
  if (valueChainId) q = q.eq("value_chain_id", Number(valueChainId)) as typeof q;
  const { data, count, error } = await q;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ data: snakeToCamel(data ?? []), total: count ?? 0, page: Number(page), limit: Number(limit) });
});

router.post("/api/farmers", requireAuth, async (req, res) => {
  const farmerCode = generateFarmerCode();
  const barcodeToken = generateBarcode();
  const body = camelToSnake(req.body);
  const { data, error } = await supa.from("farmers").insert({ ...body, farmer_code: farmerCode, barcode_token: barcodeToken, registered_by: req.user!.userId }).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "CREATE", "Farmers", `Registered farmer: ${(data as any).first_name} ${(data as any).last_name}`, "farmer", (data as any).id);
  res.status(201).json(snakeToCamel(data));
});

router.get("/api/farmers/stats", requireAuth, async (_req, res) => {
  const { data } = await supa.from("farmers").select("status,gender");
  const rows = data ?? [];
  const stats = {
    total: rows.length,
    approved: rows.filter((r: any) => r.status === "approved").length,
    pending: rows.filter((r: any) => r.status === "pending").length,
    rejected: rows.filter((r: any) => r.status === "rejected").length,
    male: rows.filter((r: any) => r.gender === "Male").length,
    female: rows.filter((r: any) => r.gender === "Female").length,
  };
  res.json(stats);
});

router.get("/api/farmers/barcode/:token", requireAuth, async (req, res) => {
  const { data: rows, error } = await supa.from("farmers").select("*").eq("barcode_token", req.params.token).limit(1);
  if (error || !rows?.length) { res.status(404).json({ error: "Farmer not found for this barcode" }); return; }
  res.json(snakeToCamel(rows[0]));
});

router.get("/api/farmers/:id", requireAuth, async (req, res) => {
  const { data: rows, error } = await supa.from("farmers").select("*").eq("id", Number(req.params.id)).limit(1);
  if (error || !rows?.length) { res.status(404).json({ error: "Not found" }); return; }
  res.json(snakeToCamel(rows[0]));
});

router.put("/api/farmers/:id", requireAuth, async (req, res) => {
  const body = camelToSnake(req.body);
  const { data, error } = await supa.from("farmers").update({ ...body, updated_at: new Date().toISOString() }).eq("id", Number(req.params.id)).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "UPDATE", "Farmers", `Updated farmer ID ${req.params.id}`, "farmer", (data as any).id);
  res.json(snakeToCamel(data));
});

router.post("/api/farmers/:id/approve", requireAuth, async (req, res) => {
  const { data, error } = await supa.from("farmers").update({ status: "approved", approved_by: req.user!.userId, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", Number(req.params.id)).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "APPROVE", "Farmers", `Approved farmer ID ${req.params.id}`, "farmer", (data as any).id);
  res.json(snakeToCamel(data));
});

router.post("/api/farmers/:id/reject", requireAuth, async (req, res) => {
  const { reason } = req.body;
  const { data, error } = await supa.from("farmers").update({ status: "rejected", rejection_reason: reason, updated_at: new Date().toISOString() }).eq("id", Number(req.params.id)).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "REJECT", "Farmers", `Rejected farmer ID ${req.params.id}: ${reason}`, "farmer", (data as any).id);
  res.json(snakeToCamel(data));
});

router.delete("/api/farmers/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { error } = await supa.from("farmers").delete().eq("id", id);
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "DELETE", "Farmers", `Deleted farmer ID ${id}`, "farmer", id);
  res.json({ success: true });
});

export default router;

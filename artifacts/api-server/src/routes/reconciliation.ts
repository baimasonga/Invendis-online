import { Router } from "express";
import { supa, snakeToCamel, camelToSnake } from "../lib/supabase.js";
import { requireAuth } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { randomBytes } from "crypto";

const router = Router();

router.get("/api/reconciliation", requireAuth, async (req, res) => {
  const { dispatchId, warehouseId, page = "1", limit = "20" } = req.query as Record<string, string>;
  const offset = (Number(page) - 1) * Number(limit);
  let q = supa.from("reconciliations").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(offset, offset + Number(limit) - 1);
  if (dispatchId) q = q.eq("dispatch_id", Number(dispatchId)) as typeof q;
  if (warehouseId) q = q.eq("warehouse_id", Number(warehouseId)) as typeof q;
  const { data, count, error } = await q;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ data: snakeToCamel(data ?? []), total: count ?? 0, page: Number(page), limit: Number(limit) });
});

router.post("/api/reconciliation", requireAuth, async (req, res) => {
  const reconciliationCode = "REC-" + randomBytes(3).toString("hex").toUpperCase();
  const { loadedQuantity, deliveredQuantity, returnedQuantity, damagedQuantity } = req.body;
  const varianceQuantity = (loadedQuantity || 0) - (deliveredQuantity || 0) - (returnedQuantity || 0) - (damagedQuantity || 0);
  const body = camelToSnake(req.body);
  const { data, error } = await supa.from("reconciliations").insert({ ...body, reconciliation_code: reconciliationCode, variance_quantity: varianceQuantity, created_by: req.user!.userId }).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "CREATE", "Reconciliation", `Created reconciliation: ${reconciliationCode}`, "reconciliation", (data as any).id);
  res.status(201).json(snakeToCamel(data));
});

router.post("/api/reconciliation/:id/approve", requireAuth, async (req, res) => {
  const { data, error } = await supa.from("reconciliations").update({ status: "Approved", approved_by: req.user!.userId, approved_at: new Date().toISOString() }).eq("id", Number(req.params.id)).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "APPROVE", "Reconciliation", `Approved reconciliation ID ${req.params.id}`, "reconciliation", (data as any).id);
  res.json(snakeToCamel(data));
});

router.post("/api/reconciliation/:id/reject", requireAuth, async (req, res) => {
  const { data, error } = await supa.from("reconciliations").update({ status: "Rejected" }).eq("id", Number(req.params.id)).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "REJECT", "Reconciliation", `Rejected reconciliation ID ${req.params.id}`, "reconciliation", (data as any).id);
  res.json(snakeToCamel(data));
});

export default router;

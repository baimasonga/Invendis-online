import { Router } from "express";
import { supa, snakeToCamel, camelToSnake } from "../lib/supabase.js";
import { requireAuth } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { randomBytes } from "crypto";

const router = Router();

router.get("/api/pod", requireAuth, async (req, res) => {
  const { campaignId, dispatchId, status, page = "1", limit = "20" } = req.query as Record<string, string>;
  const offset = (Number(page) - 1) * Number(limit);
  let q = supa.from("pod").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(offset, offset + Number(limit) - 1);
  if (campaignId) q = q.eq("campaign_id", Number(campaignId)) as typeof q;
  if (dispatchId) q = q.eq("dispatch_id", Number(dispatchId)) as typeof q;
  if (status) q = q.eq("status", status) as typeof q;
  const { data, count, error } = await q;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ data: snakeToCamel(data ?? []), total: count ?? 0, page: Number(page), limit: Number(limit) });
});

router.get("/api/pod/stats", requireAuth, async (_req, res) => {
  const { data } = await supa.from("pod").select("status");
  const rows = data ?? [];
  res.json({
    total: rows.length,
    verified: rows.filter((r: any) => r.status === "Verified").length,
    pending: rows.filter((r: any) => r.status === "Pending").length,
    exceptions: rows.filter((r: any) => !["Verified", "Pending"].includes(r.status)).length,
  });
});

router.get("/api/pod/:id", requireAuth, async (req, res) => {
  const { data: rows, error } = await supa.from("pod").select("*").eq("id", Number(req.params.id)).limit(1);
  if (error || !rows?.length) { res.status(404).json({ error: "Not found" }); return; }
  res.json(snakeToCamel(rows[0]));
});

router.post("/api/pod/submit", requireAuth, async (req, res) => {
  const podCode = "POD-" + randomBytes(4).toString("hex").toUpperCase();
  const body = camelToSnake(req.body) as Record<string, any>;

  let campaignId: number | null = body.campaign_id ?? null;

  if (!campaignId && body.dispatch_id) {
    const { data: dispatch } = await supa
      .from("dispatches")
      .select("campaign_id")
      .eq("id", Number(body.dispatch_id))
      .single();
    campaignId = (dispatch as any)?.campaign_id ?? null;
  }

  if (!campaignId) {
    const { data: first } = await supa.from("campaigns").select("id").order("id").limit(1).single();
    campaignId = (first as any)?.id ?? null;
  }

  if (!campaignId) {
    res.status(400).json({ error: "campaign_id is required and could not be resolved" });
    return;
  }

  const { data, error } = await supa.from("pod").insert({
    ...body,
    campaign_id: campaignId,
    pod_code: podCode,
    status: "Pending",
    submitted_at: new Date().toISOString(),
    field_officer_id: req.user!.userId,
  }).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "SUBMIT", "PoD", `Submitted PoD: ${podCode}`, "pod", (data as any).id);
  res.status(201).json(snakeToCamel(data));
});

router.post("/api/pod/:id/approve-exception", requireAuth, async (req, res) => {
  const { notes } = req.body;
  const { data, error } = await supa.from("pod").update({ status: "Verified", approved_by: req.user!.userId, approved_at: new Date().toISOString(), notes }).eq("id", Number(req.params.id)).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "APPROVE_EXCEPTION", "PoD", `Approved PoD exception ID ${req.params.id}`, "pod", (data as any).id);
  res.json(snakeToCamel(data));
});

export default router;

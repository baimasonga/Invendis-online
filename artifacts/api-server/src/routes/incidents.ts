import { Router } from "express";
import { supa, snakeToCamel, camelToSnake } from "../lib/supabase.js";
import { requireAuth } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { randomBytes } from "crypto";

const router = Router();

router.get("/api/incidents", requireAuth, async (req, res) => {
  const { status, type, page = "1", limit = "50" } = req.query as Record<string, string>;
  const offset = (Number(page) - 1) * Number(limit);
  let q = supa
    .from("incidents")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + Number(limit) - 1);
  if (status) q = q.eq("status", status) as typeof q;
  if (type) q = q.eq("type", type) as typeof q;
  const { data, count, error } = await q;
  if (error) { res.status(500).json({ error: error.message }); return; }
  const rows = data ?? [];
  const officerIds = [...new Set(rows.map((r: any) => r.field_officer_id).filter(Boolean))];
  const { data: officers } = officerIds.length
    ? await supa.from("users").select("id,full_name,username").in("id", officerIds)
    : { data: [] };
  const officerMap = Object.fromEntries((officers ?? []).map((u: any) => [u.id, u]));
  const result = rows.map((r: any) => ({
    ...snakeToCamel(r),
    officerName: officerMap[r.field_officer_id]?.full_name ?? r.reported_by ?? "Unknown",
  }));
  res.json({ data: result, total: count ?? 0, page: Number(page), limit: Number(limit) });
});

router.post("/api/incidents", requireAuth, async (req, res) => {
  const incidentCode = "INC-" + randomBytes(3).toString("hex").toUpperCase();
  const body = camelToSnake(req.body);
  const { data, error } = await supa.from("incidents").insert({
    ...body,
    incident_code: incidentCode,
    field_officer_id: req.user!.userId,
    reported_by: req.user!.username ?? req.user!.email,
    status: "Open",
  }).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "CREATE", "Incidents", `Reported incident: ${incidentCode}`, "incident", (data as any).id);
  res.status(201).json(snakeToCamel(data));
});

router.post("/api/incidents/bulk", requireAuth, async (req, res) => {
  const { incidents } = req.body as { incidents: any[] };
  if (!Array.isArray(incidents) || !incidents.length) {
    res.status(400).json({ error: "incidents array is required" }); return;
  }
  const rows = incidents.map((inc: any) => ({
    ...camelToSnake(inc),
    incident_code: inc.incidentCode ?? ("INC-" + randomBytes(3).toString("hex").toUpperCase()),
    field_officer_id: req.user!.userId,
    reported_by: inc.reportedBy ?? req.user!.username ?? req.user!.email,
    status: "Open",
  }));
  const { data, error } = await supa.from("incidents").upsert(rows, { onConflict: "incident_code" }).select();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json({ synced: (data ?? []).length });
});

router.patch("/api/incidents/:id/resolve", requireAuth, async (req, res) => {
  const { resolutionNotes } = req.body;
  const { data, error } = await supa.from("incidents")
    .update({ status: "Resolved", resolved_by: req.user!.userId, resolved_at: new Date().toISOString(), resolution_notes: resolutionNotes ?? null })
    .eq("id", Number(req.params.id)).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "UPDATE", "Incidents", `Resolved incident #${req.params.id}`, "incident", Number(req.params.id));
  res.json(snakeToCamel(data));
});

export default router;

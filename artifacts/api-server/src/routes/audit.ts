import { Router } from "express";
import { supa, snakeToCamel } from "../lib/supabase.js";
import { requireAuth, requireRoles, requireAnyAuth } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { canAssertAudit } from "../lib/audit-rules.js";

const router = Router();

// Browser clients cannot insert into audit_logs directly (INSERT is revoked for
// the authenticated role), so the portal reports its descriptive entries here.
// What may be reported is constrained by lib/audit-rules.ts — see the reasoning
// there; without that, any authenticated session could forge operational
// records into the log administrators rely on.
router.post("/api/audit", requireAnyAuth, async (req, res) => {
  const { action, module, description, entityType, entityId } = req.body as Record<string, unknown>;
  const act = String(action ?? "").toUpperCase().slice(0, 32);
  if (typeof module !== "string" || typeof description !== "string") {
    res.status(400).json({ error: "action, module and description are required" });
    return;
  }
  if (!canAssertAudit({ role: req.user?.role ?? req.supabaseUser?.role, module, action: act })) {
    res.status(403).json({
      error: "You may not record audit entries for this module.",
    });
    return;
  }
  const numericEntityId = entityId === null || entityId === undefined || entityId === "" ? undefined : Number(entityId);
  await logAudit(
    req, act, module.slice(0, 64), description.slice(0, 500),
    typeof entityType === "string" ? entityType.slice(0, 64) : undefined,
    Number.isFinite(numericEntityId) ? numericEntityId : undefined,
    // Flagged as client-asserted so monitoring can tell these apart from the
    // entries the server writes as a side effect of doing the work itself.
    { source: "web_portal", assertion: "client" },
  );
  res.status(201).json({ ok: true });
});

router.get("/api/audit", requireAuth, requireRoles("Admin", "ProjectManager"), async (req, res) => {
  const { module, action, userId, fromDate, toDate, page = "1", limit = "50" } = req.query as Record<string, string>;
  const offset = (Number(page) - 1) * Number(limit);
  const { search } = req.query as Record<string, string>;
  let q = supa.from("audit_logs").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(offset, offset + Number(limit) - 1);
  if (module)   q = q.eq("module", module) as typeof q;
  if (action)   q = q.eq("action", action) as typeof q;
  if (userId)   q = q.eq("user_id", Number(userId)) as typeof q;
  if (fromDate) q = q.gte("created_at", fromDate) as typeof q;
  if (toDate)   q = q.lte("created_at", toDate + "T23:59:59") as typeof q;
  if (search)   q = q.ilike("description", `%${search}%`) as typeof q;
  const { data, count, error } = await q;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ data: snakeToCamel(data ?? []), total: count ?? 0, page: Number(page), limit: Number(limit) });
});

export default router;

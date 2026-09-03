import { Router } from "express";
import { supa, snakeToCamel } from "../lib/supabase.js";
import { requireAuth, requireAnyAuth, requireRoles } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";

const router = Router();

const ALLOWED_ACTIONS = new Set([
  "CREATE", "UPDATE", "DELETE", "APPROVE", "REJECT", "DISPATCH",
  "ARRIVE", "RECEIVE", "SUBMIT", "ADD_ITEM", "BATCH_APPROVE", "LINK", "UNLINK",
]);

router.post("/api/audit", requireAnyAuth, async (req, res) => {
  const { action, module, description, entityType, entityId } = req.body ?? {};
  if (
    typeof action !== "string" || !ALLOWED_ACTIONS.has(action.toUpperCase()) ||
    typeof module !== "string" || module.length < 1 || module.length > 80 ||
    typeof description !== "string" || description.length < 1 || description.length > 500 ||
    (entityType != null && (typeof entityType !== "string" || entityType.length > 80)) ||
    (entityId != null && (!Number.isInteger(entityId) || entityId < 1))
  ) {
    res.status(400).json({ error: "Invalid audit event" });
    return;
  }
  await logAudit(
    req,
    action.toUpperCase(),
    module,
    description,
    entityType ?? undefined,
    entityId ?? undefined,
  );
  res.status(204).end();
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

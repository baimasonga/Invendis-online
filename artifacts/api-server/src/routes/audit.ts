import { Router } from "express";
import { supa, snakeToCamel } from "../lib/supabase.js";
import { requireAuth } from "../lib/auth.js";

const router = Router();

router.get("/api/audit", requireAuth, async (req, res) => {
  const { module, action, userId, fromDate, toDate, page = "1", limit = "50" } = req.query as Record<string, string>;
  const offset = (Number(page) - 1) * Number(limit);
  let q = supa.from("audit_logs").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(offset, offset + Number(limit) - 1);
  if (module) q = q.eq("module", module) as typeof q;
  if (action) q = q.eq("action", action) as typeof q;
  if (userId) q = q.eq("user_id", Number(userId)) as typeof q;
  if (fromDate) q = q.gte("created_at", fromDate) as typeof q;
  if (toDate) q = q.lte("created_at", toDate) as typeof q;
  const { data, count, error } = await q;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ data: snakeToCamel(data ?? []), total: count ?? 0, page: Number(page), limit: Number(limit) });
});

export default router;

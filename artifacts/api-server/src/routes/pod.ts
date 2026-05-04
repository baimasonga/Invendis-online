import { Router } from "express";
import { db, podTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { randomBytes } from "crypto";

const router = Router();

router.get("/api/pod", requireAuth, async (req, res) => {
  const { campaignId, dispatchId, status, page = "1", limit = "20" } = req.query as Record<string, string>;
  const offset = (Number(page) - 1) * Number(limit);
  const conditions = [];
  if (campaignId) conditions.push(eq(podTable.campaignId, Number(campaignId)));
  if (dispatchId) conditions.push(eq(podTable.dispatchId, Number(dispatchId)));
  if (status) conditions.push(eq(podTable.status, status));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(podTable).where(where);
  const rows = await db.select().from(podTable).where(where).orderBy(desc(podTable.createdAt)).limit(Number(limit)).offset(offset);
  res.json({ data: rows, total: Number(count), page: Number(page), limit: Number(limit) });
});

router.get("/api/pod/stats", requireAuth, async (_req, res) => {
  const [stats] = await db.select({
    total: sql<number>`count(*)`,
    verified: sql<number>`sum(case when ${podTable.status}='Verified' then 1 else 0 end)`,
    pending: sql<number>`sum(case when ${podTable.status}='Pending' then 1 else 0 end)`,
    exceptions: sql<number>`sum(case when ${podTable.status} not in ('Verified','Pending') then 1 else 0 end)`,
  }).from(podTable);
  res.json(stats);
});

router.get("/api/pod/:id", requireAuth, async (req, res) => {
  const [row] = await db.select().from(podTable).where(eq(podTable.id, Number(req.params.id))).limit(1);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.post("/api/pod/submit", requireAuth, async (req, res) => {
  const podCode = "POD-" + randomBytes(4).toString("hex").toUpperCase();
  const [row] = await db.insert(podTable).values({ ...req.body, podCode, status: "Pending", submittedAt: new Date(), fieldOfficerId: req.user!.userId }).returning();
  await logAudit(req, "SUBMIT", "PoD", `Submitted PoD: ${podCode}`, "pod", row.id);
  res.status(201).json(row);
});

router.post("/api/pod/:id/approve-exception", requireAuth, async (req, res) => {
  const { notes } = req.body;
  const [row] = await db.update(podTable).set({ status: "Verified", approvedBy: req.user!.userId, approvedAt: new Date(), notes })
    .where(eq(podTable.id, Number(req.params.id))).returning();
  await logAudit(req, "APPROVE_EXCEPTION", "PoD", `Approved PoD exception ID ${req.params.id}`, "pod", row.id);
  res.json(row);
});

export default router;

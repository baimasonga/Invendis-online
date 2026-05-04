import { Router } from "express";
import { db, campaignsTable, allocationsTable, farmersTable, campaignItemsTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";

const router = Router();

router.get("/api/campaigns", requireAuth, async (req, res) => {
  const { status, districtId, page = "1", limit = "20" } = req.query as Record<string, string>;
  const offset = (Number(page) - 1) * Number(limit);
  const conditions = [];
  if (status) conditions.push(eq(campaignsTable.status, status));
  if (districtId) conditions.push(eq(campaignsTable.districtId, Number(districtId)));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(campaignsTable).where(where);
  const rows = await db.select().from(campaignsTable).where(where).orderBy(desc(campaignsTable.createdAt)).limit(Number(limit)).offset(offset);
  res.json({ data: rows, total: Number(count), page: Number(page), limit: Number(limit) });
});

router.post("/api/campaigns", requireAuth, async (req, res) => {
  const campaignCode = "CAM-" + Date.now().toString(36).toUpperCase();
  const [row] = await db.insert(campaignsTable).values({ ...req.body, campaignCode, createdBy: req.user!.userId }).returning();
  await logAudit(req, "CREATE", "Campaigns", `Created campaign: ${row.name}`, "campaign", row.id);
  res.status(201).json(row);
});

router.get("/api/campaigns/stats", requireAuth, async (_req, res) => {
  const [stats] = await db.select({
    total: sql<number>`count(*)`,
    active: sql<number>`sum(case when ${campaignsTable.status}='Active' then 1 else 0 end)`,
    draft: sql<number>`sum(case when ${campaignsTable.status}='Draft' then 1 else 0 end)`,
    completed: sql<number>`sum(case when ${campaignsTable.status}='Completed' then 1 else 0 end)`,
    totalFarmers: sql<number>`coalesce(sum(${campaignsTable.totalFarmers}), 0)`,
    deliveredCount: sql<number>`coalesce(sum(${campaignsTable.deliveredCount}), 0)`,
  }).from(campaignsTable);
  res.json(stats);
});

router.get("/api/campaigns/:id", requireAuth, async (req, res) => {
  const [row] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, Number(req.params.id))).limit(1);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  const items = await db.select().from(campaignItemsTable).where(eq(campaignItemsTable.campaignId, row.id));
  res.json({ ...row, items });
});

router.put("/api/campaigns/:id", requireAuth, async (req, res) => {
  const [row] = await db.update(campaignsTable).set({ ...req.body, updatedAt: new Date() }).where(eq(campaignsTable.id, Number(req.params.id))).returning();
  await logAudit(req, "UPDATE", "Campaigns", `Updated campaign ID ${req.params.id}`, "campaign", row.id);
  res.json(row);
});

router.post("/api/campaigns/:id/approve", requireAuth, async (req, res) => {
  const [row] = await db.update(campaignsTable).set({ status: "Approved", approvedBy: req.user!.userId, approvedAt: new Date(), updatedAt: new Date() })
    .where(eq(campaignsTable.id, Number(req.params.id))).returning();
  await logAudit(req, "APPROVE", "Campaigns", `Approved campaign ID ${req.params.id}`, "campaign", row.id);
  res.json(row);
});

router.post("/api/campaigns/:id/submit", requireAuth, async (req, res) => {
  const [row] = await db.update(campaignsTable).set({ status: "Submitted", updatedAt: new Date() })
    .where(eq(campaignsTable.id, Number(req.params.id))).returning();
  await logAudit(req, "SUBMIT", "Campaigns", `Submitted campaign ID ${req.params.id}`, "campaign", row.id);
  res.json(row);
});

// Allocations
router.get("/api/allocations", requireAuth, async (req, res) => {
  const { campaignId, page = "1", limit = "20" } = req.query as Record<string, string>;
  const offset = (Number(page) - 1) * Number(limit);
  const conditions = [];
  if (campaignId) conditions.push(eq(allocationsTable.campaignId, Number(campaignId)));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(allocationsTable).where(where);
  const rows = await db.select().from(allocationsTable).where(where).orderBy(desc(allocationsTable.createdAt)).limit(Number(limit)).offset(offset);
  res.json({ data: rows, total: Number(count), page: Number(page), limit: Number(limit) });
});

router.post("/api/allocations", requireAuth, async (req, res) => {
  const [row] = await db.insert(allocationsTable).values({ ...req.body, allocatedBy: req.user!.userId }).returning();
  await logAudit(req, "CREATE", "Allocations", `Allocated farmer ${req.body.farmerId} to campaign ${req.body.campaignId}`, "allocation", row.id);
  res.status(201).json(row);
});

router.post("/api/allocations/bulk", requireAuth, async (req, res) => {
  const { campaignId, farmerIds } = req.body as { campaignId: number; farmerIds: number[] };
  if (!Array.isArray(farmerIds) || farmerIds.length === 0) {
    res.status(400).json({ error: "farmerIds must be a non-empty array" });
    return;
  }
  const values = farmerIds.map((farmerId: number) => ({ campaignId, farmerId, allocatedBy: req.user!.userId }));
  const rows = await db.insert(allocationsTable).values(values).returning();
  await logAudit(req, "BULK_ALLOCATE", "Allocations", `Bulk allocated ${farmerIds.length} farmers to campaign ${campaignId}`, "allocation", campaignId);
  res.status(201).json(rows);
});

export default router;

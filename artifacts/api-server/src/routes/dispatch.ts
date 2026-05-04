import { Router } from "express";
import { db, dispatchesTable, dispatchItemsTable, vehiclesTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";

const router = Router();

router.get("/api/dispatch", requireAuth, async (req, res) => {
  const { campaignId, status, page = "1", limit = "20" } = req.query as Record<string, string>;
  const offset = (Number(page) - 1) * Number(limit);
  const conditions = [];
  if (campaignId) conditions.push(eq(dispatchesTable.campaignId, Number(campaignId)));
  if (status) conditions.push(eq(dispatchesTable.status, status));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(dispatchesTable).where(where);
  const rows = await db.select().from(dispatchesTable).where(where).orderBy(desc(dispatchesTable.createdAt)).limit(Number(limit)).offset(offset);
  res.json({ data: rows, total: Number(count), page: Number(page), limit: Number(limit) });
});

router.post("/api/dispatch", requireAuth, async (req, res) => {
  const manifestCode = "MAN-" + Date.now().toString(36).toUpperCase();
  const [row] = await db.insert(dispatchesTable).values({ ...req.body, manifestCode, createdBy: req.user!.userId }).returning();
  await logAudit(req, "CREATE", "Dispatch", `Created dispatch manifest: ${manifestCode}`, "dispatch", row.id);
  res.status(201).json(row);
});

router.get("/api/dispatch/:id", requireAuth, async (req, res) => {
  const [row] = await db.select().from(dispatchesTable).where(eq(dispatchesTable.id, Number(req.params.id))).limit(1);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  const items = await db.select().from(dispatchItemsTable).where(eq(dispatchItemsTable.dispatchId, row.id));
  res.json({ ...row, items });
});

router.post("/api/dispatch/:id/approve", requireAuth, async (req, res) => {
  const [row] = await db.update(dispatchesTable).set({ status: "Approved", approvedBy: req.user!.userId, approvedAt: new Date(), updatedAt: new Date() })
    .where(eq(dispatchesTable.id, Number(req.params.id))).returning();
  await logAudit(req, "APPROVE", "Dispatch", `Approved dispatch ID ${req.params.id}`, "dispatch", row.id);
  res.json(row);
});

// OpenAPI spec uses /dispatch — same path used for "start dispatch" action
router.post("/api/dispatch/:id/dispatch", requireAuth, async (req, res) => {
  const [row] = await db.update(dispatchesTable).set({ status: "Dispatched", departedAt: new Date(), updatedAt: new Date() })
    .where(eq(dispatchesTable.id, Number(req.params.id))).returning();
  await db.update(vehiclesTable).set({ status: "InTransit" }).where(eq(vehiclesTable.id, row.vehicleId));
  await logAudit(req, "DISPATCH", "Dispatch", `Started dispatch ID ${req.params.id}`, "dispatch", row.id);
  res.json(row);
});

router.post("/api/dispatch/:id/arrive", requireAuth, async (req, res) => {
  const [row] = await db.update(dispatchesTable).set({ status: "Arrived", arrivedAt: new Date(), updatedAt: new Date() })
    .where(eq(dispatchesTable.id, Number(req.params.id))).returning();
  await db.update(vehiclesTable).set({ status: "Active" }).where(eq(vehiclesTable.id, row.vehicleId));
  await logAudit(req, "ARRIVE", "Dispatch", `Marked dispatch ID ${req.params.id} arrived`, "dispatch", row.id);
  res.json(row);
});

export default router;

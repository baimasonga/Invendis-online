import { Router } from "express";
import { db, reconciliationsTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { randomBytes } from "crypto";

const router = Router();

router.get("/api/reconciliation", requireAuth, async (req, res) => {
  const { dispatchId, warehouseId, page = "1", limit = "20" } = req.query as Record<string, string>;
  const offset = (Number(page) - 1) * Number(limit);
  const conditions = [];
  if (dispatchId) conditions.push(eq(reconciliationsTable.dispatchId, Number(dispatchId)));
  if (warehouseId) conditions.push(eq(reconciliationsTable.warehouseId, Number(warehouseId)));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(reconciliationsTable).where(where);
  const rows = await db.select().from(reconciliationsTable).where(where).orderBy(desc(reconciliationsTable.createdAt)).limit(Number(limit)).offset(offset);
  res.json({ data: rows, total: Number(count), page: Number(page), limit: Number(limit) });
});

router.post("/api/reconciliation", requireAuth, async (req, res) => {
  const reconciliationCode = "REC-" + randomBytes(3).toString("hex").toUpperCase();
  const { loadedQuantity, deliveredQuantity, returnedQuantity, damagedQuantity } = req.body;
  const varianceQuantity = (loadedQuantity || 0) - (deliveredQuantity || 0) - (returnedQuantity || 0) - (damagedQuantity || 0);
  const [row] = await db.insert(reconciliationsTable).values({ ...req.body, reconciliationCode, varianceQuantity, createdBy: req.user!.userId }).returning();
  await logAudit(req, "CREATE", "Reconciliation", `Created reconciliation: ${reconciliationCode}`, "reconciliation", row.id);
  res.status(201).json(row);
});

export default router;

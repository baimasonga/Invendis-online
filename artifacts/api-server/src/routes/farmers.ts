import { Router } from "express";
import { db, farmersTable, districtsTable, chiefdomsTable, valueChainsTable } from "@workspace/db";
import { eq, ilike, and, sql, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { randomBytes } from "crypto";

const router = Router();

function generateFarmerCode() {
  return "FRM-" + Date.now().toString(36).toUpperCase() + randomBytes(2).toString("hex").toUpperCase();
}
function generateBarcode() {
  return randomBytes(8).toString("hex").toUpperCase();
}

router.get("/api/farmers", requireAuth, async (req, res) => {
  const { page = "1", limit = "20", search, status, districtId, valueChainId } = req.query as Record<string, string>;
  const offset = (Number(page) - 1) * Number(limit);

  const conditions = [];
  if (search) conditions.push(ilike(farmersTable.firstName, `%${search}%`));
  if (status) conditions.push(eq(farmersTable.status, status));
  if (districtId) conditions.push(eq(farmersTable.districtId, Number(districtId)));
  if (valueChainId) conditions.push(eq(farmersTable.valueChainId, Number(valueChainId)));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(farmersTable).where(where);
  const rows = await db.select().from(farmersTable).where(where).orderBy(desc(farmersTable.createdAt)).limit(Number(limit)).offset(offset);

  res.json({ data: rows, total: Number(count), page: Number(page), limit: Number(limit) });
});

router.post("/api/farmers", requireAuth, async (req, res) => {
  const data = req.body;
  const farmerCode = generateFarmerCode();
  const barcodeToken = generateBarcode();
  const [row] = await db.insert(farmersTable).values({ ...data, farmerCode, barcodeToken, registeredBy: req.user!.userId }).returning();
  await logAudit(req, "CREATE", "Farmers", `Registered farmer: ${row.firstName} ${row.lastName}`, "farmer", row.id);
  res.status(201).json(row);
});

router.get("/api/farmers/stats", requireAuth, async (_req, res) => {
  const [stats] = await db.select({
    total: sql<number>`count(*)`,
    approved: sql<number>`sum(case when ${farmersTable.status}='approved' then 1 else 0 end)`,
    pending: sql<number>`sum(case when ${farmersTable.status}='pending' then 1 else 0 end)`,
    rejected: sql<number>`sum(case when ${farmersTable.status}='rejected' then 1 else 0 end)`,
    male: sql<number>`sum(case when ${farmersTable.gender}='Male' then 1 else 0 end)`,
    female: sql<number>`sum(case when ${farmersTable.gender}='Female' then 1 else 0 end)`,
  }).from(farmersTable);
  res.json(stats);
});

router.get("/api/farmers/barcode/:token", requireAuth, async (req, res) => {
  const [row] = await db.select().from(farmersTable).where(eq(farmersTable.barcodeToken, req.params.token)).limit(1);
  if (!row) { res.status(404).json({ error: "Farmer not found for this barcode" }); return; }
  res.json(row);
});

router.get("/api/farmers/:id", requireAuth, async (req, res) => {
  const [row] = await db.select().from(farmersTable).where(eq(farmersTable.id, Number(req.params.id))).limit(1);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.put("/api/farmers/:id", requireAuth, async (req, res) => {
  const [row] = await db.update(farmersTable).set({ ...req.body, updatedAt: new Date() }).where(eq(farmersTable.id, Number(req.params.id))).returning();
  await logAudit(req, "UPDATE", "Farmers", `Updated farmer ID ${req.params.id}`, "farmer", row.id);
  res.json(row);
});

router.post("/api/farmers/:id/approve", requireAuth, async (req, res) => {
  const [row] = await db.update(farmersTable).set({ status: "approved", approvedBy: req.user!.userId, approvedAt: new Date(), updatedAt: new Date() })
    .where(eq(farmersTable.id, Number(req.params.id))).returning();
  await logAudit(req, "APPROVE", "Farmers", `Approved farmer ID ${req.params.id}`, "farmer", row.id);
  res.json(row);
});

router.post("/api/farmers/:id/reject", requireAuth, async (req, res) => {
  const { reason } = req.body;
  const [row] = await db.update(farmersTable).set({ status: "rejected", rejectionReason: reason, updatedAt: new Date() })
    .where(eq(farmersTable.id, Number(req.params.id))).returning();
  await logAudit(req, "REJECT", "Farmers", `Rejected farmer ID ${req.params.id}: ${reason}`, "farmer", row.id);
  res.json(row);
});

export default router;

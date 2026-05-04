import { Router } from "express";
import { db, farmersTable, podTable, stockLedgerTable, campaignsTable, allocationsTable, dispatchesTable } from "@workspace/db";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";

const router = Router();

router.get("/api/reports/farmer-beneficiary", requireAuth, async (req, res) => {
  const { campaignId, districtId, fromDate, toDate } = req.query as Record<string, string>;
  const conditions = [];
  if (campaignId) conditions.push(eq(allocationsTable.campaignId, Number(campaignId)));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const rows = await db.select({
    farmerId: farmersTable.id,
    farmerCode: farmersTable.farmerCode,
    firstName: farmersTable.firstName,
    lastName: farmersTable.lastName,
    gender: farmersTable.gender,
    phone: farmersTable.phone,
    districtId: farmersTable.districtId,
    valueChainId: farmersTable.valueChainId,
    campaignId: allocationsTable.campaignId,
    allocationStatus: allocationsTable.status,
  }).from(allocationsTable)
    .innerJoin(farmersTable, eq(allocationsTable.farmerId, farmersTable.id))
    .where(where)
    .orderBy(farmersTable.lastName);
  res.json({ data: rows, total: rows.length });
});

router.get("/api/reports/stock-movement", requireAuth, async (req, res) => {
  const { warehouseId, inputItemId, fromDate, toDate } = req.query as Record<string, string>;
  const conditions = [];
  if (warehouseId) conditions.push(eq(stockLedgerTable.warehouseId, Number(warehouseId)));
  if (inputItemId) conditions.push(eq(stockLedgerTable.inputItemId, Number(inputItemId)));
  if (fromDate) conditions.push(gte(stockLedgerTable.createdAt, new Date(fromDate)));
  if (toDate) conditions.push(lte(stockLedgerTable.createdAt, new Date(toDate)));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const rows = await db.select().from(stockLedgerTable).where(where).orderBy(desc(stockLedgerTable.createdAt));
  res.json({ data: rows, total: rows.length });
});

router.get("/api/reports/distribution", requireAuth, async (req, res) => {
  const { campaignId, districtId, fromDate, toDate } = req.query as Record<string, string>;
  const conditions = [];
  if (campaignId) conditions.push(eq(dispatchesTable.campaignId, Number(campaignId)));
  if (fromDate) conditions.push(gte(dispatchesTable.createdAt, new Date(fromDate)));
  if (toDate) conditions.push(lte(dispatchesTable.createdAt, new Date(toDate)));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const rows = await db.select({
    dispatchId: dispatchesTable.id,
    manifestCode: dispatchesTable.manifestCode,
    campaignId: dispatchesTable.campaignId,
    status: dispatchesTable.status,
    totalPackages: dispatchesTable.totalPackages,
    deliveredPackages: dispatchesTable.deliveredPackages,
    departedAt: dispatchesTable.departedAt,
    arrivedAt: dispatchesTable.arrivedAt,
  }).from(dispatchesTable).where(where).orderBy(desc(dispatchesTable.createdAt));
  res.json({ data: rows, total: rows.length });
});

export default router;

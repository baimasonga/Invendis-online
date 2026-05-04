import { Router } from "express";
import { db, farmersTable, campaignsTable, podTable, vehiclesTable, stockBalanceTable, dispatchesTable, auditLogsTable } from "@workspace/db";
import { eq, sql, desc, gte } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";

const router = Router();

router.get("/api/dashboard/summary", requireAuth, async (_req, res) => {
  const [farmerStats] = await db.select({
    total: sql<number>`count(*)`,
    approved: sql<number>`sum(case when ${farmersTable.status} = 'approved' then 1 else 0 end)`,
    pending: sql<number>`sum(case when ${farmersTable.status} = 'pending' then 1 else 0 end)`,
  }).from(farmersTable);

  const [stockStats] = await db.select({
    totalStock: sql<number>`coalesce(sum(${stockBalanceTable.available}), 0)`,
    distributed: sql<number>`coalesce(sum(${stockBalanceTable.delivered}), 0)`,
  }).from(stockBalanceTable);

  const [podStats] = await db.select({
    pending: sql<number>`sum(case when ${podTable.status} = 'Pending' then 1 else 0 end)`,
    exceptions: sql<number>`sum(case when ${podTable.status} not in ('Verified','Pending') then 1 else 0 end)`,
  }).from(podTable);

  const [vehicleStats] = await db.select({
    active: sql<number>`sum(case when ${vehiclesTable.status} = 'InTransit' then 1 else 0 end)`,
  }).from(vehiclesTable);

  res.json({
    totalFarmers: Number(farmerStats?.total ?? 0),
    approvedFarmers: Number(farmerStats?.approved ?? 0),
    pendingFarmers: Number(farmerStats?.pending ?? 0),
    totalStock: Number(stockStats?.totalStock ?? 0),
    distributedInputs: Number(stockStats?.distributed ?? 0),
    pendingPod: Number(podStats?.pending ?? 0),
    exceptions: Number(podStats?.exceptions ?? 0),
    activeVehicles: Number(vehicleStats?.active ?? 0),
  });
});

router.get("/api/dashboard/charts", requireAuth, async (_req, res) => {
  const campaignsByStatus = await db.select({
    status: campaignsTable.status,
    count: sql<number>`count(*)`,
  }).from(campaignsTable).groupBy(campaignsTable.status);

  const podByStatus = await db.select({
    status: podTable.status,
    count: sql<number>`count(*)`,
  }).from(podTable).groupBy(podTable.status);

  res.json({ campaignsByStatus, podByStatus });
});

router.get("/api/dashboard/recent-activity", requireAuth, async (_req, res) => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const logs = await db.select().from(auditLogsTable)
    .where(gte(auditLogsTable.createdAt, sevenDaysAgo))
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(20);
  res.json(logs.map(l => ({ id: l.id, action: l.action, module: l.module, description: l.description, username: l.username, createdAt: l.createdAt })));
});

export default router;

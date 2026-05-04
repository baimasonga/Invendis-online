import { Router } from "express";
import { db, districtsTable, chiefdomsTable, sectionsTable, communitiesTable, valueChainsTable, warehousesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";

const router = Router();

// Districts
router.get("/api/master-data/districts", requireAuth, async (_req, res) => {
  const rows = await db.select().from(districtsTable).orderBy(districtsTable.name);
  res.json(rows);
});
router.post("/api/master-data/districts", requireAuth, async (req, res) => {
  const { name, code } = req.body;
  const [row] = await db.insert(districtsTable).values({ name, code }).returning();
  await logAudit(req, "CREATE", "MasterData", `Created district: ${name}`, "district", row.id);
  res.status(201).json(row);
});

// Chiefdoms
router.get("/api/master-data/chiefdoms", requireAuth, async (req, res) => {
  const { districtId } = req.query;
  let q = db.select().from(chiefdomsTable);
  if (districtId) q = q.where(eq(chiefdomsTable.districtId, Number(districtId))) as typeof q;
  res.json(await q.orderBy(chiefdomsTable.name));
});

// Sections
router.get("/api/master-data/sections", requireAuth, async (req, res) => {
  const { chiefdomId } = req.query;
  let q = db.select().from(sectionsTable);
  if (chiefdomId) q = q.where(eq(sectionsTable.chiefdomId, Number(chiefdomId))) as typeof q;
  res.json(await q.orderBy(sectionsTable.name));
});

// Communities
router.get("/api/master-data/communities", requireAuth, async (req, res) => {
  const { sectionId } = req.query;
  let q = db.select().from(communitiesTable);
  if (sectionId) q = q.where(eq(communitiesTable.sectionId, Number(sectionId))) as typeof q;
  res.json(await q.orderBy(communitiesTable.name));
});

// Value Chains
router.get("/api/master-data/value-chains", requireAuth, async (_req, res) => {
  res.json(await db.select().from(valueChainsTable).orderBy(valueChainsTable.name));
});
router.post("/api/master-data/value-chains", requireAuth, async (req, res) => {
  const { name, description } = req.body;
  const [row] = await db.insert(valueChainsTable).values({ name, description }).returning();
  await logAudit(req, "CREATE", "MasterData", `Created value chain: ${name}`, "value_chain", row.id);
  res.status(201).json(row);
});

// Warehouses
router.get("/api/master-data/warehouses", requireAuth, async (_req, res) => {
  res.json(await db.select().from(warehousesTable).orderBy(warehousesTable.name));
});
router.post("/api/master-data/warehouses", requireAuth, async (req, res) => {
  const { name, code, districtId, address, latitude, longitude } = req.body;
  const [row] = await db.insert(warehousesTable).values({ name, code, districtId, address, latitude, longitude }).returning();
  await logAudit(req, "CREATE", "MasterData", `Created warehouse: ${name}`, "warehouse", row.id);
  res.status(201).json(row);
});

export default router;

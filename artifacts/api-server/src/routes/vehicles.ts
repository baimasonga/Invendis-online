import { Router } from "express";
import { db, vehiclesTable, driversTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { randomBytes } from "crypto";

const router = Router();

router.get("/api/vehicles", requireAuth, async (_req, res) => {
  res.json(await db.select().from(vehiclesTable).orderBy(desc(vehiclesTable.createdAt)));
});
router.post("/api/vehicles", requireAuth, async (req, res) => {
  const vehicleCode = "VEH-" + randomBytes(3).toString("hex").toUpperCase();
  const [row] = await db.insert(vehiclesTable).values({ ...req.body, vehicleCode }).returning();
  await logAudit(req, "CREATE", "Vehicles", `Created vehicle: ${row.plateNumber}`, "vehicle", row.id);
  res.status(201).json(row);
});

// Drivers — must be defined BEFORE /:id to avoid route shadowing
router.get("/api/vehicles/drivers", requireAuth, async (_req, res) => {
  res.json(await db.select().from(driversTable).orderBy(driversTable.fullName));
});
router.post("/api/vehicles/drivers", requireAuth, async (req, res) => {
  const driverCode = "DRV-" + randomBytes(3).toString("hex").toUpperCase();
  const [row] = await db.insert(driversTable).values({ ...req.body, driverCode }).returning();
  await logAudit(req, "CREATE", "Vehicles", `Created driver: ${row.fullName}`, "driver", row.id);
  res.status(201).json(row);
});

router.get("/api/vehicles/:id", requireAuth, async (req, res) => {
  const [row] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, Number(req.params.id))).limit(1);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

export default router;

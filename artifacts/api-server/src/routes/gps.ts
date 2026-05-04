import { Router } from "express";
import { db, gpsTrackTable, vehiclesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";

const router = Router();

router.post("/api/gps/ping", requireAuth, async (req, res) => {
  const { vehicleId, dispatchId, latitude, longitude, speed, heading, accuracy } = req.body;
  await db.insert(gpsTrackTable).values({ vehicleId, dispatchId, latitude, longitude, speed, heading, accuracy });
  await db.update(vehiclesTable).set({ lastLatitude: latitude, lastLongitude: longitude, lastPing: new Date() })
    .where(eq(vehiclesTable.id, vehicleId));
  res.json({ success: true });
});

router.get("/api/gps/vehicles", requireAuth, async (_req, res) => {
  const vehicles = await db.select().from(vehiclesTable).where(eq(vehiclesTable.status, "InTransit"));
  res.json(vehicles);
});

router.get("/api/gps/track/:vehicleId", requireAuth, async (req, res) => {
  const { from, to, limit = "100" } = req.query as Record<string, string>;
  const rows = await db.select().from(gpsTrackTable)
    .where(eq(gpsTrackTable.vehicleId, Number(req.params.vehicleId)))
    .orderBy(desc(gpsTrackTable.recordedAt))
    .limit(Number(limit));
  res.json(rows.reverse());
});

export default router;

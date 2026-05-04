import { Router } from "express";
import { supa, snakeToCamel } from "../lib/supabase.js";
import { requireAuth } from "../lib/auth.js";

const router = Router();

router.post("/api/gps/ping", requireAuth, async (req, res) => {
  const { vehicleId, dispatchId, latitude, longitude, speed, heading, accuracy } = req.body;
  await supa.from("gps_track").insert({ vehicle_id: vehicleId, dispatch_id: dispatchId ?? null, latitude, longitude, speed: speed ?? null, heading: heading ?? null, accuracy: accuracy ?? null });
  await supa.from("vehicles").update({ last_latitude: latitude, last_longitude: longitude, last_ping: new Date().toISOString() }).eq("id", vehicleId);
  res.json({ success: true });
});

router.get("/api/gps/vehicles", requireAuth, async (_req, res) => {
  const { data, error } = await supa.from("vehicles").select("*").eq("status", "InTransit");
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(snakeToCamel(data ?? []));
});

router.get("/api/gps/track/:vehicleId", requireAuth, async (req, res) => {
  const { limit = "100" } = req.query as Record<string, string>;
  const { data, error } = await supa.from("gps_track").select("*").eq("vehicle_id", Number(req.params.vehicleId)).order("recorded_at", { ascending: false }).limit(Number(limit));
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(snakeToCamel((data ?? []).reverse()));
});

export default router;

import { Router } from "express";
import { supa, snakeToCamel, camelToSnake } from "../lib/supabase.js";
import { requireAuth } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { randomBytes } from "crypto";

const router = Router();

router.get("/api/vehicles", requireAuth, async (req, res) => {
  const { page = "1", limit = "20" } = req.query as Record<string, string>;
  const offset = (Number(page) - 1) * Number(limit);
  const { data, count, error } = await supa.from("vehicles").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(offset, offset + Number(limit) - 1);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ data: snakeToCamel(data ?? []), total: count ?? 0 });
});

router.post("/api/vehicles", requireAuth, async (req, res) => {
  const vehicleCode = "VEH-" + randomBytes(3).toString("hex").toUpperCase();
  const body = camelToSnake(req.body);
  const { data, error } = await supa.from("vehicles").insert({ ...body, vehicle_code: vehicleCode }).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "CREATE", "Vehicles", `Created vehicle: ${(data as any).plate_number}`, "vehicle", (data as any).id);
  res.status(201).json(snakeToCamel(data));
});

router.get("/api/vehicles/drivers", requireAuth, async (_req, res) => {
  const { data, error } = await supa.from("drivers").select("*").order("full_name");
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(snakeToCamel(data ?? []));
});

router.post("/api/vehicles/drivers", requireAuth, async (req, res) => {
  const driverCode = "DRV-" + randomBytes(3).toString("hex").toUpperCase();
  const body = camelToSnake(req.body);
  const { data, error } = await supa.from("drivers").insert({ ...body, driver_code: driverCode }).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "CREATE", "Vehicles", `Created driver: ${(data as any).full_name}`, "driver", (data as any).id);
  res.status(201).json(snakeToCamel(data));
});

router.get("/api/vehicles/:id", requireAuth, async (req, res) => {
  const { data: rows, error } = await supa.from("vehicles").select("*").eq("id", Number(req.params.id)).limit(1);
  if (error || !rows?.length) { res.status(404).json({ error: "Not found" }); return; }
  res.json(snakeToCamel(rows[0]));
});

export default router;

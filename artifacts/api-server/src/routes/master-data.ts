import { Router } from "express";
import { supa, snakeToCamel } from "../lib/supabase.js";
import { requireAuth } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";

const router = Router();

router.get("/api/master-data/districts", requireAuth, async (_req, res) => {
  const { data, error } = await supa.from("districts").select("*").order("name");
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(snakeToCamel(data ?? []));
});
router.post("/api/master-data/districts", requireAuth, async (req, res) => {
  const { name, code } = req.body;
  const { data, error } = await supa.from("districts").insert({ name, code }).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "CREATE", "MasterData", `Created district: ${name}`, "district", (data as any).id);
  res.status(201).json(snakeToCamel(data));
});

router.get("/api/master-data/chiefdoms", requireAuth, async (req, res) => {
  const { districtId } = req.query;
  let q = supa.from("chiefdoms").select("*").order("name");
  if (districtId) q = q.eq("district_id", Number(districtId)) as typeof q;
  const { data, error } = await q;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(snakeToCamel(data ?? []));
});

router.get("/api/master-data/sections", requireAuth, async (req, res) => {
  const { chiefdomId } = req.query;
  let q = supa.from("sections").select("*").order("name");
  if (chiefdomId) q = q.eq("chiefdom_id", Number(chiefdomId)) as typeof q;
  const { data, error } = await q;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(snakeToCamel(data ?? []));
});

router.get("/api/master-data/communities", requireAuth, async (req, res) => {
  const { sectionId } = req.query;
  let q = supa.from("communities").select("*").order("name");
  if (sectionId) q = q.eq("section_id", Number(sectionId)) as typeof q;
  const { data, error } = await q;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(snakeToCamel(data ?? []));
});

router.get("/api/master-data/value-chains", requireAuth, async (_req, res) => {
  const { data, error } = await supa.from("value_chains").select("*").order("name");
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(snakeToCamel(data ?? []));
});
router.post("/api/master-data/value-chains", requireAuth, async (req, res) => {
  const { name, description } = req.body;
  const { data, error } = await supa.from("value_chains").insert({ name, description }).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "CREATE", "MasterData", `Created value chain: ${name}`, "value_chain", (data as any).id);
  res.status(201).json(snakeToCamel(data));
});

router.get("/api/master-data/warehouses", requireAuth, async (_req, res) => {
  const { data, error } = await supa.from("warehouses").select("*").order("name");
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(snakeToCamel(data ?? []));
});
router.post("/api/master-data/warehouses", requireAuth, async (req, res) => {
  const { name, code, districtId, address, latitude, longitude } = req.body;
  const { data, error } = await supa.from("warehouses").insert({ name, code, district_id: districtId ?? null, address: address ?? null, latitude: latitude ?? null, longitude: longitude ?? null }).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "CREATE", "MasterData", `Created warehouse: ${name}`, "warehouse", (data as any).id);
  res.status(201).json(snakeToCamel(data));
});

export default router;

import { Router } from "express";
import { supa, snakeToCamel } from "../lib/supabase.js";
import { requireAuth, requireAnyAuth, requireRoleIfJwt } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";

const router = Router();

// ── Districts ─────────────────────────────────────────────────────────────────
router.get("/api/master-data/districts", requireAnyAuth, async (_req, res) => {
  const { data, error } = await supa.from("districts").select("*").order("name");
  if (error) { res.status(500).json({ error: error.message }); return; }
  // Merge in static coordinates (lat/lng stored in-code, not in DB)
  const { DISTRICT_COORDS } = await import("../lib/district-coords.js");
  const rows = (snakeToCamel(data ?? []) as any[]).map((d: any) => {
    const coords = DISTRICT_COORDS[d.id];
    return coords ? { ...d, latitude: coords.lat, longitude: coords.lng } : d;
  });
  res.json(rows);
});
router.post("/api/master-data/districts", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager"), async (req, res) => {
  const { name, code } = req.body;
  if (!name || !code) { res.status(400).json({ error: "name and code are required" }); return; }
  const { data, error } = await supa.from("districts").insert({ name, code }).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "CREATE", "MasterData", `Created district: ${name}`, "district", (data as any).id);
  res.status(201).json(snakeToCamel(data));
});
router.put("/api/master-data/districts/:id", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager"), async (req, res) => {
  const { name, code } = req.body;
  if (!name || !code) { res.status(400).json({ error: "name and code are required" }); return; }
  const { data, error } = await supa.from("districts").update({ name, code }).eq("id", Number(req.params.id)).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "UPDATE", "MasterData", `Updated district: ${name}`, "district", Number(req.params.id));
  res.json(snakeToCamel(data));
});
router.delete("/api/master-data/districts/:id", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager"), async (req, res) => {
  const id = Number(req.params.id);
  const { error } = await supa.from("districts").delete().eq("id", id);
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "DELETE", "MasterData", `Deleted district ID ${id}`, "district", id);
  res.json({ success: true });
});

// ── Chiefdoms ─────────────────────────────────────────────────────────────────
router.get("/api/master-data/chiefdoms", requireAnyAuth, async (req, res) => {
  const { districtId } = req.query;
  let q = supa.from("chiefdoms").select("*").order("name");
  if (districtId) q = q.eq("district_id", Number(districtId)) as typeof q;
  const { data, error } = await q;
  if (error) { res.status(500).json({ error: error.message }); return; }
  const rows = data ?? [];
  const distIds = [...new Set(rows.map((r: any) => r.district_id).filter(Boolean))];
  let distMap: Record<number, string> = {};
  if (distIds.length) {
    const { data: dists } = await supa.from("districts").select("id,name").in("id", distIds);
    (dists ?? []).forEach((d: any) => { distMap[d.id] = d.name; });
  }
  res.json(snakeToCamel(rows.map((r: any) => ({ ...r, district_name: distMap[r.district_id] ?? null }))));
});
router.post("/api/master-data/chiefdoms", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager"), async (req, res) => {
  const { name, districtId } = req.body;
  if (!name || !districtId) { res.status(400).json({ error: "name and districtId are required" }); return; }
  const { data, error } = await supa.from("chiefdoms").insert({ name, district_id: districtId }).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "CREATE", "MasterData", `Created chiefdom: ${name}`, "chiefdom", (data as any).id);
  res.status(201).json(snakeToCamel(data));
});
router.put("/api/master-data/chiefdoms/:id", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager"), async (req, res) => {
  const { name, districtId } = req.body;
  const { data, error } = await supa.from("chiefdoms").update({ name, district_id: districtId }).eq("id", Number(req.params.id)).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(snakeToCamel(data));
});
router.delete("/api/master-data/chiefdoms/:id", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager"), async (req, res) => {
  const { error } = await supa.from("chiefdoms").delete().eq("id", Number(req.params.id));
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ success: true });
});

// ── Sections / Communities ────────────────────────────────────────────────────
router.get("/api/master-data/sections", requireAnyAuth, async (req, res) => {
  const { chiefdomId } = req.query;
  let q = supa.from("sections").select("*").order("name");
  if (chiefdomId) q = q.eq("chiefdom_id", Number(chiefdomId)) as typeof q;
  const { data, error } = await q;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(snakeToCamel(data ?? []));
});
router.get("/api/master-data/communities", requireAnyAuth, async (req, res) => {
  const { sectionId } = req.query;
  let q = supa.from("communities").select("*").order("name");
  if (sectionId) q = q.eq("section_id", Number(sectionId)) as typeof q;
  const { data, error } = await q;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(snakeToCamel(data ?? []));
});

// ── Value Chains ──────────────────────────────────────────────────────────────
router.get("/api/master-data/value-chains", requireAnyAuth, async (_req, res) => {
  const { data, error } = await supa.from("value_chains").select("*").order("name");
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(snakeToCamel(data ?? []));
});
router.post("/api/master-data/value-chains", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager"), async (req, res) => {
  const { name, description } = req.body;
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  const { data, error } = await supa.from("value_chains").insert({ name, description, is_active: 1 }).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "CREATE", "MasterData", `Created value chain: ${name}`, "value_chain", (data as any).id);
  res.status(201).json(snakeToCamel(data));
});
router.put("/api/master-data/value-chains/:id", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager"), async (req, res) => {
  const { name, description } = req.body;
  const { data, error } = await supa.from("value_chains").update({ name, description }).eq("id", Number(req.params.id)).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(snakeToCamel(data));
});
router.patch("/api/master-data/value-chains/:id/toggle", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager"), async (req, res) => {
  const { data: cur, error: e1 } = await supa.from("value_chains").select("is_active").eq("id", Number(req.params.id)).single();
  if (e1) { res.status(500).json({ error: e1.message }); return; }
  const next = (cur as any).is_active ? 0 : 1;
  const { data, error } = await supa.from("value_chains").update({ is_active: next }).eq("id", Number(req.params.id)).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(snakeToCamel(data));
});

// ── Warehouses ────────────────────────────────────────────────────────────────
router.get("/api/master-data/warehouses", requireAnyAuth, async (_req, res) => {
  const { data, error } = await supa.from("warehouses").select("*").order("name");
  if (error) { res.status(500).json({ error: error.message }); return; }
  const rows = data ?? [];
  const distIds = [...new Set(rows.map((r: any) => r.district_id).filter(Boolean))];
  let distMap: Record<number, string> = {};
  if (distIds.length) {
    const { data: dists } = await supa.from("districts").select("id,name").in("id", distIds);
    (dists ?? []).forEach((d: any) => { distMap[d.id] = d.name; });
  }
  res.json(snakeToCamel(rows.map((r: any) => ({ ...r, district_name: distMap[r.district_id] ?? null }))));
});
router.post("/api/master-data/warehouses", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager"), async (req, res) => {
  const { name, code, districtId, address, latitude, longitude } = req.body;
  if (!name || !code) { res.status(400).json({ error: "name and code are required" }); return; }
  const { data, error } = await supa.from("warehouses")
    .insert({ name, code, district_id: districtId ?? null, address: address ?? null, latitude: latitude ?? null, longitude: longitude ?? null, is_active: 1 })
    .select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "CREATE", "MasterData", `Created warehouse: ${name}`, "warehouse", (data as any).id);
  res.status(201).json(snakeToCamel(data));
});
router.put("/api/master-data/warehouses/:id", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager"), async (req, res) => {
  const { name, code, districtId, address } = req.body;
  const { data, error } = await supa.from("warehouses")
    .update({ name, code, district_id: districtId ?? null, address: address ?? null })
    .eq("id", Number(req.params.id)).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(snakeToCamel(data));
});
router.patch("/api/master-data/warehouses/:id/toggle", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager"), async (req, res) => {
  const { data: cur, error: e1 } = await supa.from("warehouses").select("is_active").eq("id", Number(req.params.id)).single();
  if (e1) { res.status(500).json({ error: e1.message }); return; }
  const next = (cur as any).is_active ? 0 : 1;
  const { data, error } = await supa.from("warehouses").update({ is_active: next }).eq("id", Number(req.params.id)).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(snakeToCamel(data));
});
router.post("/api/master-data/warehouses/import", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager"), async (req, res) => {
  const { rows } = req.body as { rows: any[] };
  if (!Array.isArray(rows) || !rows.length) { res.status(400).json({ error: "rows array required" }); return; }
  let inserted = 0; const errors: string[] = [];
  for (const r of rows) {
    if (!r.name || !r.code) { errors.push(`Skipped row (missing name/code): ${JSON.stringify(r)}`); continue; }
    const { error } = await supa.from("warehouses").insert({ name: r.name, code: r.code, address: r.address ?? null, is_active: 1 });
    if (error) errors.push(`${r.code}: ${error.message}`);
    else inserted++;
  }
  await logAudit(req, "IMPORT", "MasterData", `Imported ${inserted} warehouses`);
  res.json({ inserted, errors });
});

// ── Distribution Sites ────────────────────────────────────────────────────────
router.get("/api/master-data/distribution-sites", requireAnyAuth, async (_req, res) => {
  const { data, error } = await supa.from("distribution_sites").select("*").order("name");
  if (error) { res.status(500).json({ error: error.message }); return; }
  const rows = data ?? [];
  const distIds = [...new Set(rows.map((r: any) => r.district_id).filter(Boolean))];
  let distMap: Record<number, string> = {};
  if (distIds.length) {
    const { data: dists } = await supa.from("districts").select("id,name").in("id", distIds);
    (dists ?? []).forEach((d: any) => { distMap[d.id] = d.name; });
  }
  res.json(snakeToCamel(rows.map((r: any) => ({ ...r, district_name: distMap[r.district_id] ?? null }))));
});
router.post("/api/master-data/distribution-sites", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager"), async (req, res) => {
  const { name, districtId, latitude, longitude, geofenceRadius } = req.body;
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  const { data, error } = await supa.from("distribution_sites").insert({
    name, district_id: districtId ?? null,
    latitude: latitude ?? null, longitude: longitude ?? null,
    geofence_radius: geofenceRadius ?? 500, is_active: 1,
  }).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "CREATE", "MasterData", `Created distribution site: ${name}`, "distribution_site", (data as any).id);
  res.status(201).json(snakeToCamel(data));
});
router.put("/api/master-data/distribution-sites/:id", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager"), async (req, res) => {
  const { name, districtId, latitude, longitude, geofenceRadius } = req.body;
  const { data, error } = await supa.from("distribution_sites")
    .update({ name, district_id: districtId ?? null, latitude: latitude ?? null, longitude: longitude ?? null, geofence_radius: geofenceRadius ?? 500 })
    .eq("id", Number(req.params.id)).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(snakeToCamel(data));
});
router.patch("/api/master-data/distribution-sites/:id/toggle", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager"), async (req, res) => {
  const { data: cur, error: e1 } = await supa.from("distribution_sites").select("is_active").eq("id", Number(req.params.id)).single();
  if (e1) { res.status(500).json({ error: e1.message }); return; }
  const next = (cur as any).is_active ? 0 : 1;
  const { data, error } = await supa.from("distribution_sites").update({ is_active: next }).eq("id", Number(req.params.id)).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(snakeToCamel(data));
});
router.post("/api/master-data/distribution-sites/import", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager"), async (req, res) => {
  const { rows } = req.body as { rows: any[] };
  if (!Array.isArray(rows) || !rows.length) { res.status(400).json({ error: "rows array required" }); return; }
  let inserted = 0; const errors: string[] = [];
  for (const r of rows) {
    if (!r.name) { errors.push(`Skipped: ${JSON.stringify(r)}`); continue; }
    const { error } = await supa.from("distribution_sites").insert({
      name: r.name, district_id: null,
      latitude: r.latitude ? Number(r.latitude) : null,
      longitude: r.longitude ? Number(r.longitude) : null,
      geofence_radius: r.geofence_radius ? Number(r.geofence_radius) : 500,
      is_active: 1,
    });
    if (error) errors.push(`${r.name}: ${error.message}`);
    else inserted++;
  }
  await logAudit(req, "IMPORT", "MasterData", `Imported ${inserted} distribution sites`);
  res.json({ inserted, errors });
});

// ── Input Items ───────────────────────────────────────────────────────────────
router.get("/api/master-data/input-items", requireAnyAuth, async (_req, res) => {
  const { data, error } = await supa.from("input_items").select("*").order("name");
  if (error) { res.status(500).json({ error: error.message }); return; }
  const rows = data ?? [];
  const vcIds = [...new Set(rows.map((r: any) => r.value_chain_id).filter(Boolean))];
  let vcMap: Record<number, string> = {};
  if (vcIds.length) {
    const { data: vcs } = await supa.from("value_chains").select("id,name").in("id", vcIds);
    (vcs ?? []).forEach((v: any) => { vcMap[v.id] = v.name; });
  }
  res.json(snakeToCamel(rows.map((r: any) => ({ ...r, value_chain_name: vcMap[r.value_chain_id] ?? null }))));
});
router.post("/api/master-data/input-items", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager"), async (req, res) => {
  const { name, itemCode, unit, category, valueChainId, description } = req.body;
  if (!name || !itemCode || !unit) { res.status(400).json({ error: "name, itemCode and unit are required" }); return; }
  const { data, error } = await supa.from("input_items").insert({
    name, item_code: itemCode, unit, category: category ?? null,
    value_chain_id: valueChainId ?? null, description: description ?? null, is_active: 1,
  }).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "CREATE", "MasterData", `Created input item: ${name}`, "input_item", (data as any).id);
  res.status(201).json(snakeToCamel(data));
});
router.put("/api/master-data/input-items/:id", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager"), async (req, res) => {
  const { name, unit, category, valueChainId, description, barcode } = req.body;
  const update: Record<string, any> = { name, unit, category: category ?? null, value_chain_id: valueChainId ?? null, description: description ?? null };
  if ("barcode" in req.body) update.barcode = barcode || null;
  const { data, error } = await supa.from("input_items")
    .update(update)
    .eq("id", Number(req.params.id)).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(snakeToCamel(data));
});
router.patch("/api/master-data/input-items/:id/toggle", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager"), async (req, res) => {
  const { data: cur, error: e1 } = await supa.from("input_items").select("is_active").eq("id", Number(req.params.id)).single();
  if (e1) { res.status(500).json({ error: e1.message }); return; }
  const next = (cur as any).is_active ? 0 : 1;
  const { data, error } = await supa.from("input_items").update({ is_active: next }).eq("id", Number(req.params.id)).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(snakeToCamel(data));
});
router.delete("/api/master-data/input-items/:id", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager"), async (req, res) => {
  const id = Number(req.params.id);
  const { data: item } = await supa.from("input_items").select("name").eq("id", id).single();
  const { error } = await supa.from("input_items").update({ is_active: 0 }).eq("id", id);
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "DELETE", "MasterData", `Deleted input item: ${(item as any)?.name ?? id}`, "input_item", id);
  res.json({ success: true });
});

// ── System Settings ───────────────────────────────────────────────────────────
router.get("/api/master-data/system-settings", requireAnyAuth, async (_req, res) => {
  const { data, error } = await supa.from("system_settings").select("key, value, description, updated_at").order("key");
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data ?? []);
});
router.put("/api/master-data/system-settings", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager"), async (req, res) => {
  const updates = req.body as Record<string, string>;
  for (const [key, value] of Object.entries(updates)) {
    await supa
      .from("system_settings")
      .update({ value: String(value), updated_at: new Date().toISOString() })
      .eq("key", key);
  }
  await logAudit(req, "UPDATE", "SystemSettings", `Updated ${Object.keys(updates).length} system setting(s)`);
  const { data } = await supa.from("system_settings").select("key, value, description, updated_at").order("key");
  res.json(data ?? []);
});

export default router;

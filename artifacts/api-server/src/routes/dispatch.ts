import { Router } from "express";
import { supa, snakeToCamel } from "../lib/supabase.js";
import { requireAuth, requireAnyAuth } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { query } from "../lib/db.js";

const router = Router();

// ── LIST dispatches (web portal + mobile) ────────────────────────────────────
router.get("/api/dispatch", requireAnyAuth, async (req, res) => {
  const { campaignId, status, manifestCode, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageN  = Math.max(1, Number(page));
  const limitN = Math.min(200, Math.max(1, Number(limit)));
  const offset = (pageN - 1) * limitN;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let pi = 1;
  if (campaignId)    { conditions.push(`d.campaign_id = $${pi++}`);                           params.push(Number(campaignId)); }
  if (status)        { conditions.push(`d.status = $${pi++}`);                                params.push(status); }
  if (manifestCode)  { conditions.push(`d.manifest_code ILIKE $${pi++}`);                     params.push(manifestCode); }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const countRes = await query(`SELECT COUNT(*) FROM dispatches d ${where}`, params);
  const total = Number(countRes.rows[0].count);

  const dataRes = await query(
    `SELECT
       d.*,
       c.name        AS campaign_name,
       w.name        AS warehouse_name,
       v.plate_number,
       dr.full_name  AS driver_name
     FROM dispatches d
     LEFT JOIN campaigns  c  ON c.id  = d.campaign_id
     LEFT JOIN warehouses w  ON w.id  = d.warehouse_id
     LEFT JOIN vehicles   v  ON v.id  = d.vehicle_id
     LEFT JOIN drivers    dr ON dr.id = d.driver_id
     ${where}
     ORDER BY d.created_at DESC
     LIMIT $${pi++} OFFSET $${pi++}`,
    [...params, limitN, offset]
  );

  const rows = dataRes.rows.map((r: any) => ({
    ...snakeToCamel(r),
    plateNumber:  r.vehicle_type === "hired" ? r.hired_plate       : (r.plate_number  ?? null),
    driverName:   r.vehicle_type === "hired" ? r.hired_driver_name : (r.driver_name   ?? null),
    campaignName: r.campaign_name  ?? null,
    warehouseName:r.warehouse_name ?? null,
    isHired:      r.vehicle_type === "hired",
  }));

  res.json({ data: rows, total, page: pageN, limit: limitN });
});

// ── CREATE dispatch (web portal via Supabase token; mobile via JWT) ──────────
router.post("/api/dispatch", requireAnyAuth, async (req, res) => {
  const manifestCode = "MAN-" + Date.now().toString(36).toUpperCase();
  const b = req.body as Record<string, any>;
  const vehicleType: string = b.vehicleType ?? "office";

  let createdBy: number | null = req.user?.userId ?? null;
  if (!createdBy && req.supabaseUser?.email) {
    const { data: u } = await supa.from("users").select("id").eq("email", req.supabaseUser.email).limit(1).single();
    createdBy = (u as any)?.id ?? null;
  }

  try {
    const result = await query(
      `INSERT INTO dispatches
        (manifest_code, campaign_id, warehouse_id, vehicle_type,
         vehicle_id, driver_id, hired_plate, hired_driver_name, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        manifestCode,
        b.campaignId   ? Number(b.campaignId)   : null,
        b.warehouseId  ? Number(b.warehouseId)  : null,
        vehicleType,
        vehicleType === "office" && b.vehicleId ? Number(b.vehicleId) : null,
        vehicleType === "office" && b.driverId  ? Number(b.driverId)  : null,
        vehicleType === "hired"  ? (b.hiredPlate       ?? null) : null,
        vehicleType === "hired"  ? (b.hiredDriverName  ?? null) : null,
        b.notes ?? null,
        createdBy,
      ]
    );
    const row = result.rows[0];
    await logAudit(req, "CREATE", "Dispatch", `Created dispatch manifest: ${manifestCode}`, "dispatch", row.id);
    res.status(201).json(snakeToCamel(row));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET single dispatch ───────────────────────────────────────────────────────
router.get("/api/dispatch/:id", requireAnyAuth, async (req, res) => {
  const id = Number(req.params.id);

  const dispRes = await query(
    `SELECT
       d.*,
       c.name         AS campaign_name,
       c.campaign_code,
       w.name         AS warehouse_name,
       w.code         AS warehouse_code,
       v.plate_number,
       v.vehicle_type AS vehicle_category,
       dr.full_name   AS driver_name,
       dr.driver_code
     FROM dispatches d
     LEFT JOIN campaigns  c  ON c.id  = d.campaign_id
     LEFT JOIN warehouses w  ON w.id  = d.warehouse_id
     LEFT JOIN vehicles   v  ON v.id  = d.vehicle_id
     LEFT JOIN drivers    dr ON dr.id = d.driver_id
     WHERE d.id = $1`,
    [id]
  );

  if (!dispRes.rows.length) { res.status(404).json({ error: "Not found" }); return; }
  const r = dispRes.rows[0];

  const itemsRes = await query(
    `SELECT di.*, ii.name AS item_name, ii.unit
     FROM dispatch_items di
     LEFT JOIN input_items ii ON ii.id = di.input_item_id
     WHERE di.dispatch_id = $1`,
    [id]
  );

  const items = itemsRes.rows.map((i: any) => ({
    id: i.id,
    dispatchId: i.dispatch_id,
    inputItemId: i.input_item_id,
    inputItemName: i.item_name ?? null,
    unit: i.unit ?? null,
    quantityLoaded:    i.quantity_loaded,
    quantityDelivered: i.quantity_delivered,
    quantityReturned:  i.quantity_returned,
  }));

  res.json({
    ...snakeToCamel(r),
    plateNumber:   r.vehicle_type === "hired" ? r.hired_plate       : (r.plate_number  ?? null),
    driverName:    r.vehicle_type === "hired" ? r.hired_driver_name : (r.driver_name   ?? null),
    campaignName:  r.campaign_name  ?? null,
    campaignCode:  r.campaign_code  ?? null,
    warehouseName: r.warehouse_name ?? null,
    warehouseCode: r.warehouse_code ?? null,
    vehicleCategory: r.vehicle_category ?? null,
    isHired:       r.vehicle_type === "hired",
    items,
  });
});

// ── Helper: resolve integer user ID from JWT or Supabase token ────────────────
async function resolveUserId(req: import("express").Request): Promise<number | null> {
  if (req.user?.userId) return req.user.userId;
  if (req.supabaseUser?.email) {
    const { data: u } = await supa.from("users").select("id").eq("email", req.supabaseUser.email).limit(1).single();
    return (u as any)?.id ?? null;
  }
  return null;
}

router.post("/api/dispatch/:id/items", requireAnyAuth, async (req, res) => {
  const dispatchId = Number(req.params.id);
  const { inputItemId, quantityLoaded } = req.body as { inputItemId: number; quantityLoaded: number };
  try {
    const itemRes = await query(
      `INSERT INTO dispatch_items (dispatch_id, input_item_id, quantity_loaded)
       VALUES ($1, $2, $3) RETURNING *`,
      [dispatchId, inputItemId, quantityLoaded]
    );
    const totRes = await query(
      `SELECT COALESCE(SUM(quantity_loaded),0) AS total FROM dispatch_items WHERE dispatch_id=$1`,
      [dispatchId]
    );
    const total = Number(totRes.rows[0].total);
    await query(
      `UPDATE dispatches SET total_packages=$1, updated_at=NOW() WHERE id=$2`,
      [Math.round(total), dispatchId]
    );
    await logAudit(req, "ADD_ITEM", "Dispatch", `Added item to manifest ID ${dispatchId}`, "dispatch", dispatchId);
    res.status(201).json(snakeToCamel(itemRes.rows[0]));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/dispatch/:id/approve", requireAnyAuth, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const userId = await resolveUserId(req);
    const result = await query(
      `UPDATE dispatches SET status='Approved', approved_by=$1, approved_at=NOW(), updated_at=NOW()
       WHERE id=$2 RETURNING *`,
      [userId, id]
    );
    if (!result.rows.length) { res.status(404).json({ error: "Dispatch not found" }); return; }
    await logAudit(req, "APPROVE", "Dispatch", `Approved dispatch ID ${id}`, "dispatch", id);
    res.json(snakeToCamel(result.rows[0]));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/dispatch/:id/dispatch", requireAnyAuth, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const result = await query(
      `UPDATE dispatches SET status='In Transit', departed_at=NOW(), updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [id]
    );
    if (!result.rows.length) { res.status(404).json({ error: "Dispatch not found" }); return; }
    const row = result.rows[0];
    if (row.vehicle_id) {
      await query(`UPDATE vehicles SET status='InTransit' WHERE id=$1`, [row.vehicle_id]);
    }
    await logAudit(req, "DISPATCH", "Dispatch", `Started dispatch ID ${id}`, "dispatch", id);
    res.json(snakeToCamel(row));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/dispatch/:id/arrive", requireAnyAuth, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const result = await query(
      `UPDATE dispatches SET status='Arrived', arrived_at=NOW(), updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [id]
    );
    if (!result.rows.length) { res.status(404).json({ error: "Dispatch not found" }); return; }
    const row = result.rows[0];
    if (row.vehicle_id) {
      await query(`UPDATE vehicles SET status='Active' WHERE id=$1`, [row.vehicle_id]);
    }
    await logAudit(req, "ARRIVE", "Dispatch", `Marked dispatch ID ${id} arrived`, "dispatch", id);
    res.json(snakeToCamel(row));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

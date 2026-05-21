import { Router } from "express";
import { supa, snakeToCamel, pool } from "../lib/supabase.js";
import { requireAuth, requireAnyAuth, requireRoleIfJwt } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";

const router = Router();

async function resolveUserId(req: import("express").Request): Promise<number | null> {
  if (req.user?.userId) return req.user.userId;
  if (req.supabaseUser?.email) {
    const { data: u } = await supa.from("users").select("id").eq("email", req.supabaseUser.email).limit(1).single();
    return (u as any)?.id ?? null;
  }
  return null;
}

// Fetch lookup maps for campaigns (with district), warehouses, vehicles, drivers, officers
async function fetchLookups(
  campaignIds: number[],
  warehouseIds: number[],
  vehicleIds: number[],
  driverIds: number[],
  officerIds: number[] = [],
) {
  const [camps, wares, vehs, drivs, officers] = await Promise.all([
    campaignIds.length  ? supa.from("campaigns").select("id,name,district_id").in("id", campaignIds)  : Promise.resolve({ data: [] }),
    warehouseIds.length ? supa.from("warehouses").select("id,name").in("id", warehouseIds)             : Promise.resolve({ data: [] }),
    vehicleIds.length   ? supa.from("vehicles").select("id,plate_number,vehicle_type").in("id", vehicleIds) : Promise.resolve({ data: [] }),
    driverIds.length    ? supa.from("drivers").select("id,full_name").in("id", driverIds)              : Promise.resolve({ data: [] }),
    officerIds.length   ? supa.from("users").select("id,full_name").in("id", officerIds)               : Promise.resolve({ data: [] }),
  ]);

  // Resolve district names for campaigns
  const districtIds = [...new Set((camps.data ?? []).map((c: any) => c.district_id).filter(Boolean))];
  const { data: distData } = districtIds.length
    ? await supa.from("districts").select("id,name").in("id", districtIds)
    : { data: [] };
  const distMap = Object.fromEntries((distData ?? []).map((d: any) => [d.id, d]));

  return {
    campMap:    Object.fromEntries((camps.data   ?? []).map((r: any) => [r.id, { ...r, districtName: distMap[r.district_id]?.name ?? null }])),
    wareMap:    Object.fromEntries((wares.data   ?? []).map((r: any) => [r.id, r])),
    vehMap:     Object.fromEntries((vehs.data    ?? []).map((r: any) => [r.id, r])),
    drivMap:    Object.fromEntries((drivs.data   ?? []).map((r: any) => [r.id, r])),
    officerMap: Object.fromEntries((officers.data ?? []).map((r: any) => [r.id, r])),
  };
}

router.get("/api/dispatch", requireAnyAuth, async (req, res) => {
  const { campaignId, status, manifestCode, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageN  = Math.max(1, Number(page));
  const limitN = Math.min(200, Math.max(1, Number(limit)));
  const offset = (pageN - 1) * limitN;

  let q = supa
    .from("dispatches")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limitN - 1);

  if (campaignId)   q = q.eq("campaign_id", Number(campaignId)) as typeof q;
  if (status)       q = q.eq("status", status) as typeof q;
  if (manifestCode) q = q.ilike("manifest_code", manifestCode) as typeof q;

  // Field officers only see dispatches assigned to them
  if (req.user?.role === "FieldOfficer" && req.user?.userId) {
    q = q.eq("field_officer_id", req.user.userId) as typeof q;
  }

  const { data, count, error } = await q;
  if (error) { res.status(500).json({ error: error.message }); return; }

  const rows = data ?? [];
  const { campMap, wareMap, vehMap, drivMap, officerMap } = await fetchLookups(
    [...new Set(rows.map((r: any) => r.campaign_id).filter(Boolean))],
    [...new Set(rows.map((r: any) => r.warehouse_id).filter(Boolean))],
    [...new Set(rows.map((r: any) => r.vehicle_id).filter(Boolean))],
    [...new Set(rows.map((r: any) => r.driver_id).filter(Boolean))],
    [...new Set(rows.map((r: any) => r.field_officer_id).filter(Boolean))],
  );

  const result = rows.map((r: any) => ({
    ...snakeToCamel(r),
    campaignName:        campMap[r.campaign_id]?.name          ?? null,
    destinationDistrict: campMap[r.campaign_id]?.districtName  ?? null,
    warehouseName:       wareMap[r.warehouse_id]?.name         ?? null,
    plateNumber:         r.vehicle_type === "hired" ? r.hired_plate       : (vehMap[r.vehicle_id]?.plate_number ?? null),
    driverName:          r.vehicle_type === "hired" ? r.hired_driver_name : (drivMap[r.driver_id]?.full_name    ?? null),
    isHired:             r.vehicle_type === "hired",
    fieldOfficerName:    officerMap[r.field_officer_id]?.full_name ?? null,
  }));

  res.json({ data: result, total: count ?? 0, page: pageN, limit: limitN });
});

router.post("/api/dispatch", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager", "WarehouseManager"), async (req, res) => {
  const manifestCode = "MAN-" + Date.now().toString(36).toUpperCase();
  const b = req.body as Record<string, any>;
  const vehicleType: string = b.vehicleType ?? "office";

  let createdBy: number | null = req.user?.userId ?? null;
  if (!createdBy && req.supabaseUser?.email) {
    const { data: u } = await supa.from("users").select("id").eq("email", req.supabaseUser.email).limit(1).single();
    createdBy = (u as any)?.id ?? null;
  }

  const isHired = vehicleType === "hired";

  // Use direct pg connection to bypass PostgREST schema cache
  const cols = ["manifest_code", "campaign_id", "warehouse_id", "vehicle_type", "notes", "created_by"];
  const vals: unknown[] = [
    manifestCode,
    b.campaignId  ? Number(b.campaignId)  : null,
    b.warehouseId ? Number(b.warehouseId) : null,
    vehicleType,
    b.notes ?? null,
    createdBy,
  ];

  if (isHired) {
    cols.push("hired_plate", "hired_driver_name");
    vals.push(
      b.hiredPlate      ? String(b.hiredPlate).toUpperCase() : null,
      b.hiredDriverName ? String(b.hiredDriverName)          : null,
    );
  } else {
    cols.push("vehicle_id", "driver_id");
    vals.push(
      b.vehicleId ? Number(b.vehicleId) : null,
      b.driverId  ? Number(b.driverId)  : null,
    );
  }

  if (b.fieldOfficerId) {
    cols.push("field_officer_id");
    vals.push(Number(b.fieldOfficerId));
  }

  const placeholders = vals.map((_, i) => `$${i + 1}`).join(", ");
  const sql = `INSERT INTO dispatches (${cols.join(", ")}) VALUES (${placeholders}) RETURNING *`;

  let row: Record<string, unknown>;
  try {
    const result = await pool.query(sql, vals);
    row = result.rows[0];
  } catch (pgErr: any) {
    res.status(500).json({ error: pgErr.message }); return;
  }

  await logAudit(req, "CREATE", "Dispatch", `Created dispatch manifest: ${manifestCode}`, "dispatch", row.id as number);
  res.status(201).json(snakeToCamel(row));
});

router.get("/api/dispatch/:id", requireAnyAuth, async (req, res) => {
  const id = Number(req.params.id);

  const { data: r, error } = await supa.from("dispatches").select("*").eq("id", id).single();
  if (error || !r) { res.status(404).json({ error: "Not found" }); return; }

  const row = r as any;
  const [{ data: itemRows, error: itemsErr }, { campMap, wareMap, vehMap, drivMap, officerMap }] = await Promise.all([
    supa.from("dispatch_items").select("*").eq("dispatch_id", id),
    fetchLookups(
      row.campaign_id      ? [row.campaign_id]      : [],
      row.warehouse_id     ? [row.warehouse_id]     : [],
      row.vehicle_id       ? [row.vehicle_id]       : [],
      row.driver_id        ? [row.driver_id]        : [],
      row.field_officer_id ? [row.field_officer_id] : [],
    ),
  ]);

  if (itemsErr) { res.status(500).json({ error: itemsErr.message }); return; }

  const camp = campMap[row.campaign_id] as any;
  const ware = wareMap[row.warehouse_id] as any;
  const veh  = vehMap[row.vehicle_id]   as any;
  const driv = drivMap[row.driver_id]   as any;

  // Fetch related data for items and codes in parallel
  const inputItemIds = [...new Set((itemRows ?? []).map((i: any) => i.input_item_id).filter(Boolean))];

  const [
    { data: campFull },
    { data: wareFull },
    { data: drivFull },
    { data: inputItems },
  ] = await Promise.all([
    row.campaign_id  ? supa.from("campaigns").select("campaign_code").eq("id", row.campaign_id).single()   : Promise.resolve({ data: null }),
    row.warehouse_id ? supa.from("warehouses").select("code").eq("id", row.warehouse_id).single()           : Promise.resolve({ data: null }),
    row.driver_id    ? supa.from("drivers").select("driver_code").eq("id", row.driver_id).single()          : Promise.resolve({ data: null }),
    inputItemIds.length ? supa.from("input_items").select("id, name, unit").in("id", inputItemIds)          : Promise.resolve({ data: [] }),
  ]);

  const inputItemMap = Object.fromEntries((inputItems ?? []).map((it: any) => [it.id, it]));

  const items = (itemRows ?? []).map((i: any) => {
    const itm = inputItemMap[i.input_item_id] as any;
    return {
      id:                i.id,
      dispatchId:        i.dispatch_id,
      inputItemId:       i.input_item_id,
      inputItemName:     itm?.name ?? null,
      unit:              itm?.unit ?? null,
      quantityLoaded:    i.quantity_loaded,
      quantityDelivered: i.quantity_delivered,
      quantityReturned:  i.quantity_returned,
    };
  });

  res.json({
    ...snakeToCamel(row),
    campaignName:        camp?.name                          ?? null,
    campaignCode:        (campFull as any)?.campaign_code    ?? null,
    destinationDistrict: camp?.districtName                  ?? null,
    warehouseName:       ware?.name                          ?? null,
    warehouseCode:       (wareFull as any)?.code             ?? null,
    vehicleCategory:     veh?.vehicle_type                   ?? null,
    plateNumber:         row.vehicle_type === "hired" ? row.hired_plate       : (veh?.plate_number ?? null),
    driverName:          row.vehicle_type === "hired" ? row.hired_driver_name : (driv?.full_name   ?? null),
    driverCode:          (drivFull as any)?.driver_code      ?? null,
    isHired:             row.vehicle_type === "hired",
    fieldOfficerName:    officerMap[row.field_officer_id]?.full_name ?? null,
    items,
  });
});

// Assign / reassign a field officer to a dispatch
router.patch("/api/dispatch/:id/assign", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager", "WarehouseManager"), async (req, res) => {
  const id = Number(req.params.id);
  const { fieldOfficerId } = req.body as { fieldOfficerId: number | null };

  const { data, error } = await supa
    .from("dispatches")
    .update({ field_officer_id: fieldOfficerId ?? null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error || !data) { res.status(error ? 500 : 404).json({ error: error?.message ?? "Dispatch not found" }); return; }
  await logAudit(req, "ASSIGN", "Dispatch", `Assigned field officer ${fieldOfficerId ?? "none"} to dispatch ID ${id}`, "dispatch", id);
  res.json(snakeToCamel(data));
});

router.post("/api/dispatch/:id/items", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager", "WarehouseManager"), async (req, res) => {
  const dispatchId = Number(req.params.id);
  const { inputItemId, quantityLoaded } = req.body as { inputItemId: number; quantityLoaded: number };

  const { data: itemData, error: itemErr } = await supa
    .from("dispatch_items")
    .insert({ dispatch_id: dispatchId, input_item_id: inputItemId, quantity_loaded: quantityLoaded })
    .select()
    .single();

  if (itemErr) { res.status(500).json({ error: itemErr.message }); return; }

  const { data: allItems } = await supa
    .from("dispatch_items")
    .select("quantity_loaded")
    .eq("dispatch_id", dispatchId);

  const total = (allItems ?? []).reduce((sum: number, i: any) => sum + Number(i.quantity_loaded ?? 0), 0);
  await supa.from("dispatches").update({ total_packages: Math.round(total), updated_at: new Date().toISOString() }).eq("id", dispatchId);

  await logAudit(req, "ADD_ITEM", "Dispatch", `Added item to manifest ID ${dispatchId}`, "dispatch", dispatchId);
  res.status(201).json(snakeToCamel(itemData));
});

router.post("/api/dispatch/:id/approve", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager"), async (req, res) => {
  const id = Number(req.params.id);
  const userId = await resolveUserId(req);

  const { data, error } = await supa
    .from("dispatches")
    .update({ status: "Approved", approved_by: userId, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error || !data) { res.status(error ? 500 : 404).json({ error: error?.message ?? "Dispatch not found" }); return; }
  await logAudit(req, "APPROVE", "Dispatch", `Approved dispatch ID ${id}`, "dispatch", id);
  res.json(snakeToCamel(data));
});

router.post("/api/dispatch/:id/dispatch", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager", "WarehouseManager"), async (req, res) => {
  const id = Number(req.params.id);

  const { data, error } = await supa
    .from("dispatches")
    .update({ status: "In Transit", departed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error || !data) { res.status(error ? 500 : 404).json({ error: error?.message ?? "Dispatch not found" }); return; }
  const row = data as any;

  if (row.vehicle_id) {
    await supa.from("vehicles").update({ status: "InTransit" }).eq("id", row.vehicle_id);
  }

  // Deduct loaded quantities from stock_balance.available, add to stock_balance.loaded
  const { data: items } = await supa
    .from("dispatch_items")
    .select("input_item_id, quantity_loaded")
    .eq("dispatch_id", id);

  if (items && items.length > 0 && row.warehouse_id) {
    const createdBy = req.user?.userId ?? null;
    for (const item of items as any[]) {
      const qty = Number(item.quantity_loaded ?? 0);
      if (!qty) continue;

      const { data: bal } = await supa
        .from("stock_balance")
        .select("id, available, loaded")
        .eq("warehouse_id", row.warehouse_id)
        .eq("input_item_id", item.input_item_id)
        .single();
      if (bal) {
        await supa.from("stock_balance").update({
          available: Math.max(0, ((bal as any).available ?? 0) - qty),
          loaded:    ((bal as any).loaded ?? 0) + qty,
          updated_at: new Date().toISOString(),
        }).eq("id", (bal as any).id);
      }

      await supa.from("stock_ledger").insert({
        warehouse_id:  row.warehouse_id,
        input_item_id: item.input_item_id,
        txn_type:      "DISPATCH",
        quantity:      -qty,
        reference:     row.manifest_code ?? null,
        notes:         `Dispatched on manifest ${row.manifest_code ?? id}`,
        created_by:    createdBy,
      });
    }
  }

  await logAudit(req, "DISPATCH", "Dispatch", `Started dispatch ID ${id}`, "dispatch", id);
  res.json(snakeToCamel(row));
});

router.post("/api/dispatch/:id/arrive", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager", "WarehouseManager"), async (req, res) => {
  const id = Number(req.params.id);

  const { data, error } = await supa
    .from("dispatches")
    .update({ status: "Arrived", arrived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error || !data) { res.status(error ? 500 : 404).json({ error: error?.message ?? "Dispatch not found" }); return; }
  const row = data as any;
  if (row.vehicle_id) {
    await supa.from("vehicles").update({ status: "Active" }).eq("id", row.vehicle_id);
  }
  await logAudit(req, "ARRIVE", "Dispatch", `Marked dispatch ID ${id} arrived`, "dispatch", id);
  res.json(snakeToCamel(row));
});

router.post("/api/dispatch/:id/cancel", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager", "WarehouseManager"), async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = req.body as { reason?: string };

  const { data, error } = await supa
    .from("dispatches")
    .update({
      status: "Cancelled",
      cancel_reason: reason ?? null,
      cancelled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error || !data) { res.status(error ? 500 : 404).json({ error: error?.message ?? "Dispatch not found" }); return; }
  await logAudit(req, "CANCEL", "Dispatch", `Cancelled dispatch ID ${id}${reason ? `: ${reason}` : ""}`, "dispatch", id);
  res.json(snakeToCamel(data));
});

router.delete("/api/dispatch/:id", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager"), async (req, res) => {
  const id = Number(req.params.id);
  const { error } = await supa.from("dispatches").delete().eq("id", id);
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "DELETE", "Dispatch", `Deleted dispatch ID ${id}`, "dispatch", id);
  res.json({ success: true });
});

export default router;

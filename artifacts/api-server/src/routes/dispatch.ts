import { Router } from "express";
import { randomBytes } from "crypto";
import { supa, snakeToCamel } from "../lib/supabase.js";
import { requireAuth, requireAnyAuth, requireRoleIfJwt } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { canReadDispatch, getDispatchReadScope } from "../lib/dispatch-auth.js";

const router = Router();

function normalisePhoneForStorage(raw: string): string {
  let p = raw.replace(/\D/g, "");
  if (p.startsWith("0")) p = "232" + p.slice(1);
  if (!p.startsWith("232")) p = "232" + p;
  return "+" + p;
}

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
  officerIds: string[] = [],
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
  const { campaignId, status, manifestCode, fieldOfficerId, page = "1", limit = "20", archived } = req.query as Record<string, string>;
  const pageN  = Math.max(1, Number(page));
  const limitN = Math.min(200, Math.max(1, Number(limit)));
  const offset = (pageN - 1) * limitN;
  const showArchived = archived === "true";

  const readScope = await getDispatchReadScope(req);
  // A FieldOfficer's assignment is authoritative; a query parameter must not
  // broaden or replace it (including for Supabase-authenticated officers).
  const officerFilter: number | null = !readScope.unrestricted && readScope.fieldOfficerId !== undefined
    ? readScope.fieldOfficerId
    : fieldOfficerId ? Number(fieldOfficerId) : null;

  if (officerFilter !== null) {
    // Use supa with eq() — field_officer_id is a regular integer column in Supabase
    let q = supa
      .from("dispatches")
      .select("*", { count: "exact" })
      .eq("field_officer_id", officerFilter)
      .order("created_at", { ascending: false })
      .range(offset, offset + limitN - 1);

    if (campaignId)   q = q.eq("campaign_id", Number(campaignId)) as typeof q;
    if (!readScope.unrestricted && readScope.campaignIds !== undefined) q = q.in("campaign_id", readScope.campaignIds) as typeof q;
    if (status)       q = q.eq("status", status) as typeof q;
    if (manifestCode) q = q.ilike("manifest_code", `%${manifestCode.replace(/[%_]/g, "")}%`) as typeof q;
    if (showArchived) q = q.eq("archived", true) as typeof q;
    else              q = q.or("archived.eq.false,archived.is.null") as typeof q;

    const { data: ofData, count: ofCount, error: ofErr } = await q;
    if (ofErr) { console.error("Failed to list dispatches (officer filter):", ofErr); res.status(500).json({ error: "Operation failed" }); return; }

    const rows = ofData ?? [];

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

    res.json({ data: result, total: ofCount ?? 0, page: pageN, limit: limitN });
    return;
  }

  // No field_officer_id filter — use Supabase client as before
  let q = supa
    .from("dispatches")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limitN - 1);

  if (campaignId)   q = q.eq("campaign_id", Number(campaignId)) as typeof q;
  if (!readScope.unrestricted && readScope.campaignIds !== undefined) q = q.in("campaign_id", readScope.campaignIds) as typeof q;
  if (status)       q = q.eq("status", status) as typeof q;
  if (manifestCode) q = q.ilike("manifest_code", `%${manifestCode.replace(/[%_]/g, "")}%`) as typeof q;
  if (showArchived) q = q.eq("archived", true) as typeof q;
  else              q = q.or("archived.eq.false,archived.is.null") as typeof q;

  const { data, count, error } = await q;
  if (error) { console.error("Failed to list dispatches:", error); res.status(500).json({ error: "Operation failed" }); return; }

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

  // Step 1: INSERT without field_officer_id (avoids PostgREST schema cache stale-column issue)
  const insertObj: Record<string, unknown> = {
    manifest_code: manifestCode,
    campaign_id:   b.campaignId  ? Number(b.campaignId)  : null,
    warehouse_id:  b.warehouseId ? Number(b.warehouseId) : null,
    vehicle_type:  vehicleType,
    notes:         b.notes ?? null,
    created_by:    createdBy,
    ...(isHired
      ? {
          hired_plate:       b.hiredPlate      ? String(b.hiredPlate).toUpperCase() : null,
          hired_driver_name: b.hiredDriverName ? String(b.hiredDriverName)          : null,
        }
      : {
          vehicle_id: b.vehicleId ? Number(b.vehicleId) : null,
          driver_id:  b.driverId  ? Number(b.driverId)  : null,
        }),
  };

  const { data: insertedRow, error: insertErr } = await supa
    .from("dispatches")
    .insert(insertObj)
    .select()
    .single();

  if (insertErr || !insertedRow) {
    console.error("Failed to create dispatch:", insertErr);
    res.status(500).json({ error: "Operation failed" }); return;
  }

  let row: Record<string, unknown> = insertedRow as Record<string, unknown>;

  // Step 2: UPDATE field_officer_id separately (avoids schema cache stale-insert issue)
  if (b.fieldOfficerId) {
    const { data: updRow } = await supa
      .from("dispatches")
      .update({ field_officer_id: Number(b.fieldOfficerId), updated_at: new Date().toISOString() })
      .eq("id", (row as any).id)
      .select()
      .single();
    if (updRow) row = updRow as Record<string, unknown>;
  }

  await logAudit(req, "CREATE", "Dispatch", `Created dispatch manifest: ${manifestCode}`, "dispatch", row.id as number);
  res.status(201).json(snakeToCamel(row));
});

router.get("/api/dispatch/:id", requireAnyAuth, async (req, res) => {
  const id = Number(req.params.id);

  let row: any;
  const { data: dispRow, error: dispFetchErr } = await supa
    .from("dispatches")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (dispFetchErr) { console.error("Failed to fetch dispatch:", dispFetchErr); res.status(500).json({ error: "Operation failed" }); return; }
  if (!dispRow) { res.status(404).json({ error: "Not found" }); return; }
  if (!(await canReadDispatch(req, dispRow as any))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  row = dispRow;
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

  if (itemsErr) { console.error("Failed to fetch dispatch items:", itemsErr); res.status(500).json({ error: "Operation failed" }); return; }

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
  const { fieldOfficerId } = req.body as { fieldOfficerId: string | null };

  const { data: assignData, error: assignErr } = await supa
    .from("dispatches")
    .update({ field_officer_id: fieldOfficerId ? Number(fieldOfficerId) : null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .maybeSingle();

  if (assignErr) { console.error("Failed to assign dispatch:", assignErr); res.status(500).json({ error: "Operation failed" }); return; }
  if (!assignData) { res.status(404).json({ error: "Dispatch not found" }); return; }
  await logAudit(req, "ASSIGN", "Dispatch", `Assigned field officer ${fieldOfficerId ?? "none"} to dispatch ID ${id}`, "dispatch", id);
  res.json(snakeToCamel(assignData));
});

router.post("/api/dispatch/:id/items", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager", "WarehouseManager"), async (req, res) => {
  const dispatchId = Number(req.params.id);
  const { inputItemId, quantityLoaded } = req.body as { inputItemId: number; quantityLoaded: number };

  const { data: itemData, error: itemErr } = await supa
    .from("dispatch_items")
    .insert({ dispatch_id: dispatchId, input_item_id: inputItemId, quantity_loaded: quantityLoaded })
    .select()
    .single();

  if (itemErr) { console.error("Failed to add dispatch item:", itemErr); res.status(500).json({ error: "Operation failed" }); return; }

  const { data: allItems } = await supa.from("dispatch_items").select("quantity_loaded").eq("dispatch_id", dispatchId);
  const totalPkgs = (allItems ?? []).reduce((s: number, i: any) => s + (Number(i.quantity_loaded) || 0), 0);
  await supa.from("dispatches").update({ total_packages: totalPkgs, updated_at: new Date().toISOString() }).eq("id", dispatchId);

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

  if (error || !data) { if (error) console.error("Failed to approve dispatch:", error); res.status(error ? 500 : 404).json({ error: error ? "Operation failed" : "Dispatch not found" }); return; }
  await logAudit(req, "APPROVE", "Dispatch", `Approved dispatch ID ${id}`, "dispatch", id);
  res.json(snakeToCamel(data));
});

router.post("/api/dispatch/:id/dispatch", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager", "WarehouseManager"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid dispatch id" });
    return;
  }
  const createdBy = await resolveUserId(req);
  const { data, error } = await supa.rpc("start_dispatch_atomic", {
    p_dispatch_id: id,
    p_created_by: createdBy,
  });
  if (error || !data) {
    const message = error?.message ?? "Operation failed";
    const status = /does not exist/i.test(message) ? 404
      : /cannot start from status/i.test(message) ? 409
      : /insufficient stock|no items|no warehouse|positive finite/i.test(message) ? 422
      : 500;
    res.status(status).json({ error: message });
    return;
  }
  await logAudit(req, "DISPATCH", "Dispatch", `Started dispatch ID ${id}`, "dispatch", id);
  res.json(snakeToCamel(data));
  return;

  /* Replaced by start_dispatch_atomic so stock and status cannot diverge.
  const { data, error } = await supa
    .from("dispatches")
    .update({ status: "In Transit", departed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error || !data) { if (error) console.error("Failed to dispatch:", error); res.status(error ? 500 : 404).json({ error: error ? "Operation failed" : "Dispatch not found" }); return; }
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
  */
});

router.post("/api/dispatch/:id/arrive", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager", "WarehouseManager"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid dispatch id" });
    return;
  }
  const { data, error } = await supa.rpc("arrive_dispatch_atomic", { p_dispatch_id: id });
  if (error || !data) {
    const message = error?.message ?? "Operation failed";
    const status = /does not exist/i.test(message) ? 404
      : /cannot arrive from status/i.test(message) ? 409
      : 500;
    res.status(status).json({ error: message });
    return;
  }
  await logAudit(req, "ARRIVE", "Dispatch", `Marked dispatch ID ${id} arrived`, "dispatch", id);
  res.json(snakeToCamel(data));
});

router.post("/api/dispatch/:id/cancel", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager", "WarehouseManager"), async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = req.body as { reason?: string };
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid dispatch id" });
    return;
  }
  if (reason !== undefined && typeof reason !== "string") {
    res.status(400).json({ error: "Cancellation reason must be a string" });
    return;
  }
  const cancelledBy = await resolveUserId(req);
  const { data, error } = await supa.rpc("cancel_dispatch_atomic", {
    p_dispatch_id: id,
    p_reason: reason ?? null,
    p_cancelled_by: cancelledBy,
  });
  if (error || !data) {
    const message = error?.message ?? "Operation failed";
    const status = /does not exist/i.test(message) ? 404
      : /cannot cancel from status/i.test(message) ? 409
      : /unsafe|insufficient|missing|no warehouse/i.test(message) ? 422
      : 500;
    res.status(status).json({ error: message });
    return;
  }
  await logAudit(req, "CANCEL", "Dispatch", `Cancelled dispatch ID ${id}${reason ? `: ${reason}` : ""}`, "dispatch", id);
  res.json(snakeToCamel(data));
});

router.delete("/api/dispatch/:id", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager"), async (req, res) => {
  const id = Number(req.params.id);
  const { error } = await supa.from("dispatches").delete().eq("id", id);
  if (error) { console.error("Failed to delete dispatch:", error); res.status(500).json({ error: "Operation failed" }); return; }
  await logAudit(req, "DELETE", "Dispatch", `Deleted dispatch ID ${id}`, "dispatch", id);
  res.json({ success: true });
});

// ── Excel Import ──────────────────────────────────────────────────────────────
router.post(
  "/api/dispatch/import",
  requireAnyAuth,
  requireRoleIfJwt("Admin", "ProjectManager", "WarehouseManager"),
  async (req, res) => {
    const b = req.body as {
      campaignId?: number;
      newCampaignName?: string;
      warehouseId: number;
      vehicleType: "office" | "hired";
      vehicleId?: number;
      driverId?: number;
      hiredPlate?: string;
      hiredDriverName?: string;
      fieldOfficerId?: string;
      notes?: string;
      force?: boolean;
      columns: Array<{ colIndex: number; name: string; unit: string; itemId: number | null }>;
      rows: Array<{
        community: string;
        district: string;
        chiefdom: string;
        contactPerson: string | null;
        contactPhone: string | null;
        quantities: number[];
      }>;
    };

    const { warehouseId, columns, rows } = b;
    let campaignId: number | undefined = b.campaignId;

    let createdBy: number | null = req.user?.userId ?? null;
    if (!createdBy && req.supabaseUser?.email) {
      const { data: u } = await supa.from("users").select("id").eq("email", req.supabaseUser.email).limit(1).maybeSingle();
      createdBy = (u as any)?.id ?? null;
    }

    // The database function owns every lookup/create and final manifest write.
    // Keeping the route mutation-free before this call ensures any failure
    // rolls the complete import back, including newly discovered master data.
    const rpcPayload = {
      ...b,
      rows: Array.isArray(b.rows)
        ? b.rows.map(row => ({
            ...row,
            contactPhone: row.contactPhone ? normalisePhoneForStorage(row.contactPhone) : null,
          }))
        : b.rows,
    };
    const { data: atomicImport, error: atomicImportErr } = await supa.rpc("import_manifest_atomic", {
      p_payload: rpcPayload,
      p_created_by: createdBy,
    });
    if (atomicImportErr || !atomicImport) {
      console.error("Failed to import manifest atomically:", atomicImportErr);
      const message = atomicImportErr?.message ?? "Operation failed";
      if (message.includes("insufficient_stock")) {
        const encoded = message.slice(message.indexOf("insufficient_stock") + "insufficient_stock:".length).trim();
        let shortfalls: unknown[] = [];
        try {
          const parsed = JSON.parse(encoded);
          if (Array.isArray(parsed)) shortfalls = parsed;
        } catch { /* PostgreSQL message did not include parseable detail */ }
        res.status(422).json({ error: "insufficient_stock", shortfalls });
      } else {
        res.status(400).json({ error: message });
      }
      return;
    }
    res.status(201).json(snakeToCamel(atomicImport));
    return;

    /*
     * The former multi-request implementation lived here. It intentionally
     * remains disabled during this migration transition; import_manifest_atomic
     * now owns every lookup/create and final write in one transaction.
     *
    // 0. Extract value chain from title/notes (e.g. "TOOLS DISTRIBUTION PLAN FOR CASSAVA COMMUNITIES 2025")
    let valueChainId: number | null = null;
    const titleText = b.notes ?? b.newCampaignName ?? "";
    const vcMatch = titleText.match(/\bfor\s+(\w+)\s+communities\b/i);
    if (vcMatch) {
      const vcName = vcMatch[1].charAt(0).toUpperCase() + vcMatch[1].slice(1).toLowerCase();
      const { data: vcRow } = await supa.from("value_chains").select("id").ilike("name", vcName).limit(1).maybeSingle();
      if (vcRow) {
        valueChainId = (vcRow as any).id;
      } else {
        const { data: newVc } = await supa.from("value_chains").insert({ name: vcName, is_active: 1 }).select("id").single();
        if (newVc) valueChainId = (newVc as any).id;
      }
    }
    if (!valueChainId) {
      const { data: vcFallback } = await supa.from("value_chains").select("id").order("id", { ascending: true }).limit(1).maybeSingle();
      valueChainId = (vcFallback as any)?.id ?? null;
    }

    // 1. Resolve or create each input_item
    const itemIdMap: Record<number, number> = {};
    let newItemCount = 0;
    for (const col of columns) {
      if (col.itemId) {
        itemIdMap[col.colIndex] = col.itemId;
        continue;
      }
      // Strip Excel footnote markers (*, †, ‡, §) and normalise whitespace
      const itemName = col.name.trim().replace(/[*†‡§]+$/, "").trim();
      const { data: existing } = await supa
        .from("input_items")
        .select("id")
        .ilike("name", itemName)
        .limit(1)
        .maybeSingle();
      if (existing) {
        itemIdMap[col.colIndex] = (existing as any).id;
        continue;
      }
      const itemCode = "ITM-" + randomBytes(4).toString("hex").toUpperCase();
      const { data: newItem, error: itemErr } = await supa
        .from("input_items")
        .insert({ name: itemName, item_code: itemCode, unit: col.unit || "pcs", category: "Tools", is_active: 1 })
        .select()
        .single();
      if (itemErr || !newItem) {
        console.error(`Failed to create inventory item "${itemName}":`, itemErr);
        res.status(500).json({ error: "Operation failed" });
        return;
      }
      itemIdMap[col.colIndex] = (newItem as any).id;
      newItemCount++;
      // Seed a zero stock_balance row so the item shows up in inventory
      await supa.from("stock_balance").upsert(
        { warehouse_id: warehouseId, input_item_id: (newItem as any).id, available: 0, reserved: 0, loaded: 0, delivered: 0, returned: 0, damaged: 0 },
        { onConflict: "warehouse_id,input_item_id" },
      );
    }

    // 1b. Stock availability check (skipped if force=true)
    if (!b.force) {
      const itemTotals: Record<number, number> = {};
      for (const row of rows) {
        for (let i = 0; i < columns.length; i++) {
          const qty = row.quantities[i] ?? 0;
          if (qty > 0) {
            const itemId = itemIdMap[columns[i].colIndex];
            if (itemId) itemTotals[itemId] = (itemTotals[itemId] ?? 0) + qty;
          }
        }
      }
      const checkIds = Object.keys(itemTotals).map(Number);
      if (checkIds.length > 0) {
        const { data: stockRows } = await supa
          .from("stock_balance")
          .select("input_item_id, available")
          .eq("warehouse_id", warehouseId)
          .in("input_item_id", checkIds);
        const nameMap: Record<number, string> = {};
        for (const col of columns) {
          if (itemIdMap[col.colIndex]) nameMap[itemIdMap[col.colIndex]] = col.name;
        }
        const shortfalls: Array<{ itemName: string; needed: number; available: number }> = [];
        for (const [idStr, needed] of Object.entries(itemTotals)) {
          const id = Number(idStr);
          const bal = (stockRows ?? []).find((s: any) => s.input_item_id === id);
          const available = Number((bal as any)?.available ?? 0);
          if (needed > available) {
            shortfalls.push({ itemName: nameMap[id] ?? `Item ${id}`, needed, available });
          }
        }
        if (shortfalls.length > 0) {
          res.status(422).json({ error: "insufficient_stock", shortfalls });
          return;
        }
      }
    }

    // 2. Resolve or create districts (case-insensitive)
    const unmatchedDistricts: string[] = [];
    const districtNames = [...new Set(rows.map(r => r.district.trim()))];
    const { data: districtRows } = await supa.from("districts").select("id,name").in("name", districtNames);
    const districtMap: Record<string, number> = {};
    for (const d of (districtRows ?? []) as any[]) {
      districtMap[d.name.toLowerCase()] = d.id;
    }
    for (const dName of districtNames) {
      if (!districtMap[dName.toLowerCase()]) {
        const code = dName.substring(0, 3).toUpperCase() + "-" + randomBytes(2).toString("hex").toUpperCase();
        const { data: newDist } = await supa.from("districts").insert({ name: dName, code }).select("id").single();
        if (newDist) districtMap[dName.toLowerCase()] = (newDist as any).id;
      }
    }

    // 2b. Resolve or create chiefdoms (name + district_id)
    const chiefdomNames = [...new Set(rows.map(r => r.chiefdom?.trim()).filter(Boolean))] as string[];
    const chiefdomMap: Record<string, number> = {};
    if (chiefdomNames.length > 0) {
      const { data: chiefdomRows } = await supa
        .from("chiefdoms")
        .select("id,name,district_id")
        .in("name", chiefdomNames);
      for (const c of (chiefdomRows ?? []) as any[]) {
        chiefdomMap[`${(c.name as string).toLowerCase()}|${c.district_id}`] = c.id;
      }
    }
    // Create missing chiefdoms
    for (const row of rows) {
      const cName = row.chiefdom?.trim();
      if (!cName) continue;
      const dId = districtMap[row.district.trim().toLowerCase()] ?? null;
      if (!dId) continue;
      const key = `${cName.toLowerCase()}|${dId}`;
      if (!chiefdomMap[key]) {
        const { data: newChief } = await supa.from("chiefdoms").insert({ name: cName, district_id: dId }).select("id").single();
        if (newChief) chiefdomMap[key] = (newChief as any).id;
      }
    }

    // 2c. Resolve or create communities (linked to chiefdom via section)
    const communityMap: Record<string, number> = {};
    for (const row of rows) {
      const commName = row.community.trim();
      const dId = districtMap[row.district.trim().toLowerCase()] ?? null;
      const cName = row.chiefdom?.trim();
      const chiefKey = cName && dId ? `${cName.toLowerCase()}|${dId}` : null;
      const chiefdomId = chiefKey ? (chiefdomMap[chiefKey] ?? null) : null;
      const commKey = `${commName.toLowerCase()}|${dId}`;
      if (communityMap[commKey]) continue;

      // Look up existing community by name + district context
      const { data: existComm } = await supa.from("communities").select("id,name").ilike("name", commName).limit(1).maybeSingle();
      if (existComm) {
        communityMap[commKey] = (existComm as any).id;
      } else if (chiefdomId) {
        // Need a section to link community → chiefdom. Find or create a default section.
        let sectionId: number | null = null;
        const { data: existSec } = await supa.from("sections").select("id").eq("chiefdom_id", chiefdomId).limit(1).maybeSingle();
        if (existSec) {
          sectionId = (existSec as any).id;
        } else {
          const { data: newSec } = await supa.from("sections").insert({ name: cName || "Default", chiefdom_id: chiefdomId }).select("id").single();
          if (newSec) sectionId = (newSec as any).id;
        }
        if (sectionId) {
          const { data: newComm } = await supa.from("communities").insert({ name: commName, section_id: sectionId }).select("id").single();
          if (newComm) communityMap[commKey] = (newComm as any).id;
        }
      }
    }

    // 2b. Auto-create campaign if none supplied
    let autoCampaignName: string | undefined;
    if (!campaignId) {
      const primaryDistrictId = districtMap[districtNames[0]?.toLowerCase()] ?? null;
      autoCampaignName = b.newCampaignName?.trim()
        || b.notes?.trim()
        || `Distribution - ${districtNames.join(", ")} - ${new Date().toLocaleDateString("en-GB")}`;

      // Check if a campaign with this name already exists to avoid duplicates
      const { data: existingCamp } = await supa.from("campaigns")
        .select("id")
        .eq("name", autoCampaignName)
        .limit(1)
        .maybeSingle();

      if (existingCamp) {
        campaignId = (existingCamp as any).id;
      } else {
        const campaignCode = "CAM-" + randomBytes(4).toString("hex").toUpperCase();
        const { data: newCampaign, error: campErr } = await supa
          .from("campaigns")
          .insert({
            name: autoCampaignName,
            campaign_code: campaignCode,
            district_id: primaryDistrictId,
            value_chain_id: valueChainId,
            start_date: new Date().toISOString().slice(0, 10),
            end_date: new Date(Date.now() + 180 * 24 * 3600_000).toISOString().slice(0, 10),
            status: "approved",
            created_by: createdBy,
          })
          .select()
          .single();
        if (campErr || !newCampaign) {
          console.error("Failed to auto-create campaign:", campErr);
          res.status(500).json({ error: "Operation failed" });
          return;
        }
        campaignId = (newCampaign as any).id;
      }
    }

    // 3. Find or create a group beneficiary per community
    // Use the value chain extracted from title (or fallback already resolved above)

    const communities: Array<{ community: string; district: string; farmerCode: string; barcodeToken: string }> = [];
    const farmerIds: number[] = [];
    let newFarmerCount = 0;
    for (const row of rows) {
      const districtId  = districtMap[row.district.trim().toLowerCase()] ?? null;
      const chiefdomId  = row.chiefdom?.trim()
        ? (chiefdomMap[`${row.chiefdom.trim().toLowerCase()}|${districtId}`] ?? null)
        : null;
      const communityId = communityMap[`${row.community.trim().toLowerCase()}|${districtId}`] ?? null;
      const rawPhone = row.contactPhone?.trim() || null;
      const phone = rawPhone ? normalisePhoneForStorage(rawPhone) : null;

      // Look up by farmer_group ONLY (no beneficiary_type filter) — on a failed retry the
      // beneficiary_type UPDATE may not have fired, leaving the row as 'individual'.
      // We always re-apply the beneficiary_type update below regardless.
      const { data: existing } = await supa
        .from("farmers")
        .select("id, farmer_code, barcode_token, farmer_group, phone, chiefdom_id")
        .eq("farmer_group", row.community.trim())
        .limit(1)
        .maybeSingle();

      if (existing) {
        // Backfill phone / chiefdom / beneficiary_type if missing
        const backfill: Record<string, unknown> = { beneficiary_type: "group" };
        if (!(existing as any).phone && phone)            backfill.phone       = phone;
        if (!(existing as any).chiefdom_id && chiefdomId) backfill.chiefdom_id = chiefdomId;
        if (communityId) backfill.community_id = communityId;
        await supa.from("farmers").update(backfill).eq("id", (existing as any).id);

        farmerIds.push((existing as any).id);
        communities.push({
          community:    row.community.trim(),
          district:     row.district.trim(),
          farmerCode:   (existing as any).farmer_code   ?? "",
          barcodeToken: (existing as any).barcode_token ?? "",
        });
        continue;
      }

      const farmerCode   = "FMR-" + randomBytes(4).toString("hex").toUpperCase();
      const barcodeToken = "BC-"  + randomBytes(5).toString("hex").toUpperCase();
      const nameParts    = (row.contactPerson ?? "").trim().split(/\s+/);
      const firstName    = nameParts[0] || row.community.trim() || "Group";
      const lastName     = nameParts.slice(1).join(" ") || "Beneficiary";

      // Insert WITHOUT beneficiary_type — PostgREST INSERT schema cache may be stale for that column.
      // It defaults to 'individual'; we UPDATE immediately after to set 'group'.
      const { data: newFarmer, error: farmerErr } = await supa
        .from("farmers")
        .insert({
          farmer_group:   row.community.trim(),
          first_name:     firstName,
          last_name:      lastName,
          gender:         "unknown",
          value_chain_id: valueChainId,
          district_id:    districtId ?? null,
          chiefdom_id:    chiefdomId ?? null,
          community_id:   communityId ?? null,
          phone:          phone ?? null,
          farmer_code:    farmerCode,
          barcode_token:  barcodeToken,
          status:         "pending",
          registered_by:  createdBy ?? null,
        })
        .select("id")
        .single();

      if (farmerErr || !newFarmer) {
        console.error(`Failed to register beneficiary "${row.community}":`, farmerErr);
        res.status(500).json({ error: "Operation failed" });
        return;
      }

      const farmerId = (newFarmer as any).id as number;

      // Set beneficiary_type = 'group' via UPDATE (avoids stale PostgREST INSERT schema cache)
      await supa.from("farmers").update({ beneficiary_type: "group" }).eq("id", farmerId);
      farmerIds.push(farmerId);
      newFarmerCount++;
      communities.push({ community: row.community.trim(), district: row.district.trim(), farmerCode, barcodeToken });

    }

    // 4. Create the dispatch manifest
    const manifestCode = "MAN-" + Date.now().toString(36).toUpperCase() + randomBytes(2).toString("hex").toUpperCase();
    const isHired = b.vehicleType === "hired";

    // 4. Build the manifest item totals. The RPC below creates the dispatch,
    // assigns its officer, creates all items and allocations, and stores the
    // total in one database transaction.
    // NOTE: row.quantities is a compact 0-based array (one entry per column), so we
    // must use the positional index i — NOT col.colIndex (the original spreadsheet column number).
    const dispatchItems: Array<{ input_item_id: number; quantity_loaded: number }> = [];
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const itemId = itemIdMap[col.colIndex];
      if (!itemId) continue;
      const totalQty = rows.reduce((sum, row) => sum + Math.max(0, Number(row.quantities[i]) || 0), 0);
      if (totalQty <= 0) continue;
      dispatchItems.push({ input_item_id: itemId, quantity_loaded: totalQty });
    }

    const { data: importResult, error: importErr } = await supa.rpc("import_dispatch_manifest", {
      p_manifest_code: manifestCode,
      p_campaign_id: campaignId,
      p_warehouse_id: Number(warehouseId),
      p_vehicle_type: b.vehicleType ?? "office",
      p_vehicle_id: isHired || !b.vehicleId ? null : Number(b.vehicleId),
      p_driver_id: isHired || !b.driverId ? null : Number(b.driverId),
      p_hired_plate: isHired && b.hiredPlate ? String(b.hiredPlate).toUpperCase() : null,
      p_hired_driver_name: isHired && b.hiredDriverName ? String(b.hiredDriverName) : null,
      p_field_officer_id: b.fieldOfficerId ? Number(b.fieldOfficerId) : null,
      p_notes: b.notes ?? null,
      p_created_by: createdBy,
      p_farmer_ids: farmerIds,
      p_dispatch_items: dispatchItems,
    });
    if (importErr || !importResult) {
      console.error("Failed to import dispatch manifest atomically:", importErr);
      res.status(400).json({ error: importErr?.message ?? "Operation failed" });
      return;
    }
    const dispatchRow = importResult as Record<string, unknown>;
    const dispatchId = Number(dispatchRow.id);

    await logAudit(
      req, "IMPORT", "Dispatch",
      `Imported dispatch manifest ${manifestCode} from Excel (${rows.length} communities, ${columns.length} items)`,
      "dispatch", dispatchId,
    );

    const warnings: string[] = [];
    if (unmatchedDistricts.length > 0) {
      warnings.push(`Unmatched district names (no district_id assigned): ${unmatchedDistricts.join(", ")}`);
    }

    res.status(201).json({
      dispatch: snakeToCamel(dispatchRow),
      manifestCode,
      campaignId,
      campaignName: autoCampaignName,
      itemsCreated: newItemCount,
      farmersCreated: newFarmerCount,
      totalCommunities: rows.length,
      communities,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
    */
  },
);

// ── GET /api/dispatch/:id/farmers ────────────────────────────────────────────
// Returns allocated farmers for the dispatch's campaign (for web-portal OTP sender).
router.patch("/api/dispatch/:id/archive", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager", "WarehouseManager"), async (req, res) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const { error } = await supa.from("dispatches").update({ archived: true }).eq("id", id);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

router.patch("/api/dispatch/:id/unarchive", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager", "WarehouseManager"), async (req, res) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const { error } = await supa.from("dispatches").update({ archived: false }).eq("id", id);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

router.get("/api/dispatch/:id/farmers", requireAnyAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid dispatch id" }); return; }

  const { data: dispRow, error: dispErr } = await supa
    .from("dispatches")
    .select("campaign_id, manifest_code, field_officer_id")
    .eq("id", id)
    .maybeSingle();

  if (dispErr || !dispRow) { res.status(404).json({ error: "Dispatch not found" }); return; }
  if (!(await canReadDispatch(req, dispRow as any))) { res.status(403).json({ error: "Forbidden" }); return; }
  if (!dispRow.campaign_id) { res.json([]); return; }

  const { data: allocs, error: allocErr } = await supa
    .from("allocations")
    .select("id, farmer_id, status")
    .eq("campaign_id", dispRow.campaign_id)
    .order("id");

  if (allocErr) { res.status(500).json({ error: allocErr.message }); return; }

  // Fetch farmer details separately to avoid PostgREST embedded-join FK resolution issues
  const farmerIds = (allocs ?? []).map((a: any) => a.farmer_id).filter(Boolean);
  const { data: farmerRows } = farmerIds.length
    ? await supa.from("farmers").select("id, first_name, last_name, farmer_code, phone, barcode_token").in("id", farmerIds)
    : { data: [] };

  const farmerMap = Object.fromEntries((farmerRows ?? []).map((f: any) => [f.id, f]));

  const rows = (allocs ?? []).map((a: any) => {
    const f = farmerMap[a.farmer_id] ?? {};
    return {
      allocationId:     a.id,
      farmerId:         a.farmer_id,
      farmerName:       `${f.first_name ?? ""} ${f.last_name ?? ""}`.trim() || "—",
      farmerCode:       f.farmer_code   ?? null,
      phone:            f.phone         ?? null,
      barcodeToken:     f.barcode_token ?? null,
      allocationStatus: a.status,
    };
  });

  res.json(rows);
});

export default router;

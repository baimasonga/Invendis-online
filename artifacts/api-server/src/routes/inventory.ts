import { Router } from "express";
import { supa, snakeToCamel, camelToSnake } from "../lib/supabase.js";
import { requireAuth, requireAnyAuth, requireRoles, requireRoleIfJwt } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { randomBytes } from "crypto";

const router = Router();

router.get("/api/inventory/input-items", requireAuth, async (_req, res) => {
  const { data, error } = await supa.from("input_items").select("*").eq("is_active", 1).order("name");
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(snakeToCamel(data ?? []));
});

router.post("/api/inventory/input-items", requireAuth, requireRoles("Admin", "ProjectManager", "WarehouseManager"), async (req, res) => {
  const itemCode = "ITEM-" + randomBytes(3).toString("hex").toUpperCase();
  const body = camelToSnake(req.body);
  const { data, error } = await supa.from("input_items").insert({ ...body, item_code: itemCode }).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "CREATE", "Inventory", `Created input item: ${(data as any).name}`, "input_item", (data as any).id);
  res.status(201).json(snakeToCamel(data));
});

router.patch("/api/inventory/input-items/:id", requireAuth, requireRoles("Admin", "ProjectManager", "WarehouseManager"), async (req, res) => {
  const id = Number(req.params.id);
  const body = camelToSnake(req.body);
  const { data, error } = await supa.from("input_items").update(body).eq("id", id).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "UPDATE", "Inventory", `Updated input item #${id}`, "input_item", id);
  res.json(snakeToCamel(data));
});

// List all active input items — mobile JWT allowed (for dropdown picker)
router.get("/api/inventory/input-items/mobile", requireAnyAuth, async (_req, res) => {
  const { data, error } = await supa
    .from("input_items")
    .select("id, name, item_code, category, unit")
    .eq("is_active", 1)
    .order("name");
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(snakeToCamel(data ?? []));
});

// Lookup item by barcode OR item_code — mobile JWT allowed
router.get("/api/inventory/input-items/by-barcode/:code", requireAnyAuth, async (req, res) => {
  const code = decodeURIComponent(String(req.params.code)).trim();
  // Try barcode column first, then fall back to item_code
  const { data: byBarcode } = await supa
    .from("input_items").select("*").eq("barcode", code).eq("is_active", 1).limit(1).maybeSingle();
  if (byBarcode) { res.json(snakeToCamel(byBarcode)); return; }
  const { data: byCode } = await supa
    .from("input_items").select("*").ilike("item_code", code).eq("is_active", 1).limit(1).maybeSingle();
  if (byCode) { res.json(snakeToCamel(byCode)); return; }
  res.status(404).json({ error: "No item found for this barcode or item code" });
});

router.get("/api/inventory/stock-balance", requireAuth, async (req, res) => {
  const { warehouseId, inputItemId } = req.query;
  let q = supa.from("stock_balance").select("*");
  if (warehouseId) q = q.eq("warehouse_id", Number(warehouseId)) as typeof q;
  if (inputItemId) q = q.eq("input_item_id", Number(inputItemId)) as typeof q;
  const { data, error } = await q;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(snakeToCamel(data ?? []));
});

router.post("/api/inventory/receive-stock", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager", "WarehouseManager"), async (req, res) => {
  const { warehouseId, inputItemId, quantity, reference, notes } = req.body;
  if (!warehouseId || !inputItemId) { res.status(400).json({ error: "warehouseId and inputItemId are required" }); return; }
  if (!quantity || Number(quantity) <= 0) { res.status(400).json({ error: "quantity must be a positive number" }); return; }
  const { data: atomicResult, error: atomicError } = await supa.rpc("receive_stock_atomic", {
    p_warehouse_id: Number(warehouseId), p_input_item_id: Number(inputItemId), p_quantity: Number(quantity),
    p_reference: reference ?? null, p_notes: notes ?? null,
  });
  if (!atomicError) {
    await logAudit(req, "RECEIVE", "Inventory", `Received ${quantity} units for item ${inputItemId} at warehouse ${warehouseId}`, "stock", Number((atomicResult as any)?.ledger_id) || warehouseId);
    res.json({ success: true, message: "Stock received", data: atomicResult });
    return;
  }
  // Compatibility fallback while an existing deployment is waiting for the
  // migration. Only a missing RPC is tolerated; real database errors fail.
  if (!/receive_stock_atomic|schema cache|function/i.test(atomicError.message)) {
    res.status(500).json({ error: atomicError.message }); return;
  }
  const { data: bal, error: balanceReadError } = await supa.from("stock_balance").select("id,available").eq("warehouse_id", warehouseId).eq("input_item_id", inputItemId).maybeSingle();
  if (balanceReadError) { res.status(500).json({ error: balanceReadError.message }); return; }
  if (bal) {
    const { error } = await supa.from("stock_balance").update({ available: ((bal as any).available ?? 0) + Number(quantity), updated_at: new Date().toISOString() }).eq("id", (bal as any).id);
    if (error) { res.status(500).json({ error: error.message }); return; }
  } else {
    const { error } = await supa.from("stock_balance").insert({ warehouse_id: warehouseId, input_item_id: inputItemId, available: Number(quantity) });
    if (error) { res.status(500).json({ error: error.message }); return; }
  }
  const { error: ledgerError } = await supa.from("stock_ledger").insert({ warehouse_id: warehouseId, input_item_id: inputItemId, txn_type: "RECEIVE", quantity: Number(quantity), reference: reference ?? null, notes: notes ?? null });
  if (ledgerError) { res.status(500).json({ error: ledgerError.message }); return; }
  await logAudit(req, "RECEIVE", "Inventory", `Received ${quantity} units for item ${inputItemId} at warehouse ${warehouseId}`, "stock", warehouseId);
  res.json({ success: true, message: "Stock received" });
});

router.post("/api/inventory/transfer-stock", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager", "WarehouseManager"), async (req, res) => {
  const { fromWarehouseId, toWarehouseId, inputItemId, quantity, notes } = req.body;
  if (!fromWarehouseId || !toWarehouseId || !inputItemId) { res.status(400).json({ error: "fromWarehouseId, toWarehouseId, and inputItemId are required" }); return; }
  if (!quantity || Number(quantity) <= 0) { res.status(400).json({ error: "quantity must be a positive number" }); return; }
  if (Number(fromWarehouseId) === Number(toWarehouseId)) { res.status(400).json({ error: "Source and destination warehouses must be different" }); return; }
  const { data: atomicResult, error: atomicError } = await supa.rpc("transfer_stock_atomic", {
    p_from_warehouse_id: Number(fromWarehouseId), p_to_warehouse_id: Number(toWarehouseId),
    p_input_item_id: Number(inputItemId), p_quantity: Number(quantity), p_notes: notes ?? null,
  });
  if (!atomicError) { res.json({ success: true, message: "Stock transferred", data: atomicResult }); return; }
  if (!/transfer_stock_atomic|schema cache|function/i.test(atomicError.message)) {
    res.status(atomicError.message.toLowerCase().includes("insufficient") ? 409 : 500).json({ error: atomicError.message }); return;
  }
  const { data: src } = await supa.from("stock_balance").select("id,available").eq("warehouse_id", fromWarehouseId).eq("input_item_id", inputItemId).single();
  if (!src || Number((src as any).available ?? 0) < Number(quantity)) { res.status(409).json({ error: "Insufficient available stock" }); return; }
  if (src) await supa.from("stock_balance").update({ available: ((src as any).available ?? 0) - quantity, updated_at: new Date().toISOString() }).eq("id", (src as any).id);
  const { data: dest } = await supa.from("stock_balance").select("id,available").eq("warehouse_id", toWarehouseId).eq("input_item_id", inputItemId).single();
  if (dest) {
    await supa.from("stock_balance").update({ available: ((dest as any).available ?? 0) + quantity, updated_at: new Date().toISOString() }).eq("id", (dest as any).id);
  } else {
    await supa.from("stock_balance").insert({ warehouse_id: toWarehouseId, input_item_id: inputItemId, available: quantity });
  }
  await supa.from("stock_ledger").insert({ warehouse_id: fromWarehouseId, input_item_id: inputItemId, txn_type: "TRANSFER_OUT", quantity: -Number(quantity), notes: notes ?? null });
  await supa.from("stock_ledger").insert({ warehouse_id: toWarehouseId, input_item_id: inputItemId, txn_type: "TRANSFER_IN", quantity: Number(quantity), notes: notes ?? null });
  res.json({ success: true, message: "Stock transferred" });
});

router.get("/api/inventory/transactions", requireAuth, async (req, res) => {
  const { warehouseId, inputItemId, page = "1", limit = "20" } = req.query as Record<string, string>;
  const offset = (Number(page) - 1) * Number(limit);
  let q = supa.from("stock_ledger").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(offset, offset + Number(limit) - 1);
  if (warehouseId) q = q.eq("warehouse_id", Number(warehouseId)) as typeof q;
  if (inputItemId) q = q.eq("input_item_id", Number(inputItemId)) as typeof q;
  const { data, count, error } = await q;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ data: snakeToCamel(data ?? []), total: count ?? 0, page: Number(page), limit: Number(limit) });
});

router.get("/api/procurement", requireAuth, async (_req, res) => {
  const { data, error } = await supa.from("procurement_orders").select("*").order("created_at", { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  const warehouseIds = [...new Set((data ?? []).map((r: any) => r.warehouse_id).filter(Boolean))];
  const { data: warehouses } = warehouseIds.length > 0
    ? await supa.from("warehouses").select("id,name,code").in("id", warehouseIds)
    : { data: [] };
  const whMap = Object.fromEntries((warehouses ?? []).map((w: any) => [w.id, w]));
  res.json((data ?? []).map((r: any) => ({ ...snakeToCamel(r), warehouseName: whMap[r.warehouse_id]?.name ?? null, warehouseCode: whMap[r.warehouse_id]?.code ?? null })));
});

router.post("/api/procurement", requireAuth, requireRoles("Admin", "ProjectManager", "WarehouseManager"), async (req, res) => {
  const orderCode = "PO-" + Date.now().toString(36).toUpperCase();
  const body = camelToSnake(req.body);
  const { data, error } = await supa.from("procurement_orders").insert({ ...body, order_code: orderCode, created_by: req.user!.userId }).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "CREATE", "Procurement", `Created PO: ${orderCode}`, "procurement", (data as any).id);
  res.status(201).json(snakeToCamel(data));
});

router.get("/api/procurement/:id", requireAuth, async (req, res) => {
  const { data: row, error } = await supa.from("procurement_orders").select("*").eq("id", Number(req.params.id)).single();
  if (error || !row) { res.status(404).json({ error: "Not found" }); return; }
  const { data: items } = await supa.from("procurement_items").select("*").eq("order_id", (row as any).id);
  res.json({ ...snakeToCamel(row), items: snakeToCamel(items ?? []) });
});

export default router;

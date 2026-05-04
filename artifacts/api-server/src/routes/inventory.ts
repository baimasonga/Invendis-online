import { Router } from "express";
import { supa, snakeToCamel, camelToSnake } from "../lib/supabase.js";
import { requireAuth } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { randomBytes } from "crypto";

const router = Router();

router.get("/api/inventory/input-items", requireAuth, async (_req, res) => {
  const { data, error } = await supa.from("input_items").select("*").eq("is_active", 1).order("name");
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(snakeToCamel(data ?? []));
});

router.post("/api/inventory/input-items", requireAuth, async (req, res) => {
  const itemCode = "ITEM-" + randomBytes(3).toString("hex").toUpperCase();
  const body = camelToSnake(req.body);
  const { data, error } = await supa.from("input_items").insert({ ...body, item_code: itemCode }).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "CREATE", "Inventory", `Created input item: ${(data as any).name}`, "input_item", (data as any).id);
  res.status(201).json(snakeToCamel(data));
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

router.post("/api/inventory/receive-stock", requireAuth, async (req, res) => {
  const { warehouseId, inputItemId, quantity, reference, notes } = req.body;
  const { data: bal } = await supa.from("stock_balance").select("id,available").eq("warehouse_id", warehouseId).eq("input_item_id", inputItemId).single();
  if (bal) {
    await supa.from("stock_balance").update({ available: ((bal as any).available ?? 0) + quantity, updated_at: new Date().toISOString() }).eq("id", (bal as any).id);
  } else {
    await supa.from("stock_balance").insert({ warehouse_id: warehouseId, input_item_id: inputItemId, available: quantity });
  }
  await supa.from("stock_ledger").insert({ warehouse_id: warehouseId, input_item_id: inputItemId, txn_type: "RECEIVE", quantity, reference: reference ?? null, notes: notes ?? null, created_by: req.user!.userId });
  await logAudit(req, "RECEIVE", "Inventory", `Received ${quantity} units for item ${inputItemId} at warehouse ${warehouseId}`, "stock", warehouseId);
  res.json({ success: true, message: "Stock received" });
});

router.post("/api/inventory/transfer-stock", requireAuth, async (req, res) => {
  const { fromWarehouseId, toWarehouseId, inputItemId, quantity, notes } = req.body;
  const { data: src } = await supa.from("stock_balance").select("id,available").eq("warehouse_id", fromWarehouseId).eq("input_item_id", inputItemId).single();
  if (src) await supa.from("stock_balance").update({ available: ((src as any).available ?? 0) - quantity, updated_at: new Date().toISOString() }).eq("id", (src as any).id);
  const { data: dest } = await supa.from("stock_balance").select("id,available").eq("warehouse_id", toWarehouseId).eq("input_item_id", inputItemId).single();
  if (dest) {
    await supa.from("stock_balance").update({ available: ((dest as any).available ?? 0) + quantity, updated_at: new Date().toISOString() }).eq("id", (dest as any).id);
  } else {
    await supa.from("stock_balance").insert({ warehouse_id: toWarehouseId, input_item_id: inputItemId, available: quantity });
  }
  await supa.from("stock_ledger").insert({ warehouse_id: fromWarehouseId, input_item_id: inputItemId, txn_type: "TRANSFER_OUT", quantity: -quantity, notes: notes ?? null, created_by: req.user!.userId });
  await supa.from("stock_ledger").insert({ warehouse_id: toWarehouseId, input_item_id: inputItemId, txn_type: "TRANSFER_IN", quantity, notes: notes ?? null, created_by: req.user!.userId });
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

router.post("/api/procurement", requireAuth, async (req, res) => {
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

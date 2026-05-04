import { Router } from "express";
import { db, inputItemsTable, stockBalanceTable, stockLedgerTable, procurementOrdersTable, procurementItemsTable, warehousesTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { randomBytes } from "crypto";

const router = Router();

// Input Items — /api/inventory/input-items
router.get("/api/inventory/input-items", requireAuth, async (_req, res) => {
  res.json(await db.select().from(inputItemsTable).orderBy(inputItemsTable.name));
});
router.post("/api/inventory/input-items", requireAuth, async (req, res) => {
  const itemCode = "ITEM-" + randomBytes(3).toString("hex").toUpperCase();
  const [row] = await db.insert(inputItemsTable).values({ ...req.body, itemCode }).returning();
  await logAudit(req, "CREATE", "Inventory", `Created input item: ${row.name}`, "input_item", row.id);
  res.status(201).json(row);
});

// Stock Balance — /api/inventory/stock-balance
router.get("/api/inventory/stock-balance", requireAuth, async (req, res) => {
  const { warehouseId, inputItemId } = req.query;
  const conditions = [];
  if (warehouseId) conditions.push(eq(stockBalanceTable.warehouseId, Number(warehouseId)));
  if (inputItemId) conditions.push(eq(stockBalanceTable.inputItemId, Number(inputItemId)));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  res.json(await db.select().from(stockBalanceTable).where(where));
});

// Receive Stock — /api/inventory/receive-stock
router.post("/api/inventory/receive-stock", requireAuth, async (req, res) => {
  const { warehouseId, inputItemId, quantity, reference, notes } = req.body;

  const existing = await db.select().from(stockBalanceTable)
    .where(and(eq(stockBalanceTable.warehouseId, warehouseId), eq(stockBalanceTable.inputItemId, inputItemId)))
    .limit(1);

  if (existing.length > 0) {
    await db.update(stockBalanceTable)
      .set({ available: sql`${stockBalanceTable.available} + ${quantity}`, updatedAt: new Date() })
      .where(and(eq(stockBalanceTable.warehouseId, warehouseId), eq(stockBalanceTable.inputItemId, inputItemId)));
  } else {
    await db.insert(stockBalanceTable).values({ warehouseId, inputItemId, available: quantity });
  }

  await db.insert(stockLedgerTable).values({ warehouseId, inputItemId, txnType: "RECEIVE", quantity, reference, notes, createdBy: req.user!.userId });
  await logAudit(req, "RECEIVE", "Inventory", `Received ${quantity} units for item ${inputItemId} at warehouse ${warehouseId}`, "stock", warehouseId);
  res.json({ success: true, message: "Stock received" });
});

// Transfer Stock — /api/inventory/transfer-stock
router.post("/api/inventory/transfer-stock", requireAuth, async (req, res) => {
  const { fromWarehouseId, toWarehouseId, inputItemId, quantity, notes } = req.body;
  await db.update(stockBalanceTable)
    .set({ available: sql`${stockBalanceTable.available} - ${quantity}`, updatedAt: new Date() })
    .where(and(eq(stockBalanceTable.warehouseId, fromWarehouseId), eq(stockBalanceTable.inputItemId, inputItemId)));

  const dest = await db.select().from(stockBalanceTable)
    .where(and(eq(stockBalanceTable.warehouseId, toWarehouseId), eq(stockBalanceTable.inputItemId, inputItemId))).limit(1);
  if (dest.length > 0) {
    await db.update(stockBalanceTable).set({ available: sql`${stockBalanceTable.available} + ${quantity}`, updatedAt: new Date() })
      .where(and(eq(stockBalanceTable.warehouseId, toWarehouseId), eq(stockBalanceTable.inputItemId, inputItemId)));
  } else {
    await db.insert(stockBalanceTable).values({ warehouseId: toWarehouseId, inputItemId, available: quantity });
  }
  await db.insert(stockLedgerTable).values({ warehouseId: fromWarehouseId, inputItemId, txnType: "TRANSFER_OUT", quantity: -quantity, notes, createdBy: req.user!.userId });
  await db.insert(stockLedgerTable).values({ warehouseId: toWarehouseId, inputItemId, txnType: "TRANSFER_IN", quantity, notes, createdBy: req.user!.userId });
  res.json({ success: true, message: "Stock transferred" });
});

// Stock Transactions — /api/inventory/transactions
router.get("/api/inventory/transactions", requireAuth, async (req, res) => {
  const { warehouseId, inputItemId, page = "1", limit = "20" } = req.query as Record<string, string>;
  const offset = (Number(page) - 1) * Number(limit);
  const conditions = [];
  if (warehouseId) conditions.push(eq(stockLedgerTable.warehouseId, Number(warehouseId)));
  if (inputItemId) conditions.push(eq(stockLedgerTable.inputItemId, Number(inputItemId)));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(stockLedgerTable).where(where);
  const rows = await db.select().from(stockLedgerTable).where(where).orderBy(desc(stockLedgerTable.createdAt)).limit(Number(limit)).offset(offset);
  res.json({ data: rows, total: Number(count), page: Number(page), limit: Number(limit) });
});

// Procurement Orders
router.get("/api/procurement", requireAuth, async (_req, res) => {
  const rows = await db
    .select({
      id: procurementOrdersTable.id,
      orderCode: procurementOrdersTable.orderCode,
      supplierName: procurementOrdersTable.supplierName,
      warehouseId: procurementOrdersTable.warehouseId,
      warehouseName: warehousesTable.name,
      status: procurementOrdersTable.status,
      totalAmount: procurementOrdersTable.totalAmount,
      orderDate: procurementOrdersTable.orderDate,
      expectedDelivery: procurementOrdersTable.expectedDelivery,
      notes: procurementOrdersTable.notes,
      createdAt: procurementOrdersTable.createdAt,
    })
    .from(procurementOrdersTable)
    .leftJoin(warehousesTable, eq(procurementOrdersTable.warehouseId, warehousesTable.id))
    .orderBy(desc(procurementOrdersTable.createdAt));
  res.json(rows);
});
router.post("/api/procurement", requireAuth, async (req, res) => {
  const orderCode = "PO-" + Date.now().toString(36).toUpperCase();
  const [row] = await db.insert(procurementOrdersTable).values({ ...req.body, orderCode, createdBy: req.user!.userId }).returning();
  await logAudit(req, "CREATE", "Procurement", `Created PO: ${orderCode}`, "procurement", row.id);
  res.status(201).json(row);
});
router.get("/api/procurement/:id", requireAuth, async (req, res) => {
  const [row] = await db.select().from(procurementOrdersTable).where(eq(procurementOrdersTable.id, Number(req.params.id))).limit(1);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  const items = await db.select().from(procurementItemsTable).where(eq(procurementItemsTable.orderId, row.id));
  res.json({ ...row, items });
});

export default router;

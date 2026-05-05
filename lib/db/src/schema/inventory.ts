import { pgTable, serial, text, integer, timestamp, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const inputItemsTable = pgTable("input_items", {
  id: serial("id").primaryKey(),
  itemCode: text("item_code").notNull().unique(),
  name: text("name").notNull(),
  unit: text("unit").notNull(),
  category: text("category"),
  valueChainId: integer("value_chain_id"),
  description: text("description"),
  barcode: text("barcode"),
  isActive: integer("is_active").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const stockLedgerTable = pgTable("stock_ledger", {
  id: serial("id").primaryKey(),
  warehouseId: integer("warehouse_id").notNull(),
  inputItemId: integer("input_item_id").notNull(),
  txnType: text("txn_type").notNull(),
  quantity: doublePrecision("quantity").notNull(),
  reference: text("reference"),
  notes: text("notes"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const stockBalanceTable = pgTable("stock_balance", {
  id: serial("id").primaryKey(),
  warehouseId: integer("warehouse_id").notNull(),
  inputItemId: integer("input_item_id").notNull(),
  available: doublePrecision("available").notNull().default(0),
  reserved: doublePrecision("reserved").notNull().default(0),
  loaded: doublePrecision("loaded").notNull().default(0),
  delivered: doublePrecision("delivered").notNull().default(0),
  returned: doublePrecision("returned").notNull().default(0),
  damaged: doublePrecision("damaged").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const procurementOrdersTable = pgTable("procurement_orders", {
  id: serial("id").primaryKey(),
  orderCode: text("order_code").notNull().unique(),
  supplierId: integer("supplier_id"),
  supplierName: text("supplier_name"),
  warehouseId: integer("warehouse_id").notNull(),
  status: text("status").notNull().default("Draft"),
  totalAmount: doublePrecision("total_amount"),
  orderDate: timestamp("order_date"),
  expectedDelivery: timestamp("expected_delivery"),
  notes: text("notes"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export const procurementItemsTable = pgTable("procurement_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull(),
  inputItemId: integer("input_item_id").notNull(),
  quantityOrdered: doublePrecision("quantity_ordered").notNull(),
  quantityReceived: doublePrecision("quantity_received").default(0),
  unitCost: doublePrecision("unit_cost"),
});

export const insertInputItemSchema = createInsertSchema(inputItemsTable).omit({ id: true, createdAt: true });
export type InsertInputItem = z.infer<typeof insertInputItemSchema>;
export type InputItem = typeof inputItemsTable.$inferSelect;

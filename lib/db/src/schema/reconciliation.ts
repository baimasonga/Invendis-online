import { pgTable, serial, text, integer, timestamp, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const reconciliationsTable = pgTable("reconciliations", {
  id: serial("id").primaryKey(),
  reconciliationCode: text("reconciliation_code").notNull().unique(),
  dispatchId: integer("dispatch_id").notNull(),
  warehouseId: integer("warehouse_id").notNull(),
  loadedQuantity: doublePrecision("loaded_quantity"),
  deliveredQuantity: doublePrecision("delivered_quantity"),
  returnedQuantity: doublePrecision("returned_quantity"),
  damagedQuantity: doublePrecision("damaged_quantity"),
  varianceQuantity: doublePrecision("variance_quantity"),
  status: text("status").notNull().default("Draft"),
  notes: text("notes"),
  createdBy: integer("created_by"),
  approvedBy: integer("approved_by"),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertReconciliationSchema = createInsertSchema(reconciliationsTable).omit({ id: true, createdAt: true, approvedAt: true });
export type InsertReconciliation = z.infer<typeof insertReconciliationSchema>;
export type Reconciliation = typeof reconciliationsTable.$inferSelect;

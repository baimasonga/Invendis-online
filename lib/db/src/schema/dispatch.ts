import { pgTable, serial, text, integer, timestamp, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const dispatchesTable = pgTable("dispatches", {
  id: serial("id").primaryKey(),
  manifestCode: text("manifest_code").notNull().unique(),
  campaignId: integer("campaign_id").notNull(),
  vehicleId: integer("vehicle_id").notNull(),
  driverId: integer("driver_id").notNull(),
  warehouseId: integer("warehouse_id").notNull(),
  status: text("status").notNull().default("Draft"),
  totalPackages: integer("total_packages").default(0),
  deliveredPackages: integer("delivered_packages").default(0),
  notes: text("notes"),
  departedAt: timestamp("departed_at"),
  arrivedAt: timestamp("arrived_at"),
  createdBy: integer("created_by"),
  approvedBy: integer("approved_by"),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export const dispatchItemsTable = pgTable("dispatch_items", {
  id: serial("id").primaryKey(),
  dispatchId: integer("dispatch_id").notNull(),
  inputItemId: integer("input_item_id").notNull(),
  quantityLoaded: doublePrecision("quantity_loaded").notNull(),
  quantityDelivered: doublePrecision("quantity_delivered").default(0),
  quantityReturned: doublePrecision("quantity_returned").default(0),
});

export const insertDispatchSchema = createInsertSchema(dispatchesTable).omit({ id: true, createdAt: true, updatedAt: true, approvedAt: true, departedAt: true, arrivedAt: true });
export type InsertDispatch = z.infer<typeof insertDispatchSchema>;
export type Dispatch = typeof dispatchesTable.$inferSelect;

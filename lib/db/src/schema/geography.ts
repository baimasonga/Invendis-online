import { pgTable, serial, text, integer, timestamp, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const districtsTable = pgTable("districts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const chiefdomsTable = pgTable("chiefdoms", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  districtId: integer("district_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const sectionsTable = pgTable("sections", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  chiefdomId: integer("chiefdom_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const communitiesTable = pgTable("communities", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  sectionId: integer("section_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const valueChainsTable = pgTable("value_chains", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  isActive: integer("is_active").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const warehousesTable = pgTable("warehouses", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  districtId: integer("district_id"),
  address: text("address"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  isActive: integer("is_active").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const distributionSitesTable = pgTable("distribution_sites", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  districtId: integer("district_id"),
  communityId: integer("community_id"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  geofenceRadius: doublePrecision("geofence_radius").default(500),
  isActive: integer("is_active").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertDistrictSchema = createInsertSchema(districtsTable).omit({ id: true, createdAt: true });
export type InsertDistrict = z.infer<typeof insertDistrictSchema>;
export type District = typeof districtsTable.$inferSelect;

export const insertValueChainSchema = createInsertSchema(valueChainsTable).omit({ id: true, createdAt: true });
export type InsertValueChain = z.infer<typeof insertValueChainSchema>;
export type ValueChain = typeof valueChainsTable.$inferSelect;

export const insertWarehouseSchema = createInsertSchema(warehousesTable).omit({ id: true, createdAt: true });
export type InsertWarehouse = z.infer<typeof insertWarehouseSchema>;
export type Warehouse = typeof warehousesTable.$inferSelect;

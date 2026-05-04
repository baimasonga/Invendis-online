import { pgTable, serial, text, integer, timestamp, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const farmersTable = pgTable("farmers", {
  id: serial("id").primaryKey(),
  farmerCode: text("farmer_code").notNull().unique(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  gender: text("gender").notNull(),
  phone: text("phone"),
  nationalId: text("national_id"),
  districtId: integer("district_id").notNull(),
  chiefdomId: integer("chiefdom_id"),
  sectionId: integer("section_id"),
  communityId: integer("community_id"),
  valueChainId: integer("value_chain_id").notNull(),
  farmSize: doublePrecision("farm_size"),
  gpsLatitude: doublePrecision("gps_latitude"),
  gpsLongitude: doublePrecision("gps_longitude"),
  photoUrl: text("photo_url"),
  status: text("status").notNull().default("pending"),
  barcodeToken: text("barcode_token"),
  ageGroup: text("age_group"),
  farmerGroup: text("farmer_group"),
  rejectionReason: text("rejection_reason"),
  registeredBy: integer("registered_by"),
  approvedBy: integer("approved_by"),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export const insertFarmerSchema = createInsertSchema(farmersTable).omit({ id: true, createdAt: true, updatedAt: true, approvedAt: true });
export type InsertFarmer = z.infer<typeof insertFarmerSchema>;
export type Farmer = typeof farmersTable.$inferSelect;

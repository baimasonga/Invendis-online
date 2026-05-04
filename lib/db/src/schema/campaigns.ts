import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const campaignsTable = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  campaignCode: text("campaign_code").notNull().unique(),
  name: text("name").notNull(),
  season: text("season"),
  districtId: integer("district_id"),
  valueChainId: integer("value_chain_id"),
  distributionSiteId: integer("distribution_site_id"),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  status: text("status").notNull().default("Draft"),
  totalFarmers: integer("total_farmers").default(0),
  allocatedFarmers: integer("allocated_farmers").default(0),
  deliveredCount: integer("delivered_count").default(0),
  notes: text("notes"),
  createdBy: integer("created_by"),
  approvedBy: integer("approved_by"),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export const campaignItemsTable = pgTable("campaign_items", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull(),
  inputItemId: integer("input_item_id").notNull(),
  quantityPerFarmer: integer("quantity_per_farmer").notNull().default(1),
  unit: text("unit"),
});

export const allocationsTable = pgTable("allocations", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull(),
  farmerId: integer("farmer_id").notNull(),
  status: text("status").notNull().default("Pending"),
  notes: text("notes"),
  allocatedBy: integer("allocated_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export const insertCampaignSchema = createInsertSchema(campaignsTable).omit({ id: true, createdAt: true, updatedAt: true, approvedAt: true });
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;
export type Campaign = typeof campaignsTable.$inferSelect;

export const insertAllocationSchema = createInsertSchema(allocationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAllocation = z.infer<typeof insertAllocationSchema>;
export type Allocation = typeof allocationsTable.$inferSelect;

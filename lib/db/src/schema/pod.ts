import { pgTable, serial, text, integer, timestamp, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const podTable = pgTable("pod", {
  id: serial("id").primaryKey(),
  podCode: text("pod_code").notNull().unique(),
  farmerId: integer("farmer_id").notNull(),
  campaignId: integer("campaign_id").notNull(),
  dispatchId: integer("dispatch_id"),
  fieldOfficerId: integer("field_officer_id"),
  quantityDelivered: doublePrecision("quantity_delivered"),
  otpStatus: text("otp_status").default("Pending"),
  faceStatus: text("face_status").default("Pending"),
  gpsStatus: text("gps_status").default("Pending"),
  vehicleGpsStatus: text("vehicle_gps_status").default("Pending"),
  status: text("status").notNull().default("Pending"),
  farmerLatitude: doublePrecision("farmer_latitude"),
  farmerLongitude: doublePrecision("farmer_longitude"),
  vehicleLatitude: doublePrecision("vehicle_latitude"),
  vehicleLongitude: doublePrecision("vehicle_longitude"),
  photoUrl: text("photo_url"),
  signatureUrl: text("signature_url"),
  notes: text("notes"),
  exceptionReason: text("exception_reason"),
  approvedBy: integer("approved_by"),
  approvedAt: timestamp("approved_at"),
  submittedAt: timestamp("submitted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPodSchema = createInsertSchema(podTable).omit({ id: true, createdAt: true, approvedAt: true, submittedAt: true });
export type InsertPod = z.infer<typeof insertPodSchema>;
export type Pod = typeof podTable.$inferSelect;

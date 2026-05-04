import { pgTable, serial, text, integer, timestamp, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const vehiclesTable = pgTable("vehicles", {
  id: serial("id").primaryKey(),
  vehicleCode: text("vehicle_code").notNull().unique(),
  plateNumber: text("plate_number").notNull().unique(),
  vehicleType: text("vehicle_type").notNull(),
  make: text("make"),
  model: text("model"),
  year: integer("year"),
  capacity: doublePrecision("capacity"),
  gpsDeviceId: text("gps_device_id"),
  status: text("status").notNull().default("Active"),
  lastLatitude: doublePrecision("last_latitude"),
  lastLongitude: doublePrecision("last_longitude"),
  lastPing: timestamp("last_ping"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const driversTable = pgTable("drivers", {
  id: serial("id").primaryKey(),
  driverCode: text("driver_code").notNull().unique(),
  fullName: text("full_name").notNull(),
  phone: text("phone"),
  licenseNumber: text("license_number"),
  licenseExpiry: timestamp("license_expiry"),
  isActive: integer("is_active").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const gpsTrackTable = pgTable("gps_track", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").notNull(),
  dispatchId: integer("dispatch_id"),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  speed: doublePrecision("speed"),
  heading: doublePrecision("heading"),
  accuracy: doublePrecision("accuracy"),
  recordedAt: timestamp("recorded_at").notNull().defaultNow(),
});

export const insertVehicleSchema = createInsertSchema(vehiclesTable).omit({ id: true, createdAt: true, lastPing: true });
export type InsertVehicle = z.infer<typeof insertVehicleSchema>;
export type Vehicle = typeof vehiclesTable.$inferSelect;

export const insertDriverSchema = createInsertSchema(driversTable).omit({ id: true, createdAt: true });
export type InsertDriver = z.infer<typeof insertDriverSchema>;
export type Driver = typeof driversTable.$inferSelect;

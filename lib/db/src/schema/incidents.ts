import { pgTable, serial, text, integer, timestamp, doublePrecision } from "drizzle-orm/pg-core";

export const incidentsTable = pgTable("incidents", {
  id: serial("id").primaryKey(),
  incidentCode: text("incident_code").notNull().unique(),
  type: text("type").notNull(),
  description: text("description").notNull(),
  location: text("location"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  fieldOfficerId: integer("field_officer_id"),
  reportedBy: text("reported_by"),
  deviceId: text("device_id"),
  status: text("status").notNull().default("Open"),
  resolvedBy: integer("resolved_by"),
  resolvedAt: timestamp("resolved_at"),
  resolutionNotes: text("resolution_notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Incident = typeof incidentsTable.$inferSelect;

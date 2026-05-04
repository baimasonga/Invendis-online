import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const auditLogsTable = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  username: text("username"),
  action: text("action").notNull(),
  module: text("module").notNull(),
  description: text("description"),
  entityType: text("entity_type"),
  entityId: integer("entity_id"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AuditLog = typeof auditLogsTable.$inferSelect;

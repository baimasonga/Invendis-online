import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const otpCodesTable = pgTable("otp_codes", {
  id: serial("id").primaryKey(),
  farmerId: integer("farmer_id").notNull(),
  codeHash: text("code_hash").notNull(),
  channel: text("channel").notNull().default("none"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

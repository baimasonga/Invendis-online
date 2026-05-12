import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const systemSettingsTable = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  description: text("description"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

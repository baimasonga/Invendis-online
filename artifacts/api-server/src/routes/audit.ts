import { Router } from "express";
import { db, auditLogsTable } from "@workspace/db";
import { eq, and, ilike, sql, desc, gte, lte } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";

const router = Router();

router.get("/api/audit", requireAuth, async (req, res) => {
  const { module, action, userId, fromDate, toDate, page = "1", limit = "50" } = req.query as Record<string, string>;
  const offset = (Number(page) - 1) * Number(limit);
  const conditions = [];
  if (module) conditions.push(eq(auditLogsTable.module, module));
  if (action) conditions.push(eq(auditLogsTable.action, action));
  if (userId) conditions.push(eq(auditLogsTable.userId, Number(userId)));
  if (fromDate) conditions.push(gte(auditLogsTable.createdAt, new Date(fromDate)));
  if (toDate) conditions.push(lte(auditLogsTable.createdAt, new Date(toDate)));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(auditLogsTable).where(where);
  const rows = await db.select().from(auditLogsTable).where(where).orderBy(desc(auditLogsTable.createdAt)).limit(Number(limit)).offset(offset);
  res.json({ data: rows, total: Number(count), page: Number(page), limit: Number(limit) });
});

export default router;

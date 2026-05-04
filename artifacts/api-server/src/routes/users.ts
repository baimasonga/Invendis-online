import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth, requireRoles, hashPassword } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";

const router = Router();

router.get("/api/users", requireAuth, requireRoles("Admin", "ProjectManager"), async (_req, res) => {
  const rows = await db.select({
    id: usersTable.id, username: usersTable.username, fullName: usersTable.fullName,
    email: usersTable.email, role: usersTable.role, districtId: usersTable.districtId,
    isActive: usersTable.isActive, lastLogin: usersTable.lastLogin, createdAt: usersTable.createdAt,
  }).from(usersTable).orderBy(desc(usersTable.createdAt));
  res.json(rows);
});

router.post("/api/users", requireAuth, requireRoles("Admin"), async (req, res) => {
  const { password, ...rest } = req.body;
  const passwordHash = await hashPassword(password);
  const [row] = await db.insert(usersTable).values({ ...rest, passwordHash }).returning({
    id: usersTable.id, username: usersTable.username, fullName: usersTable.fullName,
    email: usersTable.email, role: usersTable.role, districtId: usersTable.districtId, isActive: usersTable.isActive,
  });
  await logAudit(req, "CREATE", "Users", `Created user: ${row.username}`, "user", row.id);
  res.status(201).json(row);
});

router.get("/api/users/:id", requireAuth, requireRoles("Admin", "ProjectManager"), async (req, res) => {
  const [row] = await db.select({
    id: usersTable.id, username: usersTable.username, fullName: usersTable.fullName,
    email: usersTable.email, role: usersTable.role, districtId: usersTable.districtId,
    isActive: usersTable.isActive, lastLogin: usersTable.lastLogin, createdAt: usersTable.createdAt,
  }).from(usersTable).where(eq(usersTable.id, Number(req.params.id))).limit(1);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.put("/api/users/:id", requireAuth, requireRoles("Admin"), async (req, res) => {
  const { password, ...rest } = req.body;
  const updates: Record<string, unknown> = { ...rest, updatedAt: new Date() };
  if (password) updates.passwordHash = await hashPassword(password);
  const [row] = await db.update(usersTable).set(updates).where(eq(usersTable.id, Number(req.params.id))).returning({
    id: usersTable.id, username: usersTable.username, fullName: usersTable.fullName,
    email: usersTable.email, role: usersTable.role, districtId: usersTable.districtId, isActive: usersTable.isActive,
  });
  await logAudit(req, "UPDATE", "Users", `Updated user ID ${req.params.id}`, "user", row.id);
  res.json(row);
});

router.post("/api/users/:id/activate", requireAuth, requireRoles("Admin"), async (req, res) => {
  const [row] = await db.update(usersTable).set({ isActive: true }).where(eq(usersTable.id, Number(req.params.id))).returning({
    id: usersTable.id, username: usersTable.username, isActive: usersTable.isActive,
  });
  await logAudit(req, "ACTIVATE", "Users", `Activated user ID ${req.params.id}`, "user", row.id);
  res.json(row);
});

router.post("/api/users/:id/deactivate", requireAuth, requireRoles("Admin"), async (req, res) => {
  const [row] = await db.update(usersTable).set({ isActive: false }).where(eq(usersTable.id, Number(req.params.id))).returning({
    id: usersTable.id, username: usersTable.username, isActive: usersTable.isActive,
  });
  await logAudit(req, "DEACTIVATE", "Users", `Deactivated user ID ${req.params.id}`, "user", row.id);
  res.json(row);
});

export default router;

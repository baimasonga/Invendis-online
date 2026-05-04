import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { signToken, comparePassword, requireAuth } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";

const router = Router();

router.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: "Bad Request", message: "username and password required" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.username, username)).limit(1);
  if (!user || !user.isActive) {
    res.status(401).json({ error: "Unauthorized", message: "Invalid credentials" });
    return;
  }
  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Unauthorized", message: "Invalid credentials" });
    return;
  }
  await db.update(usersTable).set({ lastLogin: new Date() }).where(eq(usersTable.id, user.id));
  const token = signToken({ userId: user.id, username: user.username, role: user.role, districtId: user.districtId });
  res.json({ token, user: { id: user.id, username: user.username, fullName: user.fullName, email: user.email, role: user.role, districtId: user.districtId, isActive: user.isActive } });
});

router.get("/api/auth/me", requireAuth, async (req, res) => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
  if (!user) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ id: user.id, username: user.username, fullName: user.fullName, email: user.email, role: user.role, districtId: user.districtId, isActive: user.isActive });
});

router.post("/api/auth/logout", requireAuth, async (req, res) => {
  await logAudit(req, "LOGOUT", "Auth", `${req.user!.username} logged out`);
  res.json({ success: true, message: "Logged out" });
});

export default router;

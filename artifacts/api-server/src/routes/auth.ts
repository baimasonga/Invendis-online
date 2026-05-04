import { Router } from "express";
import { supa } from "../lib/supabase.js";
import { signToken, comparePassword, requireAuth } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";

const router = Router();

router.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: "Bad Request", message: "username and password required" });
    return;
  }
  const { data: users, error } = await supa.from("users").select("*").eq("username", username).limit(1);
  if (error || !users?.length) {
    res.status(401).json({ error: "Unauthorized", message: "Invalid credentials" });
    return;
  }
  const user = users[0];
  if (!user.is_active) {
    res.status(401).json({ error: "Unauthorized", message: "Account inactive" });
    return;
  }
  const valid = await comparePassword(password, user.password_hash);
  if (!valid) {
    res.status(401).json({ error: "Unauthorized", message: "Invalid credentials" });
    return;
  }
  await supa.from("users").update({ last_login: new Date().toISOString() }).eq("id", user.id);
  const token = signToken({ userId: user.id, username: user.username, role: user.role, districtId: user.district_id });
  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      email: user.email,
      role: user.role,
      districtId: user.district_id,
      isActive: user.is_active,
    },
  });
});

router.get("/api/auth/me", requireAuth, async (req, res) => {
  const { data: users } = await supa.from("users").select("id,username,full_name,email,role,district_id,is_active").eq("id", req.user!.userId).limit(1);
  if (!users?.length) { res.status(404).json({ error: "Not found" }); return; }
  const u = users[0];
  res.json({ id: u.id, username: u.username, fullName: u.full_name, email: u.email, role: u.role, districtId: u.district_id, isActive: u.is_active });
});

router.post("/api/auth/logout", requireAuth, async (req, res) => {
  await logAudit(req, "LOGOUT", "Auth", `${req.user!.username} logged out`);
  res.json({ success: true, message: "Logged out" });
});

export default router;

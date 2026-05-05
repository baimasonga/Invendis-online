import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { supa } from "../lib/supabase.js";
import { signToken, hashPassword, requireAuth } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";

const router = Router();

router.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: "Bad Request", message: "email and password required" });
    return;
  }

  // 1. Verify credentials via Supabase Auth (anon key required for signInWithPassword)
  const supaUrl = process.env.SUPABASE_URL;
  const supaAnon = process.env.SUPABASE_ANON_KEY;
  if (!supaUrl || !supaAnon) {
    res.status(500).json({ error: "Server Error", message: "Auth not configured" });
    return;
  }
  const anonClient = createClient(supaUrl, supaAnon, { auth: { persistSession: false } });
  const { data: authData, error: authError } = await anonClient.auth.signInWithPassword({ email, password });
  if (authError || !authData.user) {
    res.status(401).json({ error: "Unauthorized", message: "Invalid credentials" });
    return;
  }

  // 2. Get profile for role, is_active, district (source of truth for permissions)
  const { data: profile } = await supa
    .from("profiles")
    .select("id,full_name,role,is_active,district_id,email")
    .eq("id", authData.user.id)
    .single();
  if (!profile) {
    res.status(401).json({ error: "Unauthorized", message: "Account profile not found" });
    return;
  }
  if (profile.is_active === false) {
    res.status(401).json({ error: "Unauthorized", message: "Account is inactive" });
    return;
  }

  // 3. Find or auto-create the integer user record (used as FK in dispatch, pod, etc.)
  const { data: existingUsers } = await supa
    .from("users")
    .select("id,username,email,full_name,role,district_id,is_active")
    .eq("email", email)
    .limit(1);

  let user = existingUsers?.[0];

  if (!user) {
    // First mobile login for a web-portal-created user — create the record
    const placeholder = await hashPassword(`SUPABASE_${authData.user.id}_${Date.now()}`);
    const { data: newUser, error: insertErr } = await supa
      .from("users")
      .insert({
        username: email,
        password_hash: placeholder,
        full_name: profile.full_name ?? email,
        email,
        role: profile.role ?? "FieldOfficer",
        district_id: profile.district_id ?? null,
        is_active: true,
      })
      .select("id,username,email,full_name,role,district_id,is_active")
      .single();
    if (insertErr || !newUser) {
      res.status(500).json({ error: "Server Error", message: "Failed to provision mobile account" });
      return;
    }
    user = newUser;
  } else {
    // Sync is_active from profiles (deactivation on web should block mobile too)
    const profileActive = profile.is_active !== false;
    if (user.is_active !== profileActive) {
      await supa.from("users").update({ is_active: profileActive }).eq("id", user.id);
    }
  }

  await supa.from("users").update({ last_login: new Date().toISOString() }).eq("id", user.id);

  const role = profile.role ?? user.role;
  const token = signToken({
    userId: user.id,
    username: email,
    role,
    districtId: user.district_id ?? null,
  });

  res.json({
    token,
    user: {
      id: user.id,
      username: email,
      fullName: user.full_name ?? profile.full_name,
      email,
      role,
      districtId: user.district_id ?? null,
      isActive: profile.is_active !== false,
    },
  });
});

router.get("/api/auth/me", requireAuth, async (req, res) => {
  const { data: users } = await supa
    .from("users")
    .select("id,username,full_name,email,role,district_id,is_active")
    .eq("id", req.user!.userId)
    .limit(1);
  if (!users?.length) { res.status(404).json({ error: "Not found" }); return; }
  const u = users[0];
  res.json({
    id: u.id,
    username: u.username,
    fullName: u.full_name,
    email: u.email,
    role: u.role,
    districtId: u.district_id,
    isActive: u.is_active,
  });
});

router.post("/api/auth/logout", requireAuth, async (req, res) => {
  await logAudit(req, "LOGOUT", "Auth", `${req.user!.username} logged out`);
  res.json({ success: true, message: "Logged out" });
});

export default router;

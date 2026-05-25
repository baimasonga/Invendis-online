import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { supa } from "../lib/supabase.js";
import { signToken, hashPassword, requireAuth } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { validateBody, LoginSchema } from "../lib/validate.js";

const router = Router();

// Simple in-memory rate limiter: max 10 login attempts per IP per 15 min
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
function checkLoginRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || entry.resetAt < now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return false;
  }
  entry.count++;
  return entry.count > 10;
}

router.post("/api/auth/login", validateBody(LoginSchema), async (req, res) => {
  const ip = req.ip ?? "unknown";
  if (checkLoginRateLimit(ip)) {
    res.status(429).json({ error: "Too many login attempts. Try again in 15 minutes." });
    return;
  }
  try {
    const { email, password } = req.body as { email: string; password: string };

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

    // 2. Get profile for role, is_active, district (source of truth for permissions).
    //    Auto-provision on first login from Supabase user_metadata so existing
    //    auth users don't need manual profile setup.
    const { data: existingProfile } = await supa
      .from("profiles")
      .select("id,full_name,role,is_active,district_id,email")
      .eq("id", authData.user.id)
      .single();

    let profile = existingProfile as any;

    if (!profile) {
      const meta = (authData.user.user_metadata ?? {}) as Record<string, unknown>;
      const autoRole  = String(meta.role  ?? "FieldOfficer");
      const autoName  = String(meta.full_name ?? email);
      req.log.info({ userId: authData.user.id, autoRole }, "Auto-provisioning profile from user_metadata");
      const { data: newProfile, error: profileCreateErr } = await supa
        .from("profiles")
        .insert({ id: authData.user.id, email, full_name: autoName, role: autoRole, is_active: true })
        .select("id,full_name,role,is_active,district_id,email")
        .single();
      if (profileCreateErr || !newProfile) {
        req.log.error({ profileCreateErr }, "Failed to auto-provision profile");
        res.status(401).json({ error: "Unauthorized", message: "Account profile not found" });
        return;
      }
      profile = newProfile;
    }

    if ((profile as any).is_active === false) {
      res.status(401).json({ error: "Unauthorized", message: "Account is inactive" });
      return;
    }

    // 3. Find or auto-create the integer user record (used as FK in dispatch, pod, etc.)
    const { data: existingUsers, error: lookupErr } = await supa
      .from("users")
      .select("id,username,email,full_name,role,district_id,is_active")
      .eq("email", email)
      .limit(1);

    if (lookupErr) {
      req.log.error({ lookupErr }, "Failed to query users table during login");
      res.status(500).json({ error: "Server Error", message: "Database error during login" });
      return;
    }

    let user = existingUsers?.[0];

    if (!user) {
      // First mobile login for a web-portal-created user — create the integer user record.
      // The sequence may be out of sync with the actual max id (e.g. after manual inserts),
      // so compute the next safe id explicitly to avoid duplicate-key errors.
      const placeholder = await hashPassword(`SUPABASE_${authData.user.id}_${Date.now()}`);

      const { data: maxRow } = await supa
        .from("users")
        .select("id")
        .order("id", { ascending: false })
        .limit(1)
        .single();
      const nextId = ((maxRow as { id: number } | null)?.id ?? 0) + 1;

      const { data: newUser, error: insertErr } = await supa
        .from("users")
        .insert({
          id: nextId,
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
        req.log.error(
          { insertErr, email, role: profile.role, districtId: profile.district_id, nextId },
          "Failed to auto-provision mobile user in integer users table",
        );
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
  } catch (err: unknown) {
    req.log.error({ err }, "Unhandled error in POST /api/auth/login");
    res.status(500).json({ error: "Server Error", message: "Unexpected error during login" });
  }
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

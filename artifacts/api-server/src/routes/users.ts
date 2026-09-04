import { Router } from "express";
import { supa, snakeToCamel, camelToSnake } from "../lib/supabase.js";
import { ensureIntegerUserId } from "../lib/users.js";
import { requireAuth, requireAnyAuth, requireRoles, hashPassword } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";

const router = Router();

router.get("/api/users", requireAuth, requireRoles("Admin", "ProjectManager"), async (_req, res) => {
  const { data, error } = await supa.from("users").select("id,username,full_name,email,role,district_id,is_active,last_login,created_at").order("created_at", { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(snakeToCamel(data ?? []));
});

router.post("/api/users", requireAuth, requireRoles("Admin"), async (req, res) => {
  const { password, ...rest } = req.body;
  const passwordHash = await hashPassword(password);
  const body = camelToSnake(rest);
  const { data, error } = await supa.from("users").insert({ ...body, password_hash: passwordHash }).select("id,username,full_name,email,role,district_id,is_active").single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "CREATE", "Users", `Created user: ${(data as any).username}`, "user", (data as any).id);
  res.status(201).json(snakeToCamel(data));
});

router.get("/api/users/:id", requireAuth, requireRoles("Admin", "ProjectManager"), async (req, res) => {
  const { data: rows, error } = await supa.from("users").select("id,username,full_name,email,role,district_id,is_active,last_login,created_at").eq("id", Number(req.params.id)).limit(1);
  if (error || !rows?.length) { res.status(404).json({ error: "Not found" }); return; }
  res.json(snakeToCamel(rows[0]));
});

router.put("/api/users/:id", requireAuth, requireRoles("Admin"), async (req, res) => {
  const { password, ...rest } = req.body;
  const body = camelToSnake(rest) as Record<string, unknown>;
  body.updated_at = new Date().toISOString();
  if (password) body.password_hash = await hashPassword(password);
  const { data, error } = await supa.from("users").update(body).eq("id", Number(req.params.id)).select("id,username,full_name,email,role,district_id,is_active").single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "UPDATE", "Users", `Updated user ID ${req.params.id}`, "user", (data as any).id);
  res.json(snakeToCamel(data));
});

router.post("/api/users/:id/activate", requireAuth, requireRoles("Admin"), async (req, res) => {
  const { data, error } = await supa.from("users").update({ is_active: true }).eq("id", Number(req.params.id)).select("id,username,is_active").single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "ACTIVATE", "Users", `Activated user ID ${req.params.id}`, "user", (data as any).id);
  res.json(snakeToCamel(data));
});

router.post("/api/users/:id/deactivate", requireAuth, requireRoles("Admin"), async (req, res) => {
  const { data, error } = await supa.from("users").update({ is_active: false }).eq("id", Number(req.params.id)).select("id,username,is_active").single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "DEACTIVATE", "Users", `Deactivated user ID ${req.params.id}`, "user", (data as any).id);
  res.json(snakeToCamel(data));
});

async function requireAdmin(req: any, res: any): Promise<string | null> {
  let role: string | null = null;
  if (req.user) {
    role = req.user.role;
  } else if (req.supabaseUser?.id) {
    const { data } = await supa.from("profiles").select("role").eq("id", req.supabaseUser.id).single();
    role = (data as any)?.role ?? null;
  }
  if (!role || role.toLowerCase() !== "admin") {
    res.status(403).json({ error: "Forbidden", message: "Only admins can perform this action" });
    return null;
  }
  return role;
}

router.post("/api/users/profile/:id/activate", requireAnyAuth, async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const { error } = await supa.from("profiles").update({ is_active: true }).eq("id", req.params.id);
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "ACTIVATE", "Users", `Activated profile ${req.params.id}`, "user", 0);
  res.json({ success: true });
});

router.post("/api/users/profile/:id/deactivate", requireAnyAuth, async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const { error } = await supa.from("profiles").update({ is_active: false }).eq("id", req.params.id);
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "DEACTIVATE", "Users", `Deactivated profile ${req.params.id}`, "user", 0);
  res.json({ success: true });
});

router.patch("/api/users/profile/:id/role", requireAnyAuth, async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const { role } = req.body;
  if (!role) { res.status(400).json({ error: "role is required" }); return; }
  const { data, error } = await supa.from("profiles").update({ role }).eq("id", req.params.id).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "UPDATE", "Users", `Changed role for profile ${req.params.id} to ${role}`, "user", 0);
  res.json(snakeToCamel(data));
});

router.patch("/api/users/profile/:id/name", requireAnyAuth, async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const { fullName } = req.body;
  if (!fullName) { res.status(400).json({ error: "fullName is required" }); return; }
  const { data, error } = await supa.from("profiles").update({ full_name: fullName }).eq("id", req.params.id).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "UPDATE", "Users", `Updated name for profile ${req.params.id}`, "user", 0);
  res.json(snakeToCamel(data));
});

// Returns (and provisions on first use) the integer users.id that FK columns
// such as registered_by / approved_by reference for the current actor.
router.get("/api/users/me/integer-id", requireAnyAuth, async (req, res) => {
  const id = await ensureIntegerUserId(req);
  if (!id) { res.status(404).json({ error: "No operational user record for this account" }); return; }
  res.json({ id });
});

router.post("/api/users/create-profile", requireAnyAuth, async (req, res) => {
  let role: string | null = null;
  if (req.user) {
    role = req.user.role;
  } else if (req.supabaseUser?.id) {
    const { data } = await supa.from("profiles").select("role").eq("id", req.supabaseUser.id).single();
    role = (data as any)?.role ?? null;
  }
  if (!role || role.toLowerCase() !== "admin") {
    res.status(403).json({ error: "Forbidden", message: "Only admins can create users" });
    return;
  }

  const { email, password, fullName, userRole } = req.body;
  if (!email || !password || !fullName || !userRole) {
    res.status(400).json({ error: "Bad Request", message: "email, password, fullName and userRole are required" });
    return;
  }
  if (String(password).length < 6) {
    res.status(400).json({ error: "Bad Request", message: "Password must be at least 6 characters" });
    return;
  }

  try {
    const { data: authData, error: authErr } = await supa.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, role: userRole },
    });
    if (authErr || !authData.user) {
      res.status(500).json({ error: authErr?.message ?? "Failed to create auth user" });
      return;
    }

    const { error: profileErr } = await supa.from("profiles").upsert({
      id: authData.user.id,
      full_name: fullName,
      email,
      role: userRole,
      is_active: true,
    });
    if (profileErr) {
      await supa.auth.admin.deleteUser(authData.user.id).catch(() => {});
      res.status(500).json({ error: profileErr.message });
      return;
    }

    await logAudit(req, "CREATE", "Users", `Created user: ${email} (${userRole})`, "user", 0);
    res.status(201).json({ id: authData.user.id, email, fullName, role: userRole, isActive: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/users/profile/:id", requireAnyAuth, async (req, res) => {
  let role: string | null = null;
  if (req.user) {
    role = req.user.role;
  } else if (req.supabaseUser?.id) {
    const { data } = await supa.from("profiles").select("role").eq("id", req.supabaseUser.id).single();
    role = (data as any)?.role ?? null;
  }
  if (!role || role.toLowerCase() !== "admin") {
    res.status(403).json({ error: "Forbidden", message: "Only admins can delete users" });
    return;
  }
  const profileId = String(req.params.id);
  if (req.supabaseUser?.id === profileId) {
    res.status(400).json({ error: "Cannot delete your own account" });
    return;
  }
  try {
    const { error } = await supa.auth.admin.deleteUser(profileId);
    if (error) { res.status(500).json({ error: error.message }); return; }
    await logAudit(req, "DELETE", "Users", `Deleted user profile ${profileId}`, "user", 0);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/users/profile/:id/reset-password", requireAnyAuth, async (req, res) => {
  let role: string | null = null;
  if (req.user) {
    role = req.user.role;
  } else if (req.supabaseUser?.id) {
    const { data } = await supa.from("profiles").select("role").eq("id", req.supabaseUser.id).single();
    role = (data as any)?.role ?? null;
  }
  if (!role || role.toLowerCase() !== "admin") {
    res.status(403).json({ error: "Forbidden", message: "Only admins can reset passwords" });
    return;
  }
  const { password } = req.body;
  if (!password || String(password).length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" });
    return;
  }
  try {
    const { error } = await supa.auth.admin.updateUserById(String(req.params.id), { password });
    if (error) { res.status(500).json({ error: error.message }); return; }
    await logAudit(req, "RESET_PASSWORD", "Users", `Reset password for profile ${req.params.id}`, "user", 0);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

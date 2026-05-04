import { Router } from "express";
import { supa, snakeToCamel, camelToSnake } from "../lib/supabase.js";
import { requireAuth, requireRoles, hashPassword } from "../lib/auth.js";
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

export default router;

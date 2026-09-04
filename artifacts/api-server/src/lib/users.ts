import type { Request } from "express";
import { supa } from "./supabase.js";
import { hashPassword } from "./auth.js";

/**
 * Resolves the integer `users.id` for the authenticated actor.
 *
 * Mobile JWTs carry the id directly. Supabase (web portal) sessions only have a
 * `profiles` row until the user first logs into the mobile app, so a portal-only
 * account is provisioned here on demand. Every integer FK column (registered_by,
 * approved_by, created_by, field_officer_id, …) depends on this row existing.
 */
export async function ensureIntegerUserId(req: Request): Promise<number | null> {
  if (req.user?.userId) return req.user.userId;
  const sb = req.supabaseUser;
  if (!sb?.email) return null;

  const { data: existing } = await supa
    .from("users")
    .select("id")
    .eq("email", sb.email)
    .limit(1)
    .maybeSingle();
  if ((existing as any)?.id) return (existing as any).id as number;

  const { data: profile } = await supa
    .from("profiles")
    .select("full_name,role,district_id,is_active")
    .eq("id", sb.id)
    .maybeSingle();
  if (profile && (profile as any).is_active === false) return null;

  // The sequence may lag behind manual inserts, so compute the next id explicitly
  // (mirrors the mobile login provisioning path).
  const { data: maxRow } = await supa
    .from("users")
    .select("id")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextId = ((maxRow as { id: number } | null)?.id ?? 0) + 1;
  const placeholder = await hashPassword(`SUPABASE_${sb.id}_${Date.now()}`);

  const { data: created, error } = await supa
    .from("users")
    .insert({
      id: nextId,
      username: sb.email,
      password_hash: placeholder,
      full_name: (profile as any)?.full_name ?? sb.email,
      email: sb.email,
      role: (profile as any)?.role ?? sb.role ?? "Viewer",
      district_id: (profile as any)?.district_id ?? null,
      is_active: true,
    })
    .select("id")
    .single();
  if (error || !created) {
    // A concurrent request may have provisioned the row first.
    const { data: retry } = await supa.from("users").select("id").eq("email", sb.email).limit(1).maybeSingle();
    return (retry as any)?.id ?? null;
  }
  return (created as any).id as number;
}

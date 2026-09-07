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

  // Provisioning goes through an RPC that takes the id from users_id_seq in one
  // statement. Assigning max(id) + 1 here instead would leave the sequence
  // behind the table, and the next POST /api/users — which inserts without an
  // id, so takes nextval — would collide on the primary key.
  const placeholder = await hashPassword(`SUPABASE_${sb.id}_${Date.now()}`);
  const { data: provisioned, error } = await supa.rpc("provision_user_account", {
    p_email: sb.email,
    p_username: sb.email,
    p_password_hash: placeholder,
    p_full_name: (profile as any)?.full_name ?? sb.email,
    p_role: (profile as any)?.role ?? sb.role ?? "Viewer",
    p_district_id: (profile as any)?.district_id ?? null,
  });
  if (error || provisioned == null) {
    // A concurrent request may have provisioned the row first.
    const { data: retry } = await supa
      .from("users")
      .select("id")
      .eq("email", sb.email)
      .limit(1)
      .maybeSingle();
    return (retry as any)?.id ?? null;
  }
  return Number(provisioned);
}

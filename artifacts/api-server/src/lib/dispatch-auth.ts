import type { Request } from "express";
import { supa } from "./supabase.js";
import { isDispatchInScope, type DispatchReadScope } from "./dispatch-scope.js";

const DISPATCH_MANAGEMENT_ROLES = new Set(["admin", "projectmanager", "warehousemanager"]);

export type { DispatchReadScope } from "./dispatch-scope.js";

async function requester(req: Request): Promise<{ role: string; userId: number | null; districtId: number | null }> {
  if (req.user) {
    return {
      role: req.user.role.toLowerCase(),
      userId: req.user.userId,
      districtId: req.user.districtId ?? null,
    };
  }

  if (!req.supabaseUser?.id) return { role: "", userId: null, districtId: null };
  // The portal profile is the authority for Supabase users. In particular, do
  // not use a potentially stale legacy users.district_id for district scope.
  const { data: profile } = await supa
    .from("profiles")
    .select("role,district_id")
    .eq("id", req.supabaseUser.id)
    .maybeSingle();
  const role = ((profile as any)?.role ?? req.supabaseUser.role ?? "").toLowerCase();
  const districtId = (profile as any)?.district_id ?? null;

  // Only FieldOfficer assignment checks need the legacy integer user ID.
  // Avoid resolving it for management and district-scoped portal users.
  if (role !== "fieldofficer" || !req.supabaseUser.email) {
    return { role, userId: null, districtId };
  }
  const { data } = await supa
    .from("users")
    .select("id")
    .eq("email", req.supabaseUser.email)
    .maybeSingle();
  return {
    role,
    userId: (data as any)?.id ?? null,
    districtId,
  };
}

/** Resolve the dispatch records a request may read for either auth mechanism. */
export async function getDispatchReadScope(req: Request): Promise<DispatchReadScope> {
  const actor = await requester(req);
  if (DISPATCH_MANAGEMENT_ROLES.has(actor.role)) return { unrestricted: true };
  if (actor.role === "fieldofficer") {
    return actor.userId == null ? { unrestricted: false, fieldOfficerId: -1 } : { unrestricted: false, fieldOfficerId: actor.userId };
  }
  if (actor.districtId == null) return { unrestricted: false, campaignIds: [] };

  const { data } = await supa.from("campaigns").select("id").eq("district_id", actor.districtId);
  return { unrestricted: false, campaignIds: (data ?? []).map((campaign: any) => campaign.id) };
}

/** Check a loaded dispatch before any related or sensitive data is fetched. */
export async function canReadDispatch(req: Request, dispatch: { field_officer_id?: number | null; campaign_id?: number | null }): Promise<boolean> {
  const scope = await getDispatchReadScope(req);
  return isDispatchInScope(scope, dispatch);
}
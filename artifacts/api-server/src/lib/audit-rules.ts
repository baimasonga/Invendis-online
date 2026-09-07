// Who may assert an audit entry, and for what.
//
// The portal performs some mutations directly against Supabase under RLS, so
// the server never observes them and can only record what the client reports.
// An unconstrained report endpoint lets any authenticated session write
// arbitrary APPROVE/DELETE/REJECT events into the log that administrators read,
// which is audit-trail forgery even though the entry is attributed to the
// caller. The report is therefore constrained to what the caller's role could
// actually have done: the sets below mirror the RLS write policies in
// 20260904000000_harden_web_security.sql, so a Viewer or FieldOfficer — which
// hold no write policy on any of these tables — may assert nothing at all.
//
// This narrows forgery to actions the caller is genuinely authorised to
// perform. Removing it entirely means moving these mutations behind API routes
// so the server audits them as a side effect of doing the work, which is the
// right end state but a larger change than this.

/** Verbs the portal is allowed to report. */
export const AUDIT_ACTIONS = new Set([
  "CREATE",
  "UPDATE",
  "DELETE",
  "APPROVE",
  "REJECT",
  "SUBMIT",
  "DISPATCH",
  "ARRIVE",
  "RECEIVE",
  "LINK",
  "UNLINK",
]);

const FIELD_OPERATIONS = ["admin", "projectmanager", "districtcoordinator"];
const SUPPLY_CHAIN = ["admin", "projectmanager", "warehousemanager"];
const SUPERVISION = [
  "admin",
  "projectmanager",
  "districtcoordinator",
  "warehousemanager",
];

/**
 * Module the portal reports against, mapped to the roles RLS lets write the
 * underlying tables. A module that is not listed cannot be asserted at all, so
 * a novel module string cannot widen the surface — and anything the API already
 * audits server-side (user administration, campaigns, dispatch approval) is
 * deliberately absent, because a second client-side record would be a forgeable
 * duplicate of a trustworthy one.
 */
export const MODULE_WRITERS: Record<string, readonly string[]> = {
  farmers: FIELD_OPERATIONS,
  incidents: SUPERVISION,
  vehicles: SUPPLY_CHAIN,
  drivers: SUPPLY_CHAIN,
  dispatch: SUPPLY_CHAIN,
  procurement: SUPPLY_CHAIN,
  reconciliations: SUPPLY_CHAIN,
};

/** "District Coordinator", "district_coordinator" and "DistrictCoordinator" are one role. */
export function normaliseRole(raw: unknown): string {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/[\s_-]/g, "");
}

export function canAssertAudit(args: {
  role: unknown;
  module: unknown;
  action: unknown;
}): boolean {
  const action = String(args.action ?? "")
    .toUpperCase()
    .slice(0, 32);
  if (!AUDIT_ACTIONS.has(action)) return false;
  const writers = MODULE_WRITERS[String(args.module ?? "").toLowerCase().trim()];
  if (!writers) return false;
  return writers.includes(normaliseRole(args.role));
}

// Who may assert an audit entry, and for exactly what.
//
// The portal performs some mutations directly against Supabase under RLS, so
// the server never observes them and can only record what the client reports.
// An unconstrained report endpoint lets an authenticated session write
// operational events into the log administrators read — audit-trail forgery,
// even though the entry carries the caller's own identity.
//
// Every rule below is derived from a real client-side call site: the module is
// one the portal mutates through Supabase, the roles are the ones RLS lets
// write that table (20260904000000_harden_web_security.sql), and the actions
// are only those the portal actually performs there. Nothing is listed "in
// case", because an action nobody performs is purely an attack surface.
//
// Deliberately absent:
//   * Anything the API already audits as a side effect of doing the work —
//     campaigns, allocations, PoD, user administration, dispatch approval,
//     start, arrival and receipt. A forgeable client copy of a trustworthy
//     record is worse than no copy.
//   * Lifecycle verbs (SUBMIT, DISPATCH, ARRIVE, RECEIVE, APPROVE on anything
//     but farmers). Those transitions all run server-side, so a client claiming
//     one is by definition claiming something that did not happen here.

interface ModuleRule {
  /** Roles RLS permits to write the underlying table. */
  readonly roles: readonly string[];
  /** Actions the portal genuinely performs against it through Supabase. */
  readonly actions: readonly string[];
}

const FIELD_OPERATIONS = ["admin", "projectmanager", "districtcoordinator"];
const SUPPLY_CHAIN = ["admin", "projectmanager", "warehousemanager"];
const SUPERVISION = [
  "admin",
  "projectmanager",
  "districtcoordinator",
  "warehousemanager",
];

export const CLIENT_ASSERTABLE: Record<string, ModuleRule> = {
  // Approval and rejection are the one lifecycle pair that really does happen
  // in the browser: the portal updates farmers.status directly.
  farmers: {
    roles: FIELD_OPERATIONS,
    actions: ["CREATE", "UPDATE", "APPROVE", "REJECT", "DELETE"],
  },
  incidents: { roles: SUPERVISION, actions: ["UPDATE"] },
  vehicles: { roles: SUPPLY_CHAIN, actions: ["CREATE", "UPDATE", "DELETE"] },
  drivers: { roles: SUPPLY_CHAIN, actions: ["CREATE", "UPDATE", "DELETE"] },
  procurement: { roles: SUPPLY_CHAIN, actions: ["CREATE", "UPDATE", "DELETE"] },
  reconciliations: { roles: SUPPLY_CHAIN, actions: ["DELETE"] },
  // Deleting a manifest or one of its lines is a direct Supabase delete, so
  // dropping the module would leave a destructive operation unrecorded. The
  // dispatch lifecycle — approve, start, arrive, receive — runs through the API
  // and is audited there, so DELETE is the only verb assertable here and a
  // warehouse manager cannot claim to have approved anything.
  dispatch: { roles: SUPPLY_CHAIN, actions: ["DELETE"] },
};

/** Every verb any module permits; nothing outside this set is accepted. */
export const AUDIT_ACTIONS = new Set(
  Object.values(CLIENT_ASSERTABLE).flatMap((rule) => rule.actions),
);

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
  const rule = CLIENT_ASSERTABLE[String(args.module ?? "").toLowerCase().trim()];
  if (!rule) return false;
  const action = String(args.action ?? "")
    .toUpperCase()
    .slice(0, 32);
  if (!rule.actions.includes(action)) return false;
  return rule.roles.includes(normaliseRole(args.role));
}

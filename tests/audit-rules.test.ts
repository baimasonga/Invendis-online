import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AUDIT_ACTIONS,
  CLIENT_ASSERTABLE,
  canAssertAudit,
  normaliseRole,
} from "../artifacts/api-server/src/lib/audit-rules.ts";

test("read-only and field roles cannot assert operational events", () => {
  // The reported hole: any authenticated session could write APPROVE, DELETE
  // or REJECT entries into the log administrators read.
  for (const role of ["Viewer", "FieldOfficer", "field_officer", "", null]) {
    for (const action of ["APPROVE", "DELETE", "REJECT", "UPDATE", "CREATE"]) {
      assert.equal(
        canAssertAudit({ role, module: "farmers", action }),
        false,
        `${String(role)} must not assert ${action} on farmers`,
      );
    }
  }
});

test("a role may assert only what RLS lets it write", () => {
  // farmers is field_operations_write; vehicles is supply_chain_write.
  assert.equal(canAssertAudit({ role: "DistrictCoordinator", module: "farmers", action: "APPROVE" }), true);
  assert.equal(canAssertAudit({ role: "DistrictCoordinator", module: "vehicles", action: "DELETE" }), false);
  assert.equal(canAssertAudit({ role: "WarehouseManager", module: "vehicles", action: "DELETE" }), true);
  assert.equal(canAssertAudit({ role: "WarehouseManager", module: "farmers", action: "APPROVE" }), false);
  assert.equal(canAssertAudit({ role: "Admin", module: "farmers", action: "APPROVE" }), true);
  assert.equal(canAssertAudit({ role: "ProjectManager", module: "procurement", action: "CREATE" }), true);
});

test("nobody can assert a dispatch approval", () => {
  // Dispatch approval is restricted to Admin and ProjectManager and runs
  // server-side, where it is audited. A warehouse manager holds the supply
  // chain write policy, so without a per-module action list they could report
  // an approval they are not permitted to perform and that never happened.
  for (const role of ["WarehouseManager", "Admin", "ProjectManager", "DistrictCoordinator"]) {
    assert.equal(
      canAssertAudit({ role, module: "dispatch", action: "APPROVE" }),
      false,
      `${role} must not assert a dispatch approval`,
    );
  }
  // Deleting a manifest is a direct Supabase delete, so it stays recordable.
  assert.equal(canAssertAudit({ role: "WarehouseManager", module: "dispatch", action: "DELETE" }), true);
  assert.equal(canAssertAudit({ role: "Viewer", module: "dispatch", action: "DELETE" }), false);
});

test("lifecycle verbs that only happen server-side are assertable nowhere", () => {
  for (const action of ["SUBMIT", "DISPATCH", "ARRIVE", "RECEIVE", "LINK", "UNLINK", "ACTIVATE", "RESET_PASSWORD"]) {
    for (const module of Object.keys(CLIENT_ASSERTABLE)) {
      assert.equal(
        canAssertAudit({ role: "Admin", module, action }),
        false,
        `${action} must not be assertable on ${module}`,
      );
    }
  }
});

test("APPROVE and REJECT are assertable only where the browser truly performs them", () => {
  // The portal updates farmers.status directly; every other approval is an API
  // call the server audits itself.
  for (const module of Object.keys(CLIENT_ASSERTABLE)) {
    const expected = module === "farmers";
    for (const action of ["APPROVE", "REJECT"]) {
      assert.equal(
        canAssertAudit({ role: "Admin", module, action }),
        expected,
        `${action} on ${module} should be ${expected}`,
      );
    }
  }
});

test("each module accepts only the actions the portal performs there", () => {
  assert.deepEqual(CLIENT_ASSERTABLE.reconciliations.actions, ["DELETE"]);
  assert.deepEqual(CLIENT_ASSERTABLE.incidents.actions, ["UPDATE"]);
  assert.deepEqual(CLIENT_ASSERTABLE.dispatch.actions, ["DELETE"]);
  assert.equal(canAssertAudit({ role: "Admin", module: "incidents", action: "DELETE" }), false);
  assert.equal(canAssertAudit({ role: "Admin", module: "reconciliations", action: "CREATE" }), false);
});

test("an unknown module cannot be asserted", () => {
  // Otherwise a novel module string would widen the surface, and would also
  // pollute the module filter on the audit screen.
  assert.equal(canAssertAudit({ role: "Admin", module: "payroll", action: "UPDATE" }), false);
  assert.equal(canAssertAudit({ role: "Admin", module: "", action: "UPDATE" }), false);
  assert.equal(canAssertAudit({ role: "Admin", module: undefined, action: "UPDATE" }), false);
});

test("modules the server already audits are not client-assertable", () => {
  // A second, forgeable copy of a trustworthy server-written record is worse
  // than no record at all.
  for (const module of ["users", "campaigns", "pod", "allocations"]) {
    assert.equal(
      canAssertAudit({ role: "Admin", module, action: "DELETE" }),
      false,
      `${module} is audited server-side and must not be assertable`,
    );
  }
});

test("an unknown verb is refused", () => {
  assert.equal(canAssertAudit({ role: "Admin", module: "farmers", action: "ESCALATE" }), false);
  assert.equal(canAssertAudit({ role: "Admin", module: "farmers", action: "" }), false);
  for (const action of AUDIT_ACTIONS)
    assert.equal(canAssertAudit({ role: "Admin", module: "farmers", action }), true);
});

test("role spelling variations resolve to one role", () => {
  assert.equal(normaliseRole("District Coordinator"), "districtcoordinator");
  assert.equal(normaliseRole("district_coordinator"), "districtcoordinator");
  assert.equal(normaliseRole("DistrictCoordinator"), "districtcoordinator");
  assert.equal(normaliseRole(undefined), "");
});

test("every mapped module grants only operational roles and a real action set", () => {
  for (const [module, rule] of Object.entries(CLIENT_ASSERTABLE)) {
    assert.ok(rule.roles.includes("admin"), `${module} must include admin`);
    assert.ok(!rule.roles.includes("viewer"), `${module} must not grant viewer`);
    assert.ok(!rule.roles.includes("fieldofficer"), `${module} must not grant fieldofficer`);
    assert.ok(rule.actions.length > 0, `${module} must list its actions`);
    for (const action of rule.actions) assert.ok(AUDIT_ACTIONS.has(action));
  }
});

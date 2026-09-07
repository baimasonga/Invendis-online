import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AUDIT_ACTIONS,
  MODULE_WRITERS,
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

test("every mapped module grants only operational roles", () => {
  for (const [module, roles] of Object.entries(MODULE_WRITERS)) {
    assert.ok(roles.includes("admin"), `${module} must include admin`);
    assert.ok(!roles.includes("viewer"), `${module} must not grant viewer`);
    assert.ok(!roles.includes("fieldofficer"), `${module} must not grant fieldofficer`);
  }
});

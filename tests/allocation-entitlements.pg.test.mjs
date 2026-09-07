import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Replays schema.sql and every migration into a scratch database and runs the
// SQL suites. Exit code 127 means no PostgreSQL was reachable, which is not a
// failure of the code under test — but CI sets PG_REGRESSION_REQUIRED so a
// runner without a database fails loudly instead of going green having tested
// nothing.
const required = process.env.PG_REGRESSION_REQUIRED === "1";

test("allocation entitlement SQL regression suite", { timeout: 300_000 }, (t) => {
  const run = spawnSync(resolve(root, "scripts/pg-regression.sh"), {
    cwd: root,
    encoding: "utf8",
    shell: false,
  });
  const unavailable = run.error?.code === "ENOENT" || run.status === 127;
  if (unavailable && !required) {
    t.skip("no PostgreSQL available; set PG_REGRESSION_REQUIRED=1 to enforce");
    return;
  }
  assert.ok(
    !unavailable,
    `PG_REGRESSION_REQUIRED is set but no PostgreSQL was reachable:\n${run.stdout}\n${run.stderr}`,
  );
  assert.equal(
    run.status,
    0,
    `regression suite failed:\n${run.stdout}\n${run.stderr}`,
  );
  // Guard the two findings this suite exists to keep fixed.
  assert.match(run.stdout, /ok {2}reservation sums entitlements/);
  assert.match(run.stdout, /ok {2}an inactive approver is refused/);
});

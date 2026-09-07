import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Replays schema.sql and every migration into a throwaway cluster and runs the
// SQL suites. Exit code 127 means no postgres server binaries are installed,
// which is not a failure of the code under test.
test("allocation entitlement SQL regression suite", { timeout: 300_000 }, (t) => {
  const run = spawnSync(resolve(root, "scripts/pg-regression.sh"), {
    cwd: root,
    encoding: "utf8",
    shell: false,
  });
  if (run.error?.code === "ENOENT" || run.status === 127) {
    t.skip("postgres server binaries not available");
    return;
  }
  assert.equal(
    run.status,
    0,
    `regression suite failed:\n${run.stdout}\n${run.stderr}`,
  );
  assert.match(run.stdout, /ok {2}reservation sums entitlements/);
  assert.match(run.stdout, /ok {2}an inactive approver is refused/);
});

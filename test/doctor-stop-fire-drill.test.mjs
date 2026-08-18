import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pushStopFireDrillChecks } from "../src/cli/doctor-stop-fire-drill.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("doctor ops.stop_fire_drill", () => {
  it("reports stop fire-drill status", async () => {
    const checks = [];
    await pushStopFireDrillChecks(
      (id, status, msg) => checks.push({ id, status, msg }),
      {},
      { root }
    );
    assert.equal(checks[0].id, "ops.stop_fire_drill");
    assert.ok(["ok", "warn", "error"].includes(checks[0].status));
  });
});

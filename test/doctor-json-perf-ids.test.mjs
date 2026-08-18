import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pushPerfChecks } from "../src/cli/doctor-perf-checks.mjs";

describe("doctor --json flake + cold-start ids", () => {
  it("emits eval.flake_budget and ops.cold_start", () => {
    const checks = [];
    const push = (id, status, message, detail) => {
      checks.push({ id, status, message, detail });
    };
    pushPerfChecks(push, {});
    const ids = checks.map((c) => c.id);
    assert.ok(ids.includes("eval.flake_budget"), ids.join(","));
    assert.ok(ids.includes("ops.cold_start"), ids.join(","));
  });
});

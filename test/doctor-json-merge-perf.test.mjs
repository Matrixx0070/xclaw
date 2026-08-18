import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mergePerfIntoChecks } from "../src/cli/doctor-perf-ensure.mjs";

describe("doctor JSON merge perf", () => {
  it("adds ops.cold_start when missing", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-dj-"));
    const checks = [{ id: "config.load", status: "ok", message: "ok" }];
    await mergePerfIntoChecks(checks, {
      paths: { configDir: dir },
      ops: {
        runColdStartSmoke: false,
        coldStartProbe: () => ({ totalMs: 50, healthStatus: 200 }),
      },
    });
    assert.ok(checks.some((c) => c.id === "ops.cold_start"));
    assert.ok(checks.some((c) => c.id === "config.load"));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("does not duplicate ids", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-dj2-"));
    const checks = [
      { id: "ops.cold_start", status: "ok", message: "already" },
    ];
    await mergePerfIntoChecks(checks, {
      paths: { configDir: dir },
      ops: {
        runColdStartSmoke: false,
        coldStartProbe: () => ({ totalMs: 50, healthStatus: 200 }),
      },
    });
    assert.equal(checks.filter((c) => c.id === "ops.cold_start").length, 1);
    assert.equal(checks[0].message, "already");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

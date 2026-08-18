import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pushPerfChecksEnsured } from "../src/cli/doctor-perf-ensure.mjs";

describe("doctor perf ensure cold-start", () => {
  it("writes a report then pushes ops.cold_start ok", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-dcs-"));
    const checks = [];
    await pushPerfChecksEnsured(
      (id, status, message) => checks.push({ id, status, message }),
      {
        paths: { configDir: dir },
        ops: {
          runColdStartSmoke: false,
          coldStartProbe: () => ({ totalMs: 120, healthStatus: 200 }),
        },
      }
    );
    const cold = checks.find((c) => c.id === "ops.cold_start");
    assert.ok(cold);
    assert.equal(cold.status, "ok");
    assert.ok(fs.existsSync(path.join(dir, "cold-start.json")));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

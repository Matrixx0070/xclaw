import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectDoctorPerfChecks } from "../src/cli/doctor-perf-ensure.mjs";

describe("doctor json ops.cold_start", () => {
  it("includes ops.cold_start after ensure", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-djson-"));
    const { checks, coldStart } = await collectDoctorPerfChecks({
      paths: { configDir: dir },
      ops: {
        runColdStartSmoke: false,
        coldStartProbe: () => ({ totalMs: 80, healthStatus: 200 }),
      },
    });
    assert.ok(checks.some((c) => c.id === "ops.cold_start"));
    assert.equal(coldStart.status, "ok");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

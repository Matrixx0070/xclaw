import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureColdStartReport } from "../src/ops/ensure-cold-start.mjs";

describe("ensureColdStartReport", () => {
  it("writes via probe when missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-ecs-"));
    const dest = path.join(dir, "cold-start.json");
    const cfg = { paths: { coldStartReport: dest } };
    const r = ensureColdStartReport(cfg, {
      runSmoke: false,
      probe: () => ({ ok: true, totalMs: 120, healthStatus: 200 }),
    });
    assert.equal(r.wrote, true);
    assert.equal(r.reason, "probe");
    assert.ok(fs.existsSync(dest));
    const onDisk = JSON.parse(fs.readFileSync(dest, "utf8"));
    assert.equal(onDisk.totalMs, 120);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("does not overwrite an existing report", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-ecs-"));
    const dest = path.join(dir, "cold-start.json");
    fs.writeFileSync(dest, JSON.stringify({ totalMs: 50, healthStatus: 200 }));
    const r = ensureColdStartReport(
      { paths: { coldStartReport: dest } },
      { runSmoke: false, probe: () => ({ totalMs: 999 }) }
    );
    assert.equal(r.wrote, false);
    assert.equal(r.reason, "exists");
    assert.equal(r.report.totalMs, 50);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

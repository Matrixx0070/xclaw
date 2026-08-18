import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { persistColdStartReport, coldStartReportPath } from "../src/ops/cold-start-persist.mjs";

describe("cold-start persist", () => {
  it("writes atomic json report", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-cs-"));
    const dest = path.join(dir, "cold-start.json");
    const saved = persistColdStartReport(
      { ok: true, totalMs: 180, healthStatus: 200 },
      { paths: { coldStartReport: dest } }
    );
    assert.equal(saved.path, dest);
    const onDisk = JSON.parse(fs.readFileSync(dest, "utf8"));
    assert.equal(onDisk.totalMs, 180);
    assert.ok(onDisk.at);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("default path is under .xclaw", () => {
    const p = coldStartReportPath({});
    assert.ok(p.includes(".xclaw"));
    assert.ok(p.endsWith("cold-start.json"));
  });
});

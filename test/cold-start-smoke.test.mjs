/**
 * Cold-start smoke regression — under 5s budget.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("cold-start smoke", () => {
  it("script exists", () => {
    assert.ok(fs.existsSync(path.join(root, "scripts/cold-start-smoke.mjs")));
  });

  it("completes under 5s with /health 200", () => {
    const r = spawnSync(
      process.execPath,
      [path.join(root, "scripts/cold-start-smoke.mjs")],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, XCLAW_COLD_START_MAX_MS: "5000" },
        timeout: 15_000,
      }
    );
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const m = String(r.stdout || "").match(/\{[\s\S]*"healthStatus"[\s\S]*\}/);
    assert.ok(m, "no report JSON in stdout");
    const report = JSON.parse(m[0]);
    assert.equal(report.ok, true);
    assert.ok(report.totalMs <= 5000, `totalMs=${report.totalMs}`);
    assert.equal(report.healthStatus, 200);
  });
});

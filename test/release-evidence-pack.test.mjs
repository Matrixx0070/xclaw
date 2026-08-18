/**
 * Release evidence pack pins doctor/eval JSON under reports/release/.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("release evidence pack", () => {
  const basDir = path.join(root, "eval", "baselines");
  const releaseRoot = path.join(root, "reports", "release");

  it("script exists", () => {
    assert.ok(fs.existsSync(path.join(root, "scripts/release-evidence-pack.mjs")));
  });

  it("packs synthetic baselines into reports/release", () => {
    fs.mkdirSync(basDir, { recursive: true });
    fs.writeFileSync(
      path.join(basDir, "last-doctor.json"),
      JSON.stringify({ ok: true, checks: [{ id: "t", status: "ok" }] })
    );
    fs.writeFileSync(
      path.join(basDir, "last-mock.json"),
      JSON.stringify({ passRate: 1, total: 3 })
    );

    const r = spawnSync(
      process.execPath,
      [path.join(root, "scripts/release-evidence-pack.mjs")],
      { cwd: root, encoding: "utf8" }
    );
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const latest = JSON.parse(
      fs.readFileSync(path.join(releaseRoot, "latest.json"), "utf8")
    );
    assert.equal(latest.kind, "xclaw_release_evidence");
    assert.equal(latest.schemaVersion, 1);
    assert.equal(latest.artifacts.doctor, true);
    assert.equal(latest.artifacts.mock, true);
    assert.ok(latest.stamp);
    const packDir = path.join(root, latest.paths.dir);
    assert.ok(fs.existsSync(path.join(packDir, "manifest.json")));
    assert.ok(fs.existsSync(path.join(packDir, "last-doctor.json")));
    assert.ok(fs.existsSync(path.join(packDir, "last-mock.json")));
  });

  it("--require-artifacts fails when missing", () => {
    const tmp = path.join(root, "eval", "baselines-hide-test");
    if (fs.existsSync(basDir)) {
      try {
        fs.renameSync(basDir, tmp);
      } catch {
        /* */
      }
    }
    try {
      const r = spawnSync(
        process.execPath,
        [path.join(root, "scripts/release-evidence-pack.mjs"), "--require-artifacts"],
        { cwd: root, encoding: "utf8" }
      );
      assert.equal(r.status, 1);
    } finally {
      if (fs.existsSync(tmp)) {
        try {
          fs.renameSync(tmp, basDir);
        } catch {
          /* */
        }
      }
    }
  });
});

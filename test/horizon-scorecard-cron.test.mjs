import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { doctorHorizon } from "../src/cli/doctor-horizon.mjs";
import { lastScorecardPath } from "../src/eval/horizon-scorecard-last.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("horizon scorecard cron", () => {
  it("wrapper script exists and is executable", () => {
    const sh = path.join(root, "scripts/horizon-scorecard.sh");
    const cron = path.join(root, "scripts/horizon-scorecard.cron");
    assert.ok(fs.existsSync(sh));
    assert.ok(fs.existsSync(cron));
    const st = fs.statSync(sh);
    assert.ok(st.mode & 0o100);
  });

  it("CLI writes last-scorecard.json and exits 0", () => {
    const r = spawnSync(
      process.execPath,
      [path.join(root, "src/eval/horizon-scorecard-cli.mjs")],
      { encoding: "utf8", cwd: root }
    );
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const fp = lastScorecardPath(root);
    assert.ok(fs.existsSync(fp));
    const j = JSON.parse(fs.readFileSync(fp, "utf8"));
    assert.equal(j.ok, true);
  });

  it("doctor exposes last scorecard path", async () => {
    const d = await doctorHorizon({});
    assert.ok(d.lastScorecardPath);
    assert.ok("lastScorecardOk" in d);
  });
});

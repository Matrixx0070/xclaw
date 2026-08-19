import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { doctorHorizon } from "../src/cli/doctor-horizon.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("live G10-G14 nightly", () => {
  it("wrapper and cron exist", () => {
    const sh = path.join(root, "scripts/horizon-live-g10-g14.sh");
    const cron = path.join(root, "scripts/horizon-live-g10-g14.cron");
    assert.ok(fs.existsSync(sh));
    assert.ok(fs.existsSync(cron));
    assert.ok(fs.statSync(sh).mode & 0o100);
    const body = fs.readFileSync(sh, "utf8");
    assert.ok(body.includes("XCLAW_SOAK_MAX_USD"));
    assert.ok(body.includes("XCLAW_SOAK_CONFIRM"));
  });

  it("without confirm is dry-run (no provider)", () => {
    const env = { ...process.env };
    delete env.XCLAW_SOAK_CONFIRM;
    const r = spawnSync(
      "bash",
      [path.join(root, "scripts/horizon-live-g10-g14.sh")],
      { encoding: "utf8", cwd: root, env }
    );
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.ok(
      (r.stdout + r.stderr).includes("dry-run") ||
        (r.stdout + r.stderr).includes("live_dry_run")
    );
  });

  it("doctor exposes last live usd/ok", async () => {
    const d = await doctorHorizon({});
    assert.ok("lastLiveUsedUsd" in d || "lastLiveReport" in d);
  });
});

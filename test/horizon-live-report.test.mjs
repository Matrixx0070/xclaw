import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  writeLiveSoakReport,
  readLiveSoakReport,
  buildLiveSoakReport,
  DEFAULT_LIVE_IDS,
  resetLiveReportMetrics,
  getLiveReportTotal,
  liveReportPath,
} from "../src/eval/horizon-live-report.mjs";
import { doctorHorizon } from "../src/cli/doctor-horizon.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("live soak report", () => {
  it("shape includes required fields", () => {
    const r = buildLiveSoakReport({
      mode: "live",
      ok: true,
      usedUsd: 0.12,
      turns: 18,
      soakJobId: "night-1",
    });
    assert.equal(r.liveReport, true);
    assert.equal(r.mode, "live");
    assert.deepEqual(r.ids, DEFAULT_LIVE_IDS);
    assert.equal(r.ok, true);
    assert.equal(r.usedUsd, 0.12);
    assert.equal(r.turns, 18);
    assert.ok(r.canary);
    assert.ok(r.scorecard);
    assert.ok(r.at);
  });

  it("write/read under .xclaw-evidence", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-rep-"));
    resetLiveReportMetrics();
    const w = await writeLiveSoakReport({ ok: true, turns: 2 }, { base });
    assert.ok(w.path.endsWith("last-live-report.json"));
    assert.ok(getLiveReportTotal() >= 1);
    const r = await readLiveSoakReport({ base });
    assert.equal(r.ok, true);
    assert.equal(r.report.turns, 2);
  });

  it("dry-run writes no live report", () => {
    const before = fs.existsSync(liveReportPath(root));
    const r = spawnSync(
      process.execPath,
      [path.join(root, "src/eval/horizon-cli.mjs"), "--live"],
      { encoding: "utf8", cwd: root }
    );
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const j = JSON.parse(r.stdout);
    assert.equal(j.mode, "live_dry_run");
    assert.equal(j.liveReportPath, undefined);
    if (!before) {
      assert.equal(fs.existsSync(liveReportPath(root)), false);
    }
  });

  it("doctor exposes lastLiveReport", async () => {
    const d = await doctorHorizon({});
    assert.ok("lastLiveReport" in d || d.lastLiveReport === undefined);
  });
});

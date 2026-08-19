import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  buildAutonomyScorecard,
  resetScorecardMetrics,
  getScorecardOk,
} from "../src/eval/horizon-scorecard.mjs";
import { doctorHorizon } from "../src/cli/doctor-horizon.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("autonomy scorecard", () => {
  it("ok when pack complete and hmac 0", async () => {
    resetScorecardMetrics();
    const card = await buildAutonomyScorecard({});
    assert.equal(card.ok, true, JSON.stringify(card));
    assert.equal(card.packComplete, true);
    assert.equal(card.hmacFail, 0);
    assert.equal(getScorecardOk(), 1);
    assert.ok(card.metrics.includes("xclaw_autonomy_scorecard_ok"));
  });

  it("missing G-id fails scorecard", async () => {
    resetScorecardMetrics();
    const card = await buildAutonomyScorecard({
      doctor: {
        ok: true,
        packComplete: false,
        missing: ["G20"],
        siemHmacFail: 0,
        soakPolicy: { maxUsd: 2, maxTurns: 8 },
        horizonCaseCount: 10,
      },
    });
    assert.equal(card.ok, false);
    assert.deepEqual(card.missing, ["G20"]);
    assert.equal(getScorecardOk(), 0);
  });

  it("doctor embeds scorecard", async () => {
    const d = await doctorHorizon({});
    assert.ok(d.scorecard);
    assert.equal(typeof d.scorecard.ok, "boolean");
  });

  it("CLI exits 0", () => {
    const r = spawnSync(
      process.execPath,
      [path.join(root, "src/eval/horizon-scorecard-cli.mjs")],
      { encoding: "utf8", cwd: root }
    );
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const j = JSON.parse(r.stdout);
    assert.equal(j.ok, true);
  });
});

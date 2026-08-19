import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  loadSoakPolicy,
  checkSoakCaps,
  beforeSoakTurn,
} from "../src/eval/horizon-soak-policy.mjs";
import {
  resetSoakMetrics,
  incSoakBlock,
  getSoakBlockTotal,
} from "../src/eval/horizon-soak-metrics.mjs";
import { runHorizonLive } from "../src/eval/horizon-live.mjs";
import { doctorHorizon } from "../src/cli/doctor-horizon.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("horizon soak policy", () => {
  it("loads env caps", () => {
    const p = loadSoakPolicy({ maxUsd: 1.5, maxTurns: 4 });
    assert.equal(p.maxUsd, 1.5);
    assert.equal(p.maxTurns, 4);
  });
  it("blocks over USD and turns", () => {
    const p = loadSoakPolicy({ maxUsd: 1, maxTurns: 2, usedUsd: 0, turns: 0 });
    assert.equal(checkSoakCaps(p, { usedUsd: 2, turns: 0 }).ok, false);
    assert.equal(checkSoakCaps(p, { usedUsd: 0, turns: 5 }).ok, false);
    assert.equal(checkSoakCaps(p, { usedUsd: 0.5, turns: 1 }).ok, true);
  });
  it("beforeSoakTurn increments and can block", () => {
    const p = loadSoakPolicy({ maxUsd: 10, maxTurns: 1, turns: 1 });
    const r = beforeSoakTurn(p, { turns: 1, usedUsd: 0 });
    assert.equal(r.ok, false);
    assert.equal(r.code, "SOAK_TURNS_EXCEEDED");
  });
  it("live path blocks when already over cap", async () => {
    resetSoakMetrics();
    process.env.XAI_API_KEY = process.env.XAI_API_KEY || "test-key-not-real";
    const r = await runHorizonLive({
      requireLive: true,
      maxUsd: 0.01,
      usedUsd: 1,
      maxTurns: 8,
      runAgent: async () => {
        throw new Error("should not call provider");
      },
    });
    assert.equal(r.ok, false);
    assert.equal(r.mode, "soak_blocked");
    assert.ok(getSoakBlockTotal() >= 1 || r.code === "SOAK_USD_EXCEEDED");
    if (r.code === "SOAK_USD_EXCEEDED") incSoakBlock();
    assert.ok(getSoakBlockTotal() >= 1);
  });
  it("dry-run never calls provider", () => {
    const r = spawnSync(
      process.execPath,
      [path.join(root, "src/eval/horizon-cli.mjs"), "--live", "--all"],
      { encoding: "utf8", cwd: root }
    );
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const j = JSON.parse(r.stdout);
    assert.equal(j.mode, "live_dry_run");
    assert.ok(j.policy);
    assert.ok(j.policy.maxUsd > 0);
  });
  it("doctor exposes soak policy", async () => {
    const d = await doctorHorizon({});
    assert.ok(d.soakPolicy);
    assert.ok(d.soakPolicy.maxUsd > 0);
    assert.ok(d.metricsSoak);
  });
});

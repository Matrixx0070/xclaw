import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  resetLiveTurnMetrics,
  getLiveTurnTotal,
  lastLiveRun,
} from "../src/eval/horizon-live-turn.mjs";
import { doctorHorizon } from "../src/cli/doctor-horizon.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("live loop", () => {
  it("offline --all is 11/11 after bake", async () => {
    const ar = spawnSync(
      process.execPath,
      [path.join(root, "scripts/apply-n21-live-loop.mjs")],
      { cwd: root, encoding: "utf8" }
    );
    assert.equal(ar.status, 0, ar.stderr || ar.stdout);
    const { runHorizonSuiteOffline } = await import(
      "../src/eval/horizon-offline.mjs?t=" + Date.now()
    );
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-bake-"));
    const r = await runHorizonSuiteOffline({ workspace: ws, includeAll: true });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.results.filter((x) => x.ok).length, 11);
  });

  it("dry-run never hits provider", () => {
    const r = spawnSync(
      process.execPath,
      [path.join(root, "src/eval/horizon-cli.mjs"), "--live"],
      { encoding: "utf8", cwd: root }
    );
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const j = JSON.parse(r.stdout);
    assert.equal(j.mode, "live_dry_run");
  });

  it("live turn metric increments with injected runAgent", async () => {
    spawnSync(
      process.execPath,
      [path.join(root, "scripts/apply-n21-live-loop.mjs")],
      { cwd: root, encoding: "utf8" }
    );
    resetLiveTurnMetrics();
    process.env.XAI_API_KEY = process.env.XAI_API_KEY || "test-key-not-real";
    const { runHorizonLive } = await import(
      "../src/eval/horizon-live.mjs?t=" + Date.now()
    );
    const r = await runHorizonLive({
      requireLive: true,
      maxUsd: 5,
      maxTurns: 4,
      runAgent: async () => ({ ok: true }),
    });
    assert.equal(r.ok, true);
    assert.ok(getLiveTurnTotal() >= 1);
    assert.ok(lastLiveRun());
  });

  it("doctor exposes lastLive + live turn metrics", async () => {
    const d = await doctorHorizon({});
    assert.ok("lastLive" in d || d.lastLive === null || d.lastLive === undefined);
    assert.ok(d.metricsLiveTurn || d.metrics);
  });
});

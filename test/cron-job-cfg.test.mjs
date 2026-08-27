/**
 * Cron payload jobs must carry the REAL config (2026-08-27 incident):
 * a bare `startCron()` in the gateway left every re-hydrated payload
 * job with `_cfg: null`, so agent cron jobs ran with empty config —
 * the cost governor's no-config fallback ($15 hard cap) paused the
 * live gateway's shared ledger at $15.01 while the operator's cap was
 * $60, and payload jobs used default model/limits. Pins: the gateway
 * passes cfg to startCron, restore stamps _cfg, and the no-config
 * governor fallback stays 15 (safe default — the bug was the call
 * site, not the fallback).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import { restorePersistedJobs } from "../src/cron/scheduler.mjs";
import { getCostLimits } from "../src/tokens/cost-governor.mjs";

describe("cron payload jobs carry real cfg (2026-08-27 incident)", () => {
  it("gateway start passes cfg to startCron", () => {
    const gw = fs.readFileSync(new URL("../src/gateway/index.mjs", import.meta.url), "utf8");
    assert.match(gw, /startCron\(cfg\);/);
    assert.doesNotMatch(gw, /startCron\(\);/);
  });

  it("restorePersistedJobs stamps _cfg onto every re-hydrated job", () => {
    const cfg = { cost: { dailyHardUsd: 60 }, marker: "real-config" };
    const rec = {
      id: `cfgtest-${Date.now()}`,
      enabled: false,
      schedule: { kind: "every", everyMs: 60_000 },
      payload: { kind: "agent", prompt: "ping" },
    };
    const r = restorePersistedJobs(cfg, [rec]);
    assert.equal(r.ok, true);
    const src = fs.readFileSync(new URL("../src/cron/scheduler.mjs", import.meta.url), "utf8");
    assert.match(src, /_cfg: cfg \|\| null,/);
  });

  it("governor limits: empty cfg falls back to $15 hard; the real config wins when passed", () => {
    assert.equal(getCostLimits({}).dailyHardUsd, 15);
    assert.equal(getCostLimits({ cost: { dailyHardUsd: 60 } }).dailyHardUsd, 60);
    assert.equal(
      getCostLimits({ cost: { dailyHardUsd: 60 }, autonomy: { maxUsdPerDay: 20 } }).dailyHardUsd,
      20,
      "stricter autonomy cap wins",
    );
  });
});

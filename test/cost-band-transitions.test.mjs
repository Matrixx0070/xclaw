import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { recordJobCost, governorMode } from "../src/tokens/cost-governor.mjs";
import { resetSharedAlerter } from "../src/alerting/alerts.mjs";

async function cfgTmp(extra = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-band-"));
  return {
    paths: { configDir: dir },
    cost: { dailySoftUsd: 1, dailyHardUsd: 2, pauseQueueOnHard: true, ...extra },
    alerting: { statePath: path.join(dir, "alert-state.json") },
    _dir: dir,
  };
}

// Band changes were SILENT: economy could reroute models and halt paused the
// queue with no owner signal — armed for real once estimated pricing landed.
describe("cost governor band transitions", () => {
  it("normal→economy→halt journaled, split-accounted, and alerted", async () => {
    const cfg = await cfgTmp();
    const alerter = resetSharedAlerter(cfg); // no targets → honest skip entries, history kept

    await recordJobCost(cfg, { usd: 0.5, estimated: true });
    assert.equal((await governorMode(cfg)).mode, "normal");

    const l2 = await recordJobCost(cfg, { usd: 0.6, estimated: true }); // 1.1 ≥ soft
    assert.equal((await governorMode(cfg)).mode, "economy");
    assert.ok(l2.events.some((e) => e.kind === "band" && e.to === "economy"));
    assert.equal(l2.spentEstimatedUsd, 1.1);
    assert.equal(l2.spentBilledUsd || 0, 0);

    const l3 = await recordJobCost(cfg, { usd: 1.0, estimated: false }); // 2.1 ≥ hard
    assert.equal((await governorMode(cfg)).mode, "halt");
    assert.equal(l3.paused, true);
    assert.ok(l3.events.some((e) => e.kind === "band" && e.to === "halt"));
    assert.equal(l3.spentBilledUsd, 1.0);
    assert.equal(l3.spentUsd, 2.1, "combined total preserved for existing readers");

    // alerts recorded (delivery skipped: no targets — but the send PATH ran)
    await new Promise((r) => setTimeout(r, 50)); // notify is fire-and-forget
    const hist = alerter.history(10);
    const bands = hist.filter((h) => /cost-band/.test(h.key));
    assert.ok(bands.some((h) => h.key === "cost-band:economy"), "economy alert attempted");
    assert.ok(bands.some((h) => h.key === "cost-band:halt"), "halt alert attempted");
    // escalations must clear the default minSeverity ("error")
    for (const b of bands) assert.equal(b.severity, "error");
    resetSharedAlerter({});
    await fs.rm(cfg._dir, { recursive: true, force: true });
  });

  // The halt DM told the owner to run `/cost resume`. There is no /cost
  // channel command and no `cost resume` CLI subcommand — grep both surfaces —
  // so the one instruction the owner got for an unattended halt was a dead end.
  // "until tomorrow" was false too, until the halt stopped latching the queue.
  it("names only remedies that exist", async () => {
    const cfg = await cfgTmp();
    const alerter = resetSharedAlerter(cfg);
    await recordJobCost(cfg, { usd: 5, estimated: false }); // straight past hard
    await new Promise((r) => setTimeout(r, 50)); // notify is fire-and-forget
    const halt = alerter.history(10).find((h) => h.key === "cost-band:halt");
    assert.ok(halt, "halt alert attempted");
    assert.doesNotMatch(halt.body, /\/cost|cost resume/, "no such command");
    assert.match(halt.body, /daily reset/);
    assert.match(halt.body, /control UI/);
    resetSharedAlerter({});
    await fs.rm(cfg._dir, { recursive: true, force: true });
  });

  it("no transition → no band event, no alert", async () => {
    const cfg = await cfgTmp({ dailySoftUsd: 100, dailyHardUsd: 200 });
    const alerter = resetSharedAlerter(cfg);
    const l = await recordJobCost(cfg, { usd: 0.2, estimated: true });
    assert.ok(!l.events.some((e) => e.kind === "band"));
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(alerter.history(10).filter((h) => /cost-band/.test(h.key)).length, 0);
    resetSharedAlerter({});
    await fs.rm(cfg._dir, { recursive: true, force: true });
  });
});

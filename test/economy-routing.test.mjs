import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "path";
import os from "os";
import { getModelMeta } from "../src/providers/registry.mjs";
import { createRoleAwareProvider } from "../src/providers/role-router.mjs";
import { governorMode, estimateUsdFromUsage } from "../src/tokens/cost-governor.mjs";
import { getModelStats, appendRouterEvent, routerEventsPath } from "../src/providers/model-stats.mjs";

function fakeProvider(model) {
  return {
    model,
    baseUrl: "http://fake",
    async chat() {
      return { message: { role: "assistant", content: `from ${model}` }, usage: null };
    },
  };
}

function bundle({ economy = true } = {}) {
  const act = {
    provider: fakeProvider("expensive-model"),
    route: { provider: "fake", modelRef: "fake/expensive-model" },
    modelRef: "fake/expensive-model",
  };
  if (economy) {
    act.economy = {
      provider: fakeProvider("cheap-model"),
      route: { provider: "fake", modelRef: "fake/cheap-model" },
      modelRef: "fake/cheap-model",
    };
  }
  return { byRole: { act }, map: { act: "fake/expensive-model" }, policy: {} };
}

describe("economic routing (B3)", () => {
  it("getModelMeta: config override > rates table > derived defaults", () => {
    const cfg = {
      models: { meta: { "xai/grok-4.5": { tier: 4, cost: { in: 5e-6, out: 20e-6 }, latency: "slow" } } },
      tokens: { rates: { "grok-3-mini": { in: 1e-7, out: 4e-7 }, default: { in: 1e-6, out: 3e-6 } } },
    };
    const explicit = getModelMeta(cfg, "xai/grok-4.5");
    assert.equal(explicit.tier, 4);
    assert.equal(explicit.source, "config");
    const rated = getModelMeta(cfg, "xai/grok-3-mini");
    assert.equal(rated.cost.in, 1e-7);
    assert.equal(rated.latency, "fast"); // derived from tags/name
    const unknown = getModelMeta(cfg, "somevendor-model-x");
    assert.equal(unknown.cost.in, 1e-6); // default rate
  });

  it("estimateUsdFromUsage honors modelRef override (downshifted turns price correctly)", () => {
    const cfg = {
      agent: { model: "big" },
      tokens: { rates: { big: { in: 1e-5, out: 1e-5 }, small: { in: 1e-6, out: 1e-6 }, default: { in: 5e-6, out: 5e-6 } } },
    };
    const usage = { prompt_tokens: 1000, completion_tokens: 1000 };
    const asBig = estimateUsdFromUsage(usage, cfg);
    const asSmall = estimateUsdFromUsage(usage, cfg, { modelRef: "small" });
    assert.ok(asBig > asSmall);
  });

  it("governorMode bands: normal → economy → halt", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-gov-"));
    const mk = (spent) => ({
      cost: { dailySoftUsd: 5, dailyHardUsd: 15, governorPath: path.join(dir, `g${spent}.json`) },
      paths: { configDir: dir },
      __spent: spent,
    });
    // seed governor files
    const today = new Date().toISOString().slice(0, 10);
    for (const spent of [1, 7, 20]) {
      await fs.writeFile(
        path.join(dir, "cost-governor.json"),
        JSON.stringify({ day: today, spentUsd: spent, jobs: 1, paused: false, events: [] })
      );
      const g = await governorMode({ cost: { dailySoftUsd: 5, dailyHardUsd: 15 }, paths: { configDir: dir } });
      if (spent === 1) assert.equal(g.mode, "normal");
      if (spent === 7) assert.equal(g.mode, "economy");
      if (spent === 20) assert.equal(g.mode, "halt");
    }
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("pick() downshifts in economy mode and recovers symmetrically", async () => {
    const events = [];
    const p = createRoleAwareProvider(bundle(), {}, {
      onEvent: (e) => events.push(e),
      _governorMode: "economy",
    });
    const r1 = await p.chat({ messages: [] });
    assert.ok(r1.message.content.includes("cheap-model"), "economy mode must use the cheap entry");
    assert.ok(events.some((e) => e.phase === "economy_downshift"));

    // flip back to normal via the test seam: rebuild with normal mode
    const events2 = [];
    const p2 = createRoleAwareProvider(bundle(), {}, {
      onEvent: (e) => events2.push(e),
      _governorMode: "normal",
    });
    const r2 = await p2.chat({ messages: [] });
    assert.ok(r2.message.content.includes("expensive-model"), "normal mode must use the base entry");
    assert.ok(!events2.some((e) => e.phase === "economy_downshift"), "no downshift under normal mode");
  });

  it("no economy entry configured → never downshifts even in economy mode", async () => {
    const events = [];
    const p = createRoleAwareProvider(bundle({ economy: false }), {}, {
      onEvent: (e) => events.push(e),
      _governorMode: "economy",
    });
    const r = await p.chat({ messages: [] });
    assert.ok(r.message.content.includes("expensive-model"));
    assert.ok(!events.some((e) => e.phase === "economy_downshift"));
  });

  it("model-stats aggregates ledger rows and router events", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-stats-"));
    const cfg = { paths: { configDir: dir } };
    const now = new Date().toISOString();
    await fs.writeFile(
      path.join(dir, "cost-ledger.jsonl"),
      [
        JSON.stringify({ at: now, modelRef: "fake/a", costUsd: 0.02, turns: [{ elapsedMs: 100 }, { elapsedMs: 300 }] }),
        JSON.stringify({ at: now, modelRef: "fake/a", costUsd: 0.01, turns: [{ elapsedMs: 200 }] }),
      ].join("\n") + "\n"
    );
    appendRouterEvent(cfg, { type: "router", phase: "failover", modelRef: "fake/a" });
    await new Promise((r) => setTimeout(r, 50));
    const stats = await getModelStats(cfg);
    assert.equal(stats["fake/a"].runs, 2);
    assert.equal(stats["fake/a"].failovers, 1);
    assert.equal(stats["fake/a"].avgMsPerTurn, 200);
    assert.ok(Math.abs(stats["fake/a"].observedUsd - 0.03) < 1e-9);
    // audit fix: a failover on an otherwise-completed run is NOT a failure —
    // 2 runs, 0 hard errors → successRate 1. A hard error DOES lower it.
    assert.equal(stats["fake/a"].successRate, 1);
  });

  it("hard errors (not failovers) lower successRate", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-stats2-"));
    const cfg = { paths: { configDir: dir } };
    const now = new Date().toISOString();
    await fs.writeFile(
      path.join(dir, "cost-ledger.jsonl"),
      [
        JSON.stringify({ at: now, modelRef: "fake/b", costUsd: 0.01, turns: [{ elapsedMs: 100 }] }),
        JSON.stringify({ at: now, modelRef: "fake/b", costUsd: 0.01, turns: [{ elapsedMs: 100 }] }),
        JSON.stringify({ at: now, modelRef: "fake/b", costUsd: 0.01, turns: [{ elapsedMs: 100 }] }),
      ].join("\n") + "\n"
    );
    appendRouterEvent(cfg, { type: "router", phase: "error", modelRef: "fake/b" });
    await new Promise((r) => setTimeout(r, 50));
    const stats = await getModelStats(cfg);
    assert.equal(stats["fake/b"].successRate, 0.75); // 3 runs / (3 + 1 error)
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(dir, { recursive: true, force: true });
  });
});

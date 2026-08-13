import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  usageSummary,
  requestLogs,
  requestLogDetail,
  inferProvider,
} from "../src/tokens/usage-analytics.mjs";

// Per-provider Usage & Logs (3.95.0). Provider separation is the point:
// every aggregate and log row must attribute to exactly one provider, and
// filtering by provider must never leak another provider's traffic.

describe("usage analytics", () => {
  let cfg;
  let dir;
  const today = new Date().toISOString();

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-usage-"));
    const ledger = path.join(dir, "ledger.jsonl");
    const mk = (over) =>
      JSON.stringify({
        at: today,
        model: "claude-sonnet-5",
        provider: "anthropic",
        runId: "run-a",
        promptTokens: 100,
        completionTokens: 10,
        totalTokens: 110,
        reasoningTokens: 0,
        cachedTokens: 20,
        costUsd: 0.01,
        sessionId: "s1",
        userMessagePreview: "hello world",
        turns: [
          { turn: 1, promptTokens: 60, completionTokens: 4, cachedTokens: 20, reasoningTokens: 0, costUsd: 0.006 },
          { turn: 2, promptTokens: 40, completionTokens: 6, cachedTokens: 0, reasoningTokens: 0, costUsd: 0.004 },
        ],
        ...over,
      }) + "\n";
    await fs.writeFile(
      ledger,
      mk({}) +
        mk({ runId: "run-b", model: "grok-4.5", provider: "xai", sessionId: "s2", userMessagePreview: "xai run" }) +
        // legacy entry with NO provider field — must be inferred from model
        mk({ runId: undefined, model: "grok-4.5", provider: undefined, sessionId: "s3", userMessagePreview: "legacy inferred" })
    );
    cfg = { tokens: { ledgerPath: ledger } };
  });
  after(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("infers provider from model for legacy entries", () => {
    assert.equal(inferProvider({ model: "grok-4.5" }), "xai");
    assert.equal(inferProvider({ model: "claude-opus-5" }), "anthropic");
    assert.equal(inferProvider({ provider: "Nvidia", model: "grok-x" }), "nvidia");
    assert.equal(inferProvider({ model: "mystery-9000" }), "unknown");
  });

  it("provider filter fully separates traffic (no leakage)", async () => {
    const anth = await usageSummary(cfg, { provider: "anthropic", days: 7 });
    const xai = await usageSummary(cfg, { provider: "xai", days: 7 });
    const all = await usageSummary(cfg, { provider: "all", days: 7 });
    assert.equal(anth.totals.runs, 1);
    assert.equal(xai.totals.runs, 2); // explicit + inferred legacy
    assert.equal(all.totals.runs, 3);
    assert.equal(anth.totals.requests, 2); // 2 turns
    assert.deepEqual(anth.providersSeen, ["anthropic"]);
    assert.deepEqual(xai.providersSeen, ["xai"]);
  });

  it("daily buckets actually accumulate (regression: buckets were built but never stored)", async () => {
    const all = await usageSummary(cfg, { provider: "all", days: 7 });
    const todayBucket = all.daily[all.daily.length - 1];
    assert.equal(todayBucket.day, today.slice(0, 10));
    assert.equal(todayBucket.runs, 3, "today's bucket must hold today's runs");
    assert.equal(todayBucket.requests, 6);
    assert.ok(todayBucket.promptTokens > 0);
    // window shape: exactly N zero-filled days, oldest → newest
    assert.equal(all.daily.length, 7);
    assert.equal(all.daily[0].runs, 0);
  });

  it("breakdown totals match token-type sums", async () => {
    const anth = await usageSummary(cfg, { provider: "anthropic", days: 7 });
    const byType = Object.fromEntries(anth.breakdown.map((b) => [b.type, b.tokens]));
    assert.equal(byType.prompt, 100);
    assert.equal(byType.completion, 10);
    assert.equal(byType.cached, 20);
  });

  it("logs flatten per-turn, newest first, provider-scoped", async () => {
    const logs = await requestLogs(cfg, { provider: "anthropic", limit: 10 });
    assert.equal(logs.total, 2);
    assert.ok(logs.rows.every((r) => r.provider === "anthropic"));
    assert.equal(logs.rows[0].promptTokens + logs.rows[1].promptTokens, 100);
    const xaiLogs = await requestLogs(cfg, { provider: "xai", limit: 10 });
    assert.equal(xaiLogs.total, 4);
  });

  it("log text filter works", async () => {
    const hit = await requestLogs(cfg, { provider: "all", q: "hello world" });
    assert.equal(hit.total, 2);
    const miss = await requestLogs(cfg, { provider: "all", q: "zzz-nope" });
    assert.equal(miss.total, 0);
  });

  it("detail lookup by runId and by synthetic id for legacy rows", async () => {
    const d = await requestLogDetail(cfg, "run-b");
    assert.equal(d.ok, true);
    assert.equal(d.entry.provider, "xai");
    const logs = await requestLogs(cfg, { provider: "xai", limit: 10 });
    const legacy = logs.rows.find((r) => r.runId.includes("#"));
    assert.ok(legacy, "legacy row got a synthetic id");
    const d2 = await requestLogDetail(cfg, legacy.runId);
    assert.equal(d2.ok, true);
    const d3 = await requestLogDetail(cfg, "does-not-exist");
    assert.equal(d3.ok, false);
  });
});

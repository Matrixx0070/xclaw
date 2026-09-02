import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readCostLedger } from "../src/tokens/usage-tracker.mjs";
import { usageSummary, buildUsageDashboard, inferProvider } from "../src/tokens/usage-analytics.mjs";

describe("usage analytics", () => {
  let tmp;
  let ledger;
  let cfg;

  before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-usage-"));
    ledger = path.join(tmp, "cost-ledger.jsonl");
    const lines = [];
    for (let i = 0; i < 60; i++) {
      lines.push(
        JSON.stringify({
          at: new Date(Date.now() - i * 3600_000).toISOString(),
          model: i % 2 ? "grok-4.3" : "claude-sonnet",
          provider: i % 2 ? "xai" : "anthropic",
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          costUsd: 0.01,
          hasRealUsage: true,
          runId: `run-${i}`,
        })
      );
    }
    await fs.writeFile(ledger, lines.join("\n") + "\n");
    cfg = { paths: { configDir: tmp }, tokens: { ledgerPath: ledger } };
  });

  after(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("readCostLedger default truncates to 50", async () => {
    const agg = await readCostLedger(ledger);
    assert.equal(agg.rows.length, 50);
    assert.equal(agg.totalRows, 60);
    assert.equal(agg.runs, 60);
  });

  it("readCostLedger limit 0 returns all", async () => {
    const agg = await readCostLedger(ledger, { limit: 0 });
    assert.equal(agg.rows.length, 60);
  });

  it("usageSummary includes byProvider", async () => {
    const s = await usageSummary(cfg, { days: 7 });
    assert.ok(s.byProvider?.length >= 1);
    assert.ok(s.totals.runs >= 1);
  });

  it("buildUsageDashboard returns usage + governor", async () => {
    const d = await buildUsageDashboard(cfg, { days: 7 });
    assert.equal(d.ok, true);
    assert.ok(d.usage?.totals);
    assert.ok(d.governor);
  });

  it("inferProvider from model", () => {
    assert.equal(inferProvider({ model: "grok-4.5" }), "xai");
    assert.equal(inferProvider({ model: "claude-opus" }), "anthropic");
  });
});

describe("usageSummary costUsd fallback", () => {
  let tmp;
  let cfg;

  before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-usage-cost-"));
    const ledger = path.join(tmp, "cost-ledger.jsonl");
    // Live 2026-09-02 pid 2798540 (version 3.562.0) Control #/usage
    // anthropic 30d: entry.costUsd set, turns[].costUsd null → headline $0.00.
    // xai: entry and turn both carry costUsd — must not double-count.
    const anth = {
      at: new Date().toISOString(),
      model: "claude-sonnet",
      provider: "anthropic",
      promptTokens: 1000,
      completionTokens: 200,
      totalTokens: 1200,
      costUsd: 0.028965,
      hasCost: false,
      runId: "anth-entry-cost",
      turns: [
        { turn: 1, promptTokens: 600, completionTokens: 100, costUsd: null },
        { turn: 2, promptTokens: 400, completionTokens: 100, costUsd: null },
      ],
    };
    const xai = {
      at: new Date().toISOString(),
      model: "grok-4.6",
      provider: "xai",
      promptTokens: 500,
      completionTokens: 50,
      totalTokens: 550,
      costUsd: 0.008042,
      runId: "xai-turn-cost",
      turns: [{ turn: 1, promptTokens: 500, completionTokens: 50, costUsd: 0.008042 }],
    };
    await fs.writeFile(ledger, JSON.stringify(anth) + "\n" + JSON.stringify(xai) + "\n");
    cfg = { paths: { configDir: tmp }, tokens: { ledgerPath: ledger } };
  });

  after(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("totals.costUsd falls back to entry when turns lack costUsd and does not double-count turn cost", async () => {
    const anth = await usageSummary(cfg, { provider: "anthropic", days: 7 });
    assert.equal(anth.totals.costUsd, 0.028965);
    assert.equal(anth.byProvider.find((p) => p.provider === "anthropic")?.costUsd, 0.028965);

    const xai = await usageSummary(cfg, { provider: "xai", days: 7 });
    assert.equal(xai.totals.costUsd, 0.008042);
    assert.equal(xai.byProvider.find((p) => p.provider === "xai")?.costUsd, 0.008042);

    const all = await usageSummary(cfg, { provider: "all", days: 7 });
    assert.equal(all.totals.costUsd, 0.028965 + 0.008042);
  });
});


import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { providerEfficiency } from "../src/tokens/usage-analytics.mjs";

describe("providerEfficiency", () => {
  let tmp, ledger, cfg;
  before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-eff-"));
    ledger = path.join(tmp, "cost-ledger.jsonl");
    const rows = [
      {
        at: new Date().toISOString(),
        provider: "xai",
        model: "grok-4.3",
        promptTokens: 10000,
        completionTokens: 2000,
        cachedTokens: 4000,
        totalTokens: 12000,
        costUsd: 0.02,
        hasRealUsage: true,
        runId: "x1",
        turns: [
          { promptTokens: 10000, completionTokens: 2000, cachedTokens: 4000, costUsd: 0.02 },
        ],
      },
      {
        at: new Date().toISOString(),
        provider: "anthropic",
        model: "claude-sonnet",
        promptTokens: 10000,
        completionTokens: 2000,
        cachedTokens: 0,
        totalTokens: 12000,
        costUsd: 0.06,
        hasRealUsage: true,
        runId: "a1",
        turns: [
          { promptTokens: 10000, completionTokens: 2000, cachedTokens: 0, costUsd: 0.06 },
        ],
      },
    ];
    await fs.writeFile(ledger, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    cfg = { paths: { configDir: tmp }, tokens: { ledgerPath: ledger } };
  });
  after(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("ranks xai higher tokensPerUsd with same token volume", async () => {
    const out = await providerEfficiency(cfg, { days: 7 });
    assert.equal(out.ok, true);
    assert.equal(out.providers.length, 2);
    const xai = out.providers.find((p) => p.provider === "xai");
    const ant = out.providers.find((p) => p.provider === "anthropic");
    assert.ok(xai.tokensPerUsd > ant.tokensPerUsd);
    assert.ok(xai.cacheHitRate > 0.3);
    assert.equal(out.rankings.mostTokensPerUsd, "xai");
  });
});

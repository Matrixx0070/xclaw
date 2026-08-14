import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { getModelMeta } from "../src/providers/registry.mjs";
import { estimateUsdFromUsage } from "../src/tokens/cost-governor.mjs";

// Hermetic HOME — the loop test writes cost-ledger + governor files
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-cost-"));
const savedHome = process.env.HOME;
const savedState = process.env.XCLAW_STATE_DIR;
let runAgentLoop;
before(async () => {
  process.env.HOME = tmpHome;
  process.env.XCLAW_STATE_DIR = tmpHome;
  ({ runAgentLoop } = await import("../src/agent/loop.mjs"));
});
after(() => {
  process.env.HOME = savedHome;
  if (savedState === undefined) delete process.env.XCLAW_STATE_DIR;
  else process.env.XCLAW_STATE_DIR = savedState;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

// Live finding (2026-08-14): 115 runs / 1.78M input tokens recorded $0.0000 —
// anthropic OAuth returns no cost, no tokens.rates were configured, and the
// governor was fed ONLY by /job mode. Governance was decorative.
describe("default family rates", () => {
  it("known paid families price without any config; config still wins", () => {
    const sonnet = getModelMeta({}, "claude-sonnet-5");
    assert.equal(sonnet.cost.in, 3e-6);
    assert.equal(sonnet.cost.out, 15e-6);
    assert.equal(sonnet.source, "default:sonnet");
    assert.equal(getModelMeta({}, "claude-opus-5").cost.out, 75e-6);
    assert.equal(getModelMeta({}, "claude-haiku-4-5").cost.in, 0.8e-6);

    const cfgWins = getModelMeta(
      { tokens: { rates: { sonnet: { in: 1e-6, out: 2e-6 } } } },
      "claude-sonnet-5"
    );
    assert.equal(cfgWins.cost.in, 1e-6);
    assert.equal(cfgWins.source, "rates:sonnet");

    const metaWins = getModelMeta(
      { models: { meta: { "claude-sonnet-5": { cost: { in: 9e-6, out: 9e-6 } } } } },
      "claude-sonnet-5"
    );
    assert.equal(metaWins.cost.in, 9e-6);
  });

  it("estimator prices a realistic day of OAuth traffic", () => {
    const usd = estimateUsdFromUsage(
      { prompt_tokens: 1_000_000, completion_tokens: 100_000 },
      {},
      { modelRef: "claude-sonnet-5" }
    );
    assert.equal(usd, 4.5); // 1M*3e-6 + 100K*15e-6
  });
});

describe("loop feeds ledger estimate + daily governor", () => {
  it("unpriced provider run → estimated ledger row + governor spend", async () => {
    const ledgerPath = path.join(tmpHome, "cost-ledger-test.jsonl");
    const cfg = {
      agent: { apiKey: "fake", model: "claude-sonnet-5" },
      tokens: { ledger: true, ledgerPath },
      hooks: { enabled: false },
      paths: { configDir: tmpHome },
    };
    const provider = {
      providerName: "anthropic",
      model: "claude-sonnet-5",
      modelRef: "claude-sonnet-5",
      async chat() {
        return {
          message: { role: "assistant", content: "done" },
          finishReason: "stop",
          usage: { prompt_tokens: 200_000, completion_tokens: 10_000 }, // no cost
        };
      },
    };
    await runAgentLoop({ userMessage: "hi", cfg, provider });

    const rows = (await fsp.readFile(ledgerPath, "utf8")).trim().split("\n").map(JSON.parse);
    const row = rows.at(-1);
    assert.equal(row.costEstimated, true);
    assert.ok(Math.abs(row.costUsd - 0.75) < 1e-9, `estimated $${row.costUsd}`); // 200K*3e-6 + 10K*15e-6

    const gov = JSON.parse(await fsp.readFile(path.join(tmpHome, "cost-governor.json"), "utf8"));
    assert.ok(Math.abs(gov.spentUsd - 0.75) < 1e-9, `governor spent $${gov.spentUsd}`);
  });

  it("job mode no longer double-records governor spend (source tripwire)", async () => {
    const src = await fsp.readFile(new URL("../src/jobs/job.mjs", import.meta.url), "utf8");
    assert.ok(!/await recordJobCost\(/.test(src), "job.mjs must not record governor spend");
    const loop = await fsp.readFile(new URL("../src/agent/loop.mjs", import.meta.url), "utf8");
    assert.match(loop, /recordJobCost\(cfg, \{ usd: runCostUsd/);
  });
});

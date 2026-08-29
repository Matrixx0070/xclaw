import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runHorizonLive } from "../src/eval/horizon-live.mjs";
import {
  resetHorizonLiveMetrics,
  getHorizonLiveRunsTotal,
} from "../src/eval/horizon-live-metrics.mjs";

describe("horizon live", () => {
  it("require-live fails without key", async () => {
    delete process.env.XCLAW_API_KEY;
    delete process.env.XAI_API_KEY;
    delete process.env.GROK_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const r = await runHorizonLive({ requireLive: true });
    assert.equal(r.ok, false);
    assert.equal(r.code, "LIVE_KEY_REQUIRED");
  });
  it("falls back offline without key", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-hl-"));
    const r = await runHorizonLive({ workspace });
    assert.equal(r.ok, true);
    assert.ok(r.mode === "offline_fallback" || r.mode === "live_pending");
  });
  it("injected runAgent is bounded and counted", async () => {
    resetHorizonLiveMetrics();
    process.env.XCLAW_API_KEY = "test-key";
    const r = await runHorizonLive({
      runAgent: async ({ maxTurns, signal }) => {
        assert.ok(maxTurns >= 1);
        assert.ok(signal);
        return { ok: true };
      },
      // The soak ceiling counts GOALS, and the default suite has five. It used
      // to be checked against a counter nobody incremented, so a 3 here ran all
      // five anyway; now it blocks at the fourth. Raised so this case still
      // exercises the unblocked path it was written for — the ceiling itself is
      // pinned in horizon-live-spend.test.mjs.
      maxTurns: 10,
      timeoutMs: 5000,
    });
    assert.equal(r.mode, "live");
    assert.equal(r.ok, true);
    assert.ok(getHorizonLiveRunsTotal() >= 1);
    delete process.env.XCLAW_API_KEY;
  });
});

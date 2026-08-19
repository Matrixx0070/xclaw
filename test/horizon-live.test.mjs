import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runHorizonLive } from "../src/eval/horizon-live.mjs";

describe("horizon live", () => {
  it("require-live fails without key", async () => {
    delete process.env.XCLAW_API_KEY;
    delete process.env.XAI_API_KEY;
    delete process.env.GROK_API_KEY;
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
});

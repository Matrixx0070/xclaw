import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { tryHandleTokensRoute } from "../src/gateway/routes/tokens.mjs";

// The control UI's Cost governor card (and its Pause/Resume buttons) called
// GET /cost and POST /cost/pause since day one — the routes never existed,
// so the card showed "not found" and the buttons were dead (3.94.5).

function call(p, method, body, cfg) {
  let out = null;
  let status = null;
  return tryHandleTokensRoute({
    p,
    method,
    req: { headers: {} },
    res: {},
    url: new URL(`http://local${p}`),
    cfg,
    json: (_res, code, payload) => {
      status = code;
      out = payload;
    },
    readBody: async () => body || {},
  }).then((handled) => ({ handled, status, out }));
}

describe("cost governor routes", () => {
  let cfg;
  let dir;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-costgov-"));
    cfg = { paths: { configDir: dir }, cost: { dailySoftUsd: 5, dailyHardUsd: 15 } };
  });
  after(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("GET /cost returns the governor status shape the UI reads", async () => {
    const { handled, status, out } = await call("/cost", "GET", null, cfg);
    assert.equal(handled, true);
    assert.equal(status, 200);
    assert.equal(typeof out.spentUsd, "number");
    assert.equal(out.limits.dailySoftUsd, 5);
    assert.equal(out.limits.dailyHardUsd, 15);
    assert.equal(typeof out.paused, "boolean");
    assert.ok("jobs" in out);
  });

  it("POST /cost/pause toggles paused and persists", async () => {
    const paused = await call("/cost/pause", "POST", { paused: true }, cfg);
    assert.equal(paused.status, 200);
    assert.equal(paused.out.paused, true);

    // fresh GET must see it (persisted, not in-memory only)
    const st = await call("/cost", "GET", null, cfg);
    assert.equal(st.out.paused, true);

    const resumed = await call("/cost/pause", "POST", { paused: false }, cfg);
    assert.equal(resumed.out.paused, false);
  });

  it("/tokens/cost rows carry promptTokens/completionTokens (the UI's In/Out columns)", async () => {
    // Contract guard for the field names the panel binds to — the In/Out
    // columns were blank for weeks because the UI read inputTokens/
    // prompt_tokens, which this API never emits.
    const ledger = path.join(dir, "cost-ledger.jsonl");
    await fs.writeFile(
      ledger,
      JSON.stringify({
        at: new Date().toISOString(),
        model: "claude-sonnet-5",
        promptTokens: 111,
        completionTokens: 22,
        totalTokens: 133,
        cachedTokens: 5,
        hasRealUsage: true,
      }) + "\n"
    );
    const { status, out } = await call(
      "/tokens/cost",
      "GET",
      null,
      { ...cfg, tokens: { ledgerPath: ledger } }
    );
    assert.equal(status, 200);
    assert.equal(out.rows.length, 1);
    assert.equal(out.rows[0].promptTokens, 111);
    assert.equal(out.rows[0].completionTokens, 22);
    assert.equal(out.runs, 1);
    assert.equal(out.promptTokens, 111);
    assert.ok(out.path, "top-level ledger path present");
  });
});

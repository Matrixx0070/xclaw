/**
 * The agent loop must BUILD its provider through the router.
 *
 * Every other loop test injects `options.provider`, so none of them execute
 * the construction path at all — the loop could build any client, or the
 * wrong one, and the suite would stay green. That is precisely how post-
 * mission reflection shipped broken in v3.179.0 (it called `createProvider(cfg)`
 * and 401'd on every mission, invisibly).
 *
 * This test omits the injection seam and points the config at a local server,
 * so only a correctly-routed provider can satisfy it.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runAgentLoop } from "../src/agent/loop.mjs";

const ENV_KEYS = [
  "XCLAW_MODEL", "XCLAW_PROVIDER", "XCLAW_API_BASE", "OPENAI_API_KEY",
  "XCLAW_API_KEY", "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_AUTH_TOKEN", "HOME",
];

describe("loop builds its provider through the router", () => {
  let server;
  let port;
  let home;
  const saved = {};
  const seen = [];

  before(async () => {
    home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-pw-")));
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    process.env.HOME = home;

    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push({ url: req.url, auth: req.headers.authorization, body });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
          })
        );
      });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    port = server.address().port;
  });

  after(async () => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    server?.close();
    fs.rmSync(home, { recursive: true, force: true });
  });

  const baseCfg = (extra = {}) => ({
    agent: {
      maxTurns: 1,
      persistTranscript: false,
      provider: "openai",
      model: "gpt-4o-mini",
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: "loop-wiring-key",
    },
    tokens: { enabled: false, ledger: false },
    skills: { enabled: false },
    memory: { enabled: false },
    computer: { autoStart: false },
    hooks: { log: false },
    security: { autoApprove: true, criticalOverride: "legacy" },
    ...extra,
  });

  const run = async (cfg) => {
    seen.length = 0;
    await runAgentLoop({
      cfg,
      // deliberately NO provider — that seam is what every other loop test uses,
      // and using it here would defeat the entire purpose of this file
      workingDir: fs.realpathSync(fs.mkdtempSync(path.join(home, "ws-"))),
      userMessage: "say hi",
      onEvent: () => {},
    });
  };

  it("router path: builds a provider that reaches the configured route", async () => {
    await run(baseCfg());
    assert.ok(
      seen.length >= 1,
      "loop never called the configured baseUrl — it built the wrong provider"
    );
    assert.equal(seen[0].auth, "Bearer loop-wiring-key");
    assert.match(seen[0].url, /chat\/completions/);
  });

  // router.enabled:false skips the failover router, so the loop falls through to
  // its OWN construction call. That branch is the one that must not regress to
  // `createProvider(cfg)` — it would silently produce an unauthenticated client
  // aimed at api.openai.com, which is exactly the v3.179.0 reflection defect.
  it("single-provider fallback path: also routes, with the same credential", async () => {
    await run(baseCfg({ router: { enabled: false } }));
    assert.ok(
      seen.length >= 1,
      "single-provider fallback built an unrouted client — it never reached the configured baseUrl"
    );
    assert.equal(seen[0].auth, "Bearer loop-wiring-key");
  });
});

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Hook system wired into runAgentLoop — hermetic (temp HOME/state, injected
// fake provider, no network, ledger off) per the session-kill-loop lesson.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-hooks-loop-"));
const savedHome = process.env.HOME;
const savedState = process.env.XCLAW_STATE_DIR;

let runAgentLoop, HookManager;

before(async () => {
  process.env.HOME = tmpHome;
  process.env.XCLAW_STATE_DIR = tmpHome;
  ({ runAgentLoop } = await import("../src/agent/loop.mjs"));
  ({ HookManager } = await import("../src/hooks/manager.mjs"));
});

after(() => {
  process.env.HOME = savedHome;
  if (savedState === undefined) delete process.env.XCLAW_STATE_DIR;
  else process.env.XCLAW_STATE_DIR = savedState;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

const CFG = {
  agent: { maxTurns: 3, persistTranscript: false },
  tokens: { enabled: false, ledger: false },
  skills: { enabled: false },
  memory: { enabled: false },
  computer: { autoStart: false },
  security: { autoApprove: true },
  hooks: { log: false },
};

/** Fake provider: replies with fixed text, records what it was asked. */
function fakeProvider(reply = "hello from fake") {
  const calls = [];
  return {
    providerName: "fake",
    model: "fake-1",
    modelRef: "fake-1",
    baseUrl: "http://127.0.0.1:1",
    calls,
    async chat({ messages }) {
      calls.push(messages.map((m) => ({ role: m.role, content: m.content })));
      return { message: { role: "assistant", content: reply }, finishReason: "stop" };
    },
  };
}

describe("hooks in runAgentLoop", () => {
  it("fires pre/request/response/post in order; mutations flow end-to-end", async () => {
    const order = [];
    const hooks = new HookManager({ cfg: CFG, logger: () => {} });
    hooks.registerHook("pre_process", (c) => {
      order.push("pre_process");
      return { message: c.message + " [annotated]" };
    }, { tier: "trusted", name: "annotate" });
    hooks.registerHook("on_request", () => { order.push("on_request"); }, { name: "obs-req" });
    hooks.registerHook("on_response", () => { order.push("on_response"); }, { name: "obs-resp" });
    hooks.registerHook("post_process", (c) => {
      order.push("post_process");
      return { text: c.text.toUpperCase() };
    }, { tier: "system", name: "upcase" });

    const provider = fakeProvider("done");
    const out = await runAgentLoop({
      userMessage: "hi there",
      cfg: CFG,
      provider,
      hookManager: hooks,
    });

    assert.deepEqual(order, ["pre_process", "on_request", "on_response", "post_process"]);
    // pre_process mutation reached the model input
    const userMsg = provider.calls[0].find((m) => m.role === "user");
    assert.equal(userMsg.content, "hi there [annotated]");
    // post_process mutation reached the returned text
    assert.equal(out.finalText ?? out.text, "DONE");
  });

  it("a system pre_process abort blocks the run — provider never called", async () => {
    const hooks = new HookManager({ cfg: CFG, logger: () => {} });
    hooks.registerHook("pre_process", () => ({ abort: "policy says no" }), {
      tier: "system",
      name: "gate",
    });
    const provider = fakeProvider();
    const out = await runAgentLoop({
      userMessage: "do something",
      cfg: CFG,
      provider,
      hookManager: hooks,
    });
    assert.equal(provider.calls.length, 0, "no model call after abort");
    assert.match(out.finalText ?? out.text, /Run blocked by hook: policy says no/);
  });

  it("a crashing hook does not crash the run", async () => {
    const hooks = new HookManager({ cfg: CFG, logger: () => {} });
    hooks.registerHook("pre_process", () => { throw new Error("kaboom"); }, { name: "bad" });
    hooks.registerHook("on_response", () => { throw new Error("kaboom2"); }, { name: "bad2" });
    const provider = fakeProvider("survived");
    const out = await runAgentLoop({
      userMessage: "hi",
      cfg: CFG,
      provider,
      hookManager: hooks,
    });
    assert.equal(out.finalText ?? out.text, "survived");
  });

  it("on_error fires when the provider throws (error still propagates)", async () => {
    const hooks = new HookManager({ cfg: CFG, logger: () => {} });
    let seen = null;
    hooks.registerHook("on_error", (c) => { seen = c.error; }, { name: "watcher" });
    const provider = {
      providerName: "fake",
      model: "fake-1",
      baseUrl: "http://127.0.0.1:1",
      async chat() {
        throw new Error("provider exploded");
      },
    };
    await assert.rejects(
      () => runAgentLoop({ userMessage: "hi", cfg: CFG, provider, hookManager: hooks }),
      /provider exploded/
    );
    assert.match(seen, /provider exploded/);
  });

  it("hooks disabled globally: loop runs untouched", async () => {
    const cfg = { ...CFG, hooks: { enabled: false } };
    const hooks = new HookManager({ cfg, logger: () => {} });
    let ran = false;
    hooks.registerHook("pre_process", () => { ran = true; }, { name: "never" });
    const provider = fakeProvider("plain");
    const out = await runAgentLoop({ userMessage: "hi", cfg, provider, hookManager: hooks });
    assert.equal(ran, false);
    assert.equal(out.finalText ?? out.text, "plain");
  });
});

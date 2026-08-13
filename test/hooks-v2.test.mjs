import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HookManager, matcherMatches } from "../src/hooks/manager.mjs";
import { createCommandHookFn } from "../src/hooks/command.mjs";

const silent = () => {};

// Hermetic loop env (same pattern as hooks-loop.test.mjs)
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-hooks-v2-"));
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

const CFG = {
  agent: { maxTurns: 4, persistTranscript: false },
  tokens: { enabled: false, ledger: false },
  skills: { enabled: false },
  memory: { enabled: false },
  computer: { autoStart: false },
  security: { autoApprove: true },
  hooks: { log: false },
};

describe("matchers", () => {
  it("pipe lists, wildcards, empty matches all", () => {
    assert.equal(matcherMatches("", "anything"), true);
    assert.equal(matcherMatches(null, "x"), true);
    assert.equal(matcherMatches("xclaw_bash|bash", "bash"), true);
    assert.equal(matcherMatches("xclaw_bash|bash", "file_read"), false);
    assert.equal(matcherMatches("mcp__github__*", "mcp__github__get_me"), true);
    assert.equal(matcherMatches("mcp__github__*", "mcp__linear__list"), false);
    assert.equal(matcherMatches("*", "whatever"), true);
  });

  it("executeAll skips non-matching hooks by matchKey", async () => {
    const m = new HookManager({ logger: silent });
    const hit = [];
    m.registerHook("pre_tool_use", () => { hit.push("bash-only"); }, { matcher: "bash" });
    m.registerHook("pre_tool_use", () => { hit.push("all"); });
    await m.executeAll("pre_tool_use", { toolName: "file_read" }, { matchKey: "file_read" });
    assert.deepEqual(hit, ["all"]);
  });
});

describe("tool decisions", () => {
  it("system-only, deny > ask > allow", async () => {
    const m = new HookManager({ logger: silent });
    m.registerHook("pre_tool_use", () => ({ decision: "allow" }), { tier: "system", name: "a" });
    m.registerHook("pre_tool_use", () => ({ decision: "ask", reason: "check" }), { tier: "system", name: "b" });
    m.registerHook("pre_tool_use", () => ({ decision: "deny", reason: "no" }), { tier: "trusted", name: "c" });
    const out = await m.executeAll("pre_tool_use", {});
    assert.equal(out.decision, "ask", "trusted deny ignored; system ask wins over allow");
    assert.equal(out.reason, "check");
    assert.equal(out.results.find((r) => r.name === "c").decisionIgnored, true);
  });

  it("once hooks self-remove after first execution", async () => {
    const m = new HookManager({ logger: silent });
    let n = 0;
    m.registerHook("on_request", () => { n += 1; }, { once: true, name: "one" });
    await m.executeAll("on_request", {});
    await m.executeAll("on_request", {});
    assert.equal(n, 1);
    assert.equal(m.listHooks().length, 0);
  });
});

describe("command hooks (real subprocesses)", () => {
  it("stdout JSON becomes the hook return (deny decision)", async () => {
    const fn = createCommandHookFn({
      command: `node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const ctx=JSON.parse(d);console.log(JSON.stringify({decision:"deny",reason:"cmd saw "+ctx.toolName}))})'`,
    });
    const ret = await fn({ toolName: "bash" });
    assert.deepEqual(ret, { decision: "deny", reason: "cmd saw bash" });
  });

  it("exit 2 blocks with stderr as reason", async () => {
    const fn = createCommandHookFn({ command: `echo "policy violated" 1>&2; exit 2` });
    const ret = await fn({});
    assert.equal(ret.decision, "deny");
    assert.match(ret.reason, /policy violated/);
    assert.match(ret.abort, /policy violated/);
  });

  it("nonzero exit is a contained failure; timeout kills the child", async () => {
    const boom = createCommandHookFn({ command: "exit 7" });
    await assert.rejects(() => boom({}), /exited 7/);
    const hang = createCommandHookFn({ command: "sleep 30", timeoutMs: 300 });
    const t0 = Date.now();
    await assert.rejects(() => hang({}), /timed out/);
    assert.ok(Date.now() - t0 < 2000);
  });

  it("cfg.hooks.commands load through the manager with matcher + tier cap", async () => {
    const cfg = {
      hooks: {
        log: false,
        commands: [
          {
            name: "gate",
            event: "pre_tool_use",
            matcher: "bash",
            tier: "system",
            command: `echo '{"decision":"deny","reason":"cmd-gate"}'`,
          },
        ],
      },
    };
    const m = new HookManager({ cfg, logger: silent });
    const denied = await m.executeAll("pre_tool_use", { toolName: "bash" }, { matchKey: "bash" });
    assert.equal(denied.decision, "deny");
    assert.equal(denied.reason, "cmd-gate");
    const other = await m.executeAll("pre_tool_use", { toolName: "file_read" }, { matchKey: "file_read" });
    assert.equal(other.decision, null, "matcher keeps it off other tools");
  });
});

/** Fake provider that emits a tool call on turn 1, then final text. */
function toolCallingProvider(finalReply = "after-tools") {
  const calls = [];
  let n = 0;
  return {
    providerName: "fake",
    model: "fake-1",
    baseUrl: "http://127.0.0.1:1",
    calls,
    async chat({ messages }) {
      calls.push(messages.map((m) => ({ role: m.role, content: m.content })));
      n += 1;
      if (n === 1) {
        return {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              { id: "t1", function: { name: "totally_fake_tool", arguments: "{}" } },
            ],
          },
          finishReason: "tool_calls",
        };
      }
      return { message: { role: "assistant", content: finalReply }, finishReason: "stop" };
    },
  };
}

describe("tool hooks in the loop", () => {
  it("pre_tool_use deny blocks before dispatch; model sees the hook message", async () => {
    const hooks = new HookManager({ cfg: CFG, logger: silent });
    hooks.registerHook(
      "pre_tool_use",
      () => ({ decision: "deny", reason: "not on my watch" }),
      { tier: "system", name: "gate", matcher: "totally_fake_tool" }
    );
    const provider = toolCallingProvider("done");
    const out = await runAgentLoop({ userMessage: "go", cfg: CFG, provider, hookManager: hooks });
    assert.equal(out.finalText ?? out.text, "done");
    const toolMsg = provider.calls[1].find((m) => m.role === "tool");
    assert.match(String(toolMsg.content), /blocked by hook: not on my watch/);
  });

  it("post_tool_use rewrites the result text the model sees", async () => {
    const hooks = new HookManager({ cfg: CFG, logger: silent });
    hooks.registerHook(
      "post_tool_use",
      () => ({ resultText: "[scrubbed by hook]" }),
      { tier: "system", name: "scrub" }
    );
    const provider = toolCallingProvider("done2");
    const out = await runAgentLoop({ userMessage: "go", cfg: CFG, provider, hookManager: hooks });
    assert.equal(out.finalText ?? out.text, "done2");
    const toolMsg = provider.calls[1].find((m) => m.role === "tool");
    assert.equal(String(toolMsg.content), "[scrubbed by hook]");
  });
});

describe("on_stop block cycle", () => {
  it("system on_stop vetoes once, loop re-enters with feedback, cap respected", async () => {
    const hooks = new HookManager({ cfg: CFG, logger: silent });
    let stops = 0;
    hooks.registerHook(
      "on_stop",
      (ctx) => {
        stops += 1;
        // veto only the first completion; must see stopHookActive on retry
        if (!ctx.stopHookActive) return { abort: "tests were not run" };
      },
      { tier: "system", name: "verifier" }
    );
    const replies = ["draft answer", "final answer"];
    let n = 0;
    const calls = [];
    const provider = {
      providerName: "fake",
      model: "fake-1",
      baseUrl: "http://127.0.0.1:1",
      async chat({ messages }) {
        calls.push(messages.map((m) => ({ role: m.role, content: m.content })));
        return {
          message: { role: "assistant", content: replies[Math.min(n++, 1)] },
          finishReason: "stop",
        };
      },
    };
    const out = await runAgentLoop({ userMessage: "do the thing", cfg: CFG, provider, hookManager: hooks });
    assert.equal(out.finalText ?? out.text, "final answer");
    assert.equal(stops, 2, "stop hook consulted on both completions");
    const feedback = calls[1].find((m) => String(m.content).includes("[stop-hook]"));
    assert.match(String(feedback.content), /tests were not run/);
  });
});

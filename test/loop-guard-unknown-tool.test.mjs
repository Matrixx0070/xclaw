/**
 * W2b — the loop guard's unknown-tool CRITICAL stop is WIRED to the live loop.
 *
 * The detector (openclaw-loop/detection.mjs) always consumed
 * opts.unknownToolName (detect) and details.unknownToolName (record), but
 * loop.mjs called guard.detect(name,args) / guard.record(name,args,text) with
 * NO unknown-tool signal — so a model repeatedly hallucinating a tool name that
 * does not exist was only ever caught by the generic no-progress breaker at
 * ~20-30 calls, never by the fast typed unknown_tool_repeat stop (threshold 10).
 *
 * This drives the real runAgentLoop with a fake provider that emits the SAME
 * unadvertised tool name every turn and asserts the loop soft-stops via the
 * unknown_tool_repeat detector well before the global breaker — proving the
 * knownToolNames wiring feeds the guard. A known tool repeated the same way is
 * the control: no unknown_tool_repeat fires.
 *
 * Hermetic per the session-kill-loop lesson: temp HOME/state, injected fake
 * provider, no network, ledger off.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-unknown-tool-"));
const savedHome = process.env.HOME;
const savedState = process.env.XCLAW_STATE_DIR;

let runAgentLoop;
let resetSharedApprovalGate;

before(async () => {
  process.env.HOME = tmpHome;
  process.env.XCLAW_STATE_DIR = tmpHome;
  ({ runAgentLoop } = await import("../src/agent/loop.mjs"));
  ({ resetSharedApprovalGate } = await import("../src/security/approvals.mjs"));
});

after(() => {
  process.env.HOME = savedHome;
  if (savedState === undefined) delete process.env.XCLAW_STATE_DIR;
  else process.env.XCLAW_STATE_DIR = savedState;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

/** Fake provider: emits the SAME tool name every turn (no text finish). */
function repeatToolProvider(toolName, model = "grok-4") {
  let n = 0;
  const calls = [];
  return {
    providerName: "fake",
    model,
    modelRef: model,
    baseUrl: "http://127.0.0.1:1",
    calls,
    async chat() {
      n += 1;
      calls.push(n);
      return {
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: `call_${n}`,
              type: "function",
              function: { name: toolName, arguments: "{}" },
            },
          ],
        },
        finishReason: "tool_calls",
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      };
    },
  };
}

function baseCfg() {
  return {
    // maxTurns must exceed the unknown-tool threshold (10) so the streak can
    // reach it; kept below the global breaker (30) so the stop we assert is the
    // typed unknown-tool one, not the generic breaker.
    agent: { maxTurns: 15, persistTranscript: false },
    tokens: { enabled: false, ledger: false },
    skills: { enabled: false },
    memory: { enabled: false },
    computer: { autoStart: false },
    hooks: { log: false },
    security: { autoApprove: true },
  };
}

describe("loop guard — unknown-tool CRITICAL stop is wired (W2b)", () => {
  it("repeated hallucinated tool name trips unknown_tool_repeat CRITICAL", async () => {
    const cfg = baseCfg();
    resetSharedApprovalGate(cfg);
    const provider = repeatToolProvider("totally_not_a_real_tool_xyz");
    const events = [];
    const out = await runAgentLoop({
      cfg,
      provider,
      message: "call the fake tool",
      onEvent: (e) => events.push(e),
    });
    const guardStop = events.find(
      (e) => e.type === "guard" && e.detector === "unknown_tool_repeat"
    );
    assert.ok(
      guardStop,
      `unknown_tool_repeat guard event must fire (guard events: ${events
        .filter((e) => e.type === "guard")
        .map((e) => e.detector)
        .join(",")})`
    );
    assert.equal(guardStop.level, "critical");
    assert.match(String(guardStop.message || ""), /Unknown tool/i);
    // Fired at threshold 10 — well before the global breaker (30).
    assert.ok(
      provider.calls.length <= 12,
      `must stop near the unknown-tool threshold, got ${provider.calls.length} turns`
    );
    assert.match(String(out.text || ""), /Unknown tool/i);
  });

  it("a KNOWN tool repeated the same way does NOT trip unknown_tool_repeat", async () => {
    const cfg = baseCfg();
    resetSharedApprovalGate(cfg);
    // host_capabilities is a real, advertised local tool.
    const provider = repeatToolProvider("host_capabilities");
    const events = [];
    await runAgentLoop({
      cfg,
      provider,
      message: "call a real tool",
      onEvent: (e) => events.push(e),
    });
    assert.ok(
      !events.some(
        (e) => e.type === "guard" && e.detector === "unknown_tool_repeat"
      ),
      "a known/advertised tool name must never be flagged unknown"
    );
  });
});

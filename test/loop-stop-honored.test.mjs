import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Regression: a mid-batch "stop" from processToolCall (pending approval,
// guard critical) must end the RUN, not just the tool batch. Before the
// 2026-08-23 fix the return value was discarded (`void stopTools`) and the
// loop kept issuing model turns — the approval-storm mechanism.
// Hermetic per the session-kill-loop lesson: temp HOME/state, injected fake
// provider, no network, ledger off.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-stop-honored-"));
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

const BASE_CFG = {
  agent: { maxTurns: 6, persistTranscript: false },
  tokens: { enabled: false, ledger: false },
  skills: { enabled: false },
  memory: { enabled: false },
  computer: { autoStart: false },
  hooks: { log: false },
};

/** Fake provider that keeps requesting the same tool call until stopped. */
function toolLoopingProvider(toolName, args) {
  const calls = [];
  let n = 0;
  return {
    providerName: "fake",
    model: "fake-1",
    modelRef: "fake-1",
    baseUrl: "http://127.0.0.1:1",
    calls,
    async chat({ messages }) {
      calls.push(messages.length);
      n += 1;
      return {
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: `call_${n}`,
              type: "function",
              function: { name: toolName, arguments: JSON.stringify(args) },
            },
          ],
        },
        finishReason: "tool_calls",
      };
    },
  };
}

describe("mid-batch stop ends the run (loop.mjs stopTools honored)", () => {
  it("pending approval stops the run after ONE model turn, stopReason=approval", async () => {
    const cfg = {
      ...BASE_CFG,
      security: {
        autoApprove: false,
        bypassApprovals: false,
        approvalSlaMs: 50, // resolve the human wait fast in-test
        approvalSlaTickMs: 100, // sweep quickly (default 5s)
      },
    };
    resetSharedApprovalGate(cfg);
    const provider = toolLoopingProvider("bash", { command: "rm -rf /tmp/x" });
    const out = await runAgentLoop({
      cfg,
      provider,
      message: "delete it",
    });
    assert.equal(
      provider.calls.length,
      1,
      `loop must not re-turn after a pending approval (got ${provider.calls.length} model calls)`
    );
    assert.equal(out.stopReason, "approval");
    assert.ok(out.pendingApproval, "pendingApproval surfaced to orchestrators");
    assert.ok(out.text, "user-visible blocked reply present");
  });

  it("guard critical stops the run instead of re-turning, stopReason=guard", async () => {
    const cfg = {
      ...BASE_CFG,
      agent: {
        ...BASE_CFG.agent,
        maxTurns: 10, // headroom: guard critical (~6 calls) must beat the cap
        // Breaker below maxTurns so critical is reachable IN-RUN — the live
        // default (30 > maxTurns 15) can never fire before the turn cap.
        loopGuard: {
          warningThreshold: 2,
          criticalThreshold: 3,
          globalCircuitBreakerThreshold: 3,
        },
      },
      security: { autoApprove: true },
    };
    // Harmless repeated identical call — guard.detect trips on repetition.
    // Must be a LOCAL tool that succeeds: failing/unknown tools never reach
    // guard.record (loop.mjs:1702) so the guard would see an empty history.
    resetSharedApprovalGate(cfg);
    const provider = toolLoopingProvider("bash", { command: "true" });
    const out = await runAgentLoop({
      cfg,
      provider,
      message: "read it forever",
    });
    assert.equal(out.stopReason, "guard");
    assert.ok(
      provider.calls.length < 10,
      `guard must end the run before maxTurns=10 (got ${provider.calls.length} turns)`
    );
  });
});

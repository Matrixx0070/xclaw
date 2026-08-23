/**
 * Trust Sprint — the per-run cost governor is FED, and its ceiling fires.
 *
 * Before 2026-08-23, costGov.record() was never called anywhere in the
 * loop: .check() compared spentUsd against agent.budget.maxUsd while
 * spentUsd stayed 0 forever — the per-run USD ceiling was inert (audit
 * C#7). This proves the full path end-to-end: provider usage → per-turn
 * record (estimated USD from list rates) → check blocks the NEXT model
 * turn → typed cost event + COST_GOVERNOR final text.
 *
 * Hermetic per the session-kill-loop lesson: temp HOME/state, injected
 * fake provider, no network, ledger off.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-cost-record-"));
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

/** Fake provider: expensive turns that keep calling a harmless local tool. */
function expensiveToolProvider(model = "grok-4") {
  const calls = [];
  let n = 0;
  return {
    providerName: "fake",
    model,
    modelRef: model,
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
              function: { name: "host_capabilities", arguments: "{}" },
            },
          ],
        },
        finishReason: "tool_calls",
        // 5M+5M tokens/turn: at ANY published grok list rate this exceeds a
        // $0.01 per-run ceiling after one turn.
        usage: { prompt_tokens: 5_000_000, completion_tokens: 5_000_000, total_tokens: 10_000_000 },
      };
    },
  };
}

describe("per-run cost governor records + blocks (Trust Sprint)", () => {
  it("maxUsd ceiling stops the run after the first expensive turn", async () => {
    const cfg = {
      agent: { maxTurns: 6, persistTranscript: false, budget: { maxUsd: 0.01 } },
      tokens: { enabled: true, ledger: false },
      skills: { enabled: false },
      memory: { enabled: false },
      computer: { autoStart: false },
      hooks: { log: false },
      security: { autoApprove: true },
    };
    resetSharedApprovalGate(cfg);
    const provider = expensiveToolProvider();
    const events = [];
    const out = await runAgentLoop({
      cfg,
      provider,
      message: "do expensive things",
      onEvent: (e) => events.push(e),
    });
    const blocked = events.find((e) => e.type === "cost" && e.phase === "governor_blocked");
    assert.ok(blocked, `governor_blocked event must fire (events: ${events.filter((e) => e.type === "cost").map((e) => e.phase).join(",")})`);
    assert.equal(blocked.reason, "max_usd");
    assert.ok(blocked.used > 0, "recorded spend must be > 0 — record() is wired");
    assert.ok(
      provider.calls.length <= 2,
      `ceiling must stop the run early (got ${provider.calls.length} model turns)`
    );
    assert.match(String(out.text || ""), /COST_GOVERNOR/);
  });

  it("without a ceiling the same run is not cost-blocked (no regression)", async () => {
    const cfg = {
      agent: { maxTurns: 3, persistTranscript: false },
      // test 1's recorded spend already fed the DAILY governor in this
      // hermetic HOME and PAUSED it on the hard cap (proof the wiring is
      // real). Reset the daily state so this test isolates the PER-RUN
      // ceiling only.
      cost: { dailySoftUsd: 100000, dailyHardUsd: 1000000 },
      tokens: { enabled: true, ledger: false },
      skills: { enabled: false },
      memory: { enabled: false },
      computer: { autoStart: false },
      hooks: { log: false },
      security: { autoApprove: true },
    };
    resetSharedApprovalGate(cfg);
    for (const f of ["cost-governor.json", "cost-ledger.jsonl"]) {
      fs.rmSync(path.join(tmpHome, ".xclaw", f), { force: true });
    }
    const provider = expensiveToolProvider();
    const events = [];
    await runAgentLoop({ cfg, provider, message: "do things", onEvent: (e) => events.push(e) });
    assert.ok(
      !events.some((e) => e.type === "cost" && e.phase === "governor_blocked"),
      "no per-run ceiling configured → no per-run block"
    );
  });
});

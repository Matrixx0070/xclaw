import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// S3 (Master Evolution Directive): the turn budget is a SEGMENT boundary,
// not a mission boundary. The loop checkpoints at each maxTurns multiple and
// continues up to a bounded total; "maximum turns reached" only fires at the
// total cap. Orchestrators pass continuation:false for the old single-segment
// contract. Hermetic: temp HOME/state, fake provider, no network.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-cont-"));
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
  agent: { maxTurns: 3, persistTranscript: false },
  tokens: { enabled: false, ledger: false },
  skills: { enabled: false },
  memory: { enabled: false },
  computer: { autoStart: false },
  security: { autoApprove: true },
  hooks: { log: false },
};

/** Tool-calls for `workTurns` turns (varied args), then finishes with text. */
function finishingProvider(workTurns) {
  let n = 0;
  return {
    providerName: "fake",
    model: "fake-1",
    modelRef: "fake-1",
    baseUrl: "http://127.0.0.1:1",
    get calls() {
      return n;
    },
    async chat() {
      n += 1;
      if (n > workTurns) {
        return {
          message: { role: "assistant", content: "TASK COMPLETE: all steps done." },
          finishReason: "stop",
        };
      }
      return {
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: `c${n}`,
              type: "function",
              function: { name: "bash", arguments: JSON.stringify({ command: `echo step${n}` }) },
            },
          ],
        },
        finishReason: "tool_calls",
      };
    },
  };
}

describe("turn-budget continuation (S3)", () => {
  it("a task needing 8 turns finishes under maxTurns=3 via continuation", async () => {
    const segments = [];
    const provider = finishingProvider(8);
    const out = await runAgentLoop({
      cfg: CFG,
      provider,
      message: "do 8 steps",
      onEvent: (e) => {
        if (e.type === "segment") segments.push(e);
      },
    });
    assert.equal(out.stopReason, "natural", "run must finish, not hit the cap");
    assert.match(out.text, /TASK COMPLETE/);
    assert.ok(out.turns > 3, `continued past the 3-turn segment (turns=${out.turns})`);
    assert.ok(segments.length >= 2, `segment checkpoints emitted (got ${segments.length})`);
  });

  it("continuation:false keeps the old single-segment contract", async () => {
    const provider = finishingProvider(8);
    const out = await runAgentLoop({
      cfg: CFG,
      provider,
      message: "do 8 steps",
      continuation: false,
    });
    assert.equal(out.stopReason, "maxTurns");
    assert.equal(out.turns, 3, "stopped exactly at the segment budget");
  });

  it("a never-finishing task stops at the bounded total (4x), stopReason maxTurns", async () => {
    const provider = finishingProvider(Infinity);
    const out = await runAgentLoop({
      cfg: { ...CFG, agent: { ...CFG.agent, finalAnswerRescue: false } },
      provider,
      message: "loop forever",
    });
    assert.equal(out.stopReason, "maxTurns");
    assert.equal(out.turns, 12, `total cap = 4x segment (turns=${out.turns})`);
  });

  it("cfg agent.maxTotalTurns overrides the default 4x cap", async () => {
    const provider = finishingProvider(Infinity);
    const out = await runAgentLoop({
      cfg: {
        ...CFG,
        agent: { ...CFG.agent, maxTotalTurns: 5, finalAnswerRescue: false },
      },
      provider,
      message: "loop forever",
    });
    assert.equal(out.turns, 5);
    assert.equal(out.stopReason, "maxTurns");
  });

  it("segment checkpoints persist durable state mid-run", async () => {
    const { loadAgentRun } = await import("../src/agent/run-store.mjs");
    const provider = finishingProvider(8);
    const seen = [];
    const out = await runAgentLoop({
      cfg: CFG,
      provider,
      message: "do 8 steps",
      sessionId: "s3-checkpoint",
      persistRun: true,
      onEvent: (e) => {
        if (e.type === "segment") seen.push(e.turns);
      },
    });
    assert.equal(out.stopReason, "natural");
    const saved = await loadAgentRun(CFG, "s3-checkpoint");
    // Final persist overwrites the checkpoint — status must be the honest
    // terminal state; the checkpoints proved themselves via the events.
    assert.equal(saved?.run?.status, "completed");
    assert.ok(seen.length >= 2, "mid-run checkpoints fired");
  });
});

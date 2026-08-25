/**
 * The tool_call/tool_result pairing invariant must be ENFORCED, not merely
 * computed.
 *
 * Third instalment of the mutation sweep that produced
 * loop-toctou-enforcement.test.mjs (v3.180.0) and
 * loop-allowtools-enforcement.test.mjs (v3.180.1). W2 split every loop
 * decision into a pure planner in loop-stages.mjs and an enforcement block in
 * loop.mjs. The planners have exhaustive unit tests; several enforcement
 * blocks had none, and a unit test of a pure function cannot tell a computed
 * plan from an executed one.
 *
 * `planPairingBackfill` had that shape. Mutating the enforcement to
 *
 *     for (const skip of []) {          // loop.mjs, was planPairingBackfill(...)
 *
 * disables the backfill for every run in the product and leaves all 3014 tests
 * green. Nothing in the suite executed that loop.
 *
 * What it costs in production: a mid-batch stop (pending approval, guard
 * denial, quota) leaves later calls in the batch unexecuted while their ids are
 * already in the transcript. An orphaned tool_use id 400s the very next
 * Anthropic request, and consumers lose the calls silently instead of being
 * told which ones were dropped.
 *
 * Only the event half is observable from outside: the durable transcript
 * stores user/assistant text only (loop.mjs), so the tool message pushed
 * alongside each event cannot be asserted here. The event is emitted from the
 * same loop body as the message, so a mutation that kills one kills both.
 *
 * Both directions are asserted. Backfilling unconditionally would satisfy the
 * negative test alone, so the mirror runs a batch that completes and requires
 * silence.
 *
 * Hermetic: temp HOME/state, injected fake provider, no network.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-stage-enf-"));
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

/** Fake provider: one batch of tool calls on turn 1, then a text finish. */
function batchThenText(toolCalls) {
  let n = 0;
  return {
    providerName: "fake",
    model: "grok-4",
    modelRef: "grok-4",
    baseUrl: "http://127.0.0.1:1",
    async chat() {
      n += 1;
      if (n === 1) {
        return {
          message: { role: "assistant", content: "", tool_calls: toolCalls },
          finishReason: "tool_calls",
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        };
      }
      return {
        message: { role: "assistant", content: "done" },
        finishReason: "stop",
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
    },
  };
}

function bashCall(id, args) {
  return {
    id,
    type: "function",
    function: { name: "xclaw_bash", arguments: JSON.stringify(args) },
  };
}

function baseCfg(security) {
  return {
    agent: { maxTurns: 3, persistTranscript: false },
    tokens: { enabled: false, ledger: false },
    skills: { enabled: false },
    memory: { enabled: false },
    computer: { autoStart: false },
    hooks: { log: false },
    security,
  };
}

describe("loop enforces the tool-call pairing invariant", () => {
  it("answers every tool_call id when a mid-batch stop drops the rest", async () => {
    const work = fs.realpathSync(fs.mkdtempSync(path.join(tmpHome, "pair-")));
    const marker = path.join(work, "second-ran");
    const events = [];

    // Two exec calls in one batch. Exec tools are not parallel-safe, so they
    // run serially: the first pends for a human who never answers, the batch
    // stops, and the second is never executed — but its id is already in the
    // transcript the model will see next.
    const provider = batchThenText([
      bashCall("call_1", { command: "/usr/bin/true" }),
      bashCall("call_2", { command: `/usr/bin/touch ${marker}` }),
    ]);

    await runAgentLoop({
      cfg: baseCfg({
        autoApprove: false,
        approvalPolicy: "always",
        revalidateOnDecide: false,
        approvalTimeoutMs: 60, // nobody answers; the window closes
      }),
      provider,
      workingDir: work,
      message: "run both",
      onEvent: (e) => events.push(e),
    });

    // Preconditions: the stop really happened, at the first call.
    assert.ok(
      events.some((e) => e.type === "security" && e.phase === "approval_required"),
      "the first call must have pended"
    );
    assert.ok(!fs.existsSync(marker), "the dropped call must not have executed");

    const skipped = events.filter((e) => e.type === "tool" && e.phase === "skipped");
    assert.deepEqual(
      skipped.map((e) => e.callId),
      ["call_2"],
      `every unexecuted call id must be answered (tool phases seen: ${events
        .filter((e) => e.type === "tool")
        .map((e) => `${e.phase}:${e.callId || e.name}`)
        .join(",")})`
    );
    assert.equal(skipped[0].reason, "turn_stopped");
  });

  it("backfills nothing when the whole batch ran", async () => {
    // The mirror: a backfill that ignores what already ran would satisfy the
    // test above while reporting executed calls as skipped.
    const work = fs.realpathSync(fs.mkdtempSync(path.join(tmpHome, "nopair-")));
    const events = [];

    await runAgentLoop({
      cfg: baseCfg({ autoApprove: true, criticalOverride: "legacy" }),
      provider: batchThenText([bashCall("call_1", { command: "/usr/bin/true" })]),
      workingDir: work,
      message: "run it",
      onEvent: (e) => events.push(e),
    });

    assert.ok(
      events.some((e) => e.type === "tool" && e.phase === "end" && e.name === "xclaw_bash"),
      "the call must have run"
    );
    assert.equal(
      events.filter((e) => e.type === "tool" && e.phase === "skipped").length,
      0,
      "an executed call must never be reported as skipped"
    );
  });
});

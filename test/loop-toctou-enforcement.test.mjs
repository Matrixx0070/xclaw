/**
 * The loop must ENFORCE the security decisions it computes, not merely compute
 * them.
 *
 * W2 moved the decision logic into pure stages (loop-stages.mjs) and left the
 * side effects in loop.mjs. The stages got exhaustive unit tests; the half that
 * performs them got only source-greps — plan-toctou-e2e.test.mjs asserts
 * loop.mjs *contains the string* `planToctouRevalidation({`. Mutation testing
 * confirmed the hole: deleting the entire post-approval TOCTOU block, and
 * deleting the approval-outcome event emission, both leave the full suite
 * green. A grep cannot tell a computed verdict from an enforced one.
 *
 * These two tests drive the real runAgentLoop and assert on behaviour:
 *  - the drifted plan is BLOCKED (no `tool start` for the exec call) and says
 *    so on the event stream;
 *  - the denied call reports `denied` to the event stream.
 *
 * The drift is produced the way the real threat does it — the approved working
 * directory is swapped for a symlink to somewhere else while the operator is
 * deciding. onEvent fires from inside the gate's onPending, so answering the
 * approval from there puts the test squarely in the TOCTOU window rather than
 * simulating it.
 *
 * Hermetic: temp HOME/state, injected gate, injected fake provider, no network.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-toctou-"));
const savedHome = process.env.HOME;
const savedState = process.env.XCLAW_STATE_DIR;

let runAgentLoop;
let createApprovalGate;

before(async () => {
  process.env.HOME = tmpHome;
  process.env.XCLAW_STATE_DIR = tmpHome;
  ({ runAgentLoop } = await import("../src/agent/loop.mjs"));
  ({ createApprovalGate } = await import("../src/security/approvals.mjs"));
});

after(() => {
  process.env.HOME = savedHome;
  if (savedState === undefined) delete process.env.XCLAW_STATE_DIR;
  else process.env.XCLAW_STATE_DIR = savedState;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

/** Fake provider: one exec tool call on turn 1, then a plain text finish. */
function oneToolThenText(command) {
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
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "xclaw_bash",
                  arguments: JSON.stringify({ command }),
                },
              },
            ],
          },
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

function baseCfg() {
  return {
    agent: { maxTurns: 3, persistTranscript: false },
    tokens: { enabled: false, ledger: false },
    skills: { enabled: false },
    memory: { enabled: false },
    computer: { autoStart: false },
    hooks: { log: false },
    security: {
      // Every tool pends, so the run passes through the human path where the
      // plan is frozen before the operator sees the request.
      autoApprove: false,
      approvalPolicy: "always",
      // Decide-time revalidation is the OTHER layer that catches this drift.
      // Turning it off is what puts the loop's own post-approval check under
      // test — it is the last line of defense when the drift lands after the
      // decision, which is the case this block exists for.
      revalidateOnDecide: false,
    },
  };
}

/** A real dir the plan will pin, plus the dir the symlink will point at. */
function makeWorkspace(label) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(tmpHome, `${label}-`)));
  const work = path.join(base, "work");
  const elsewhere = path.join(base, "elsewhere");
  fs.mkdirSync(work);
  fs.mkdirSync(elsewhere);
  return { base, work, elsewhere };
}

describe("loop enforces post-approval security decisions", () => {
  it("blocks the tool when the approved cwd drifts (TOCTOU)", async () => {
    const cfg = baseCfg();
    const gate = createApprovalGate(cfg);
    const { work, elsewhere } = makeWorkspace("drift");
    const marker = path.join(elsewhere, "executed");
    const events = [];
    let swapped = false;

    const out = await runAgentLoop({
      cfg,
      provider: oneToolThenText(`/usr/bin/touch ${marker}`),
      workingDir: work,
      approvalGate: gate,
      message: "run the command",
      onEvent: (e) => {
        events.push(e);
        // Inside the approval window: replace the approved directory with a
        // symlink pointing somewhere else, then approve. The frozen plan still
        // pins the original realpath.
        if (e.type === "security" && e.phase === "approval_required" && !swapped) {
          swapped = true;
          fs.rmSync(work, { recursive: true, force: true });
          fs.symlinkSync(elsewhere, work, "dir");
          gate.decide(e.pendingId, true, "operator approved");
        }
      },
    });

    assert.equal(swapped, true, "the approval must have been asked for");

    const failed = events.find(
      (e) => e.type === "security" && e.phase === "plan_revalidate_failed"
    );
    assert.ok(
      failed,
      `drift must be reported on the event stream (security phases seen: ${events
        .filter((e) => e.type === "security")
        .map((e) => e.phase)
        .join(",")})`
    );
    assert.equal(failed.name, "xclaw_bash");
    assert.equal(failed.reason, "plan_drift");
    assert.ok(failed.drift?.cwd, "the drifted pin must be named");

    // The decision has to STOP the call, not just describe it.
    const started = events.find(
      (e) => e.type === "tool" && e.phase === "start" && e.name === "xclaw_bash"
    );
    assert.ok(
      !started,
      "a plan that failed revalidation must never reach execution"
    );
    assert.ok(!fs.existsSync(marker), "the command must not have run");
    assert.ok(!/executed/.test(String(out.text || "")));
  });

  it("reports a denied call on the event stream", async () => {
    const cfg = baseCfg();
    const gate = createApprovalGate(cfg);
    const { work } = makeWorkspace("deny");
    const events = [];
    let asked = false;

    await runAgentLoop({
      cfg,
      provider: oneToolThenText("/usr/bin/true"),
      workingDir: work,
      approvalGate: gate,
      message: "run the command",
      onEvent: (e) => {
        events.push(e);
        if (e.type === "security" && e.phase === "approval_required" && !asked) {
          asked = true;
          gate.decide(e.pendingId, false, "operator declined");
        }
      },
    });

    assert.equal(asked, true, "the approval must have been asked for");
    const denied = events.find(
      (e) => e.type === "security" && e.phase === "denied"
    );
    assert.ok(
      denied,
      `the denial must reach consumers — channels render it and the ledger ` +
        `records it (security phases seen: ${events
          .filter((e) => e.type === "security")
          .map((e) => e.phase)
          .join(",")})`
    );
    assert.equal(denied.name, "xclaw_bash");
    assert.ok(
      !events.some(
        (e) => e.type === "tool" && e.phase === "start" && e.name === "xclaw_bash"
      ),
      "a denied call must never reach execution"
    );
  });
});

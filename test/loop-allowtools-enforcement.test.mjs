/**
 * The run-scoped tool allowlist (`cfg.agent.allowTools`) must actually STOP a
 * call, not just describe one.
 *
 * Same blind spot class as loop-toctou-enforcement.test.mjs. W2 extracted the
 * decision into a pure stage — `evaluateRunAllowlist` in loop-stages.mjs — which
 * has unit tests, and left the enforcement in loop.mjs, which had none.
 * Mutation testing on 2026-08-25 proved the hole: changing the enforcement to
 *
 *     if (false && allowBlock) {   // loop.mjs
 *
 * disables the allowlist for every run in the product and leaves all 3012
 * tests green. Nothing in the suite executed that branch.
 *
 * The filter is defense in depth: excluded tools are never advertised to the
 * model, so reaching this block at all means the model produced a name it was
 * not offered. That is exactly the case the block exists for, and exactly the
 * case a unit test of the pure stage cannot cover.
 *
 * Both directions are asserted. Blocking everything would satisfy the negative
 * test alone, so the positive test runs the SAME tool under an allowlist that
 * permits it and requires the side effect to land. The pair cannot be satisfied
 * by a constant.
 *
 * Hermetic: temp HOME/state, injected fake provider, no network. The exec is a
 * real `/usr/bin/touch` inside the temp tree — the observable proof is whether
 * the file exists.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-allowtools-"));
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

/** Fake provider: one tool call on turn 1 (name chosen by the test), then text. */
function oneToolThenText(name, args) {
  let n = 0;
  const calls = [];
  return {
    providerName: "fake",
    model: "grok-4",
    modelRef: "grok-4",
    baseUrl: "http://127.0.0.1:1",
    calls,
    async chat(req) {
      n += 1;
      calls.push(req);
      if (n === 1) {
        return {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name, arguments: JSON.stringify(args) },
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

function cfgWithAllow(allowTools) {
  return {
    agent: { maxTurns: 3, persistTranscript: false, allowTools },
    tokens: { enabled: false, ledger: false },
    skills: { enabled: false },
    memory: { enabled: false },
    computer: { autoStart: false },
    hooks: { log: false },
    // Approvals are OFF on purpose. If the run pended, the call would be
    // stopped by the approval gate and the test would pass with the allowlist
    // enforcement deleted — the mutation has to be the ONLY thing standing
    // between the model's tool call and execution.
    security: { autoApprove: true, criticalOverride: "legacy" },
  };
}

function makeWorkspace(label) {
  const work = fs.realpathSync(
    fs.mkdtempSync(path.join(tmpHome, `${label}-`))
  );
  return { work, marker: path.join(work, "executed") };
}

describe("loop enforces the run-scoped tool allowlist", () => {
  it("blocks a tool the run does not allow, and it never executes", async () => {
    const { work, marker } = makeWorkspace("blocked");
    const events = [];

    const out = await runAgentLoop({
      // The run is scoped to read-only file tools. xclaw_bash is excluded, so
      // it is never advertised — the model below hallucinates it.
      cfg: cfgWithAllow(["xclaw_file_read", "xclaw_file_list"]),
      provider: oneToolThenText("xclaw_bash", {
        command: `/usr/bin/touch ${marker}`,
      }),
      workingDir: work,
      message: "run the command",
      onEvent: (e) => events.push(e),
    });

    const blocked = events.find(
      (e) => e.type === "tool" && e.phase === "blocked" && e.name === "xclaw_bash"
    );
    assert.ok(
      blocked,
      `the block must reach consumers (tool phases seen: ${events
        .filter((e) => e.type === "tool")
        .map((e) => `${e.phase}:${e.name}`)
        .join(",")})`
    );
    assert.equal(blocked.reason, "allowTools");

    // The security property. Everything above is reporting; this is enforcement.
    assert.ok(
      !events.some(
        (e) => e.type === "tool" && e.phase === "start" && e.name === "xclaw_bash"
      ),
      "an excluded tool must never reach dispatch"
    );
    assert.ok(!fs.existsSync(marker), "the excluded command must not have run");

    // Blocking is not aborting: the model is told the tool is unavailable and
    // the turn continues, which is what lets it choose a permitted tool next.
    assert.equal(String(out.text || ""), "done");
  });

  it("runs the same tool when the run does allow it", async () => {
    const { work, marker } = makeWorkspace("allowed");
    const events = [];

    await runAgentLoop({
      cfg: cfgWithAllow(["xclaw_bash"]),
      provider: oneToolThenText("xclaw_bash", {
        command: `/usr/bin/touch ${marker}`,
      }),
      workingDir: work,
      message: "run the command",
      onEvent: (e) => events.push(e),
    });

    assert.ok(
      !events.some((e) => e.type === "tool" && e.phase === "blocked"),
      "an allowed tool must not be filtered"
    );
    assert.ok(
      fs.existsSync(marker),
      "the allowed command must actually have run — otherwise the negative " +
        "test above is satisfied by a filter that blocks everything"
    );
  });
});

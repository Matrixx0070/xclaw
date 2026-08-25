/**
 * The loop's tool-output truncation, asserted where it matters: the text the
 * model actually receives.
 *
 * Sixth instalment of the mutation sweep behind loop-toctou-enforcement
 * (v3.180.0), loop-allowtools-enforcement (v3.180.1), loop-stage-enforcement /
 * loop-guard-enforcement (v3.180.2) and loop-budget-enforcement (v3.182.0).
 * This block was mutated to a no-op on 2026-08-25 and the full suite stayed
 * green at 3032 tests:
 *
 *     U: const trunc = (truncOpts.enabled && false) ? truncateToolResult(...) : { text: rawText, ... }
 *
 * Unlike the budget gates, nothing masked this one — nothing looked. The pure
 * function is well covered (test/grounding.test.mjs calls truncateToolResult
 * and truncationOptsFromConfig directly, test/unicode-truncate.test.mjs covers
 * the code-point handling), but no test followed the value out of the loop, so
 * the loop was free to stop calling it. A 24k-char command result would have
 * gone to the provider whole — the context blow-up the cap exists to prevent —
 * with the suite green.
 *
 * So the assertions here are on the tool message the provider is handed on its
 * next turn: shorter than the raw output, carrying the truncation marker, and
 * missing the middle of the output that head+tail cannot cover. The `tool/end`
 * event's truncated/originalChars/keptChars are checked too, but on their own
 * they are only reporting — they would still be emitted by a loop that shipped
 * the untruncated text.
 *
 * Both directions: the mirror runs the SAME command through the SAME config
 * with only `tokens.truncate.enabled` flipped to false, and requires the full
 * output through. Without it, a truncator that returned "" would pass.
 *
 * Hermetic: temp HOME/state, injected fake provider, no network. `seq` is used
 * for the payload because its output is deterministic and self-indexing — line
 * 2500 is present iff the middle survived.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-trunc-enf-"));
const saved = {};

let runAgentLoop;

/** `seq 1 5000` — 23,893 chars, far above the 4,000-char default cap. */
const LINES = 5000;
const RAW_CHARS = 23893;

before(async () => {
  for (const k of ["HOME", "XCLAW_STATE_DIR"]) saved[k] = process.env[k];
  process.env.HOME = tmpHome;
  process.env.XCLAW_STATE_DIR = tmpHome;
  ({ runAgentLoop } = await import("../src/agent/loop.mjs"));
});

after(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function workspace(label) {
  return fs.realpathSync(fs.mkdtempSync(path.join(tmpHome, `${label}-`)));
}

function cfg(dir, truncate) {
  return {
    agent: { maxTurns: 3, persistTranscript: false },
    tokens: { enabled: false, ledger: false, ...(truncate ? { truncate } : {}) },
    skills: { enabled: false },
    memory: { enabled: false },
    computer: { autoStart: false },
    hooks: { log: false },
    security: { autoApprove: true, criticalOverride: "legacy" },
    paths: { configDir: dir },
    cost: { dailyHardUsd: 100, dailySoftUsd: 100 },
  };
}

/**
 * One bash call that prints LINES lines, then a text finish. Captures the
 * messages handed to the provider on the second turn — that array is the only
 * place the truncation decision becomes observable to the model.
 */
function seqProvider() {
  const p = {
    calls: 0,
    seen: null,
    providerName: "fake",
    model: "grok-4",
    modelRef: "grok-4",
    baseUrl: "http://127.0.0.1:1",
    async chat(req) {
      p.calls += 1;
      if (p.calls === 1) {
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
                  arguments: JSON.stringify({ command: `/usr/bin/seq 1 ${LINES}` }),
                },
              },
            ],
          },
          finishReason: "tool_calls",
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        };
      }
      p.seen = req?.messages || null;
      return {
        message: { role: "assistant", content: "done" },
        finishReason: "stop",
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
    },
  };
  return p;
}

async function drive(conf, provider, workingDir) {
  const events = [];
  let error = null;
  try {
    await runAgentLoop({
      cfg: conf,
      provider,
      workingDir,
      userMessage: "count",
      onEvent: (e) => events.push(e),
    });
  } catch (e) {
    error = e;
  }
  const toolMsg = Array.isArray(provider.seen)
    ? provider.seen.find((m) => m.role === "tool")
    : null;
  return {
    error,
    text: String(toolMsg?.content || ""),
    end: events.find((e) => e.type === "tool" && e.phase === "end") || null,
  };
}

describe("loop truncates oversized tool output before the model sees it", () => {
  it("hands the model a capped, marked result", async () => {
    const work = workspace("trunc-on");
    const provider = seqProvider();

    const r = await drive(cfg(work), provider, work);

    assert.equal(r.error, null, `the run must complete (got: ${r.error?.message})`);
    assert.ok(r.text, "the model must have been handed a tool result");
    // The point of the cap: the model is not shown the whole thing.
    assert.ok(
      r.text.length < RAW_CHARS,
      `truncated text must be shorter than the ${RAW_CHARS}-char output (got ${r.text.length})`
    );
    assert.match(
      r.text,
      /\[truncated \d+ of \d+ chars/,
      "the model must be told the result was cut, not silently handed a fragment"
    );
    // head + tail are kept, so the discriminator is the middle.
    assert.ok(!r.text.includes("\n2500\n"), "the omitted middle must really be omitted");
    assert.ok(r.text.startsWith("1\n2\n3\n"), "the head must survive");
    assert.ok(r.text.includes(`\n${LINES}`), "the tail must survive");
    // Reporting, checked but not relied on: these fields are emitted either way.
    assert.equal(r.end?.truncated, true);
    assert.equal(r.end?.originalChars, RAW_CHARS);
    assert.ok(r.end.keptChars < r.end.originalChars);
  });

  it("hands the model the whole result when truncation is turned off", async () => {
    const work = workspace("trunc-off");
    const provider = seqProvider();

    // Identical command, identical config — only the switch moves.
    const r = await drive(cfg(work, { enabled: false }), provider, work);

    assert.equal(r.error, null, `the run must complete (got: ${r.error?.message})`);
    assert.equal(
      r.text.length,
      RAW_CHARS,
      "with truncation off the model must receive the output whole — otherwise " +
        "the test above is satisfied by a truncator that always returns a stub"
    );
    assert.ok(r.text.includes("\n2500\n"), "the middle must be present when nothing was cut");
    assert.ok(!/\[truncated \d+ of \d+ chars/.test(r.text), "nothing was cut, so nothing to mark");
    assert.equal(r.end?.truncated, false);
    assert.equal(r.end?.keptChars, r.end?.originalChars);
  });
});

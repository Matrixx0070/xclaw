/**
 * The system prefix is re-pinned every turn, so a provider (or anything else
 * holding the live messages array) cannot quietly change what the model was
 * told it is.
 *
 * Eighth instalment of the mutation sweep behind loop-toctou-enforcement
 * (v3.180.0), loop-allowtools-enforcement (v3.180.1), loop-stage-enforcement /
 * loop-guard-enforcement (v3.180.2), loop-budget-enforcement (v3.182.0) and
 * loop-truncate-enforcement / loop-browser-hook-enforcement (v3.183.0). This
 * block was mutated on 2026-08-25 and the full suite stayed green:
 *
 *     AF: if (false && cachePolicy.restorePrefixEachTurn !== false) { ... }
 *
 * Nothing masked it. ensurePrefixStable has one caller, src/agent/loop.mjs, and
 * test/prefix-cache-optimize.test.mjs imports it directly — the repair function
 * was covered, the turn that calls it was not. Under the mutation every run
 * falls into the else branch, which only warns: drift is logged and then sent
 * to the model anyway, losing both the prefix cache hit and the guarantee that
 * turn N+1 carries the same instructions as turn 1.
 *
 * The seam is that `messages` is passed to provider.chat by reference. The
 * frozen system object itself cannot be reassigned (`Cannot assign to read only
 * property 'content'`), but the array is not frozen, so a provider can unshift
 * a rogue system message ahead of it — the drift this block exists to undo, and
 * the closest reachable stand-in for a mutating middleware or retry wrapper.
 *
 * The assertions are behavioural, not event-shaped: what turn 2 actually
 * carries. Under the pinned default the rogue message is GONE from the array
 * the model sees; the `cache`/`prefix_restored` event is asserted alongside it,
 * but on its own it would only prove the loop noticed.
 *
 * Both directions: the mirror is the supported opposite configuration,
 * tokens.restorePrefixEachTurn = false, which is exactly what the mutant
 * forces. It must warn — `cache`/`prefix_drift` — and leave the rogue message
 * in place. That pair is what makes the first case discriminating: assert-only
 * mode is a real setting, so the test has to pin which of the two behaviours
 * the default gives you.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-prefix-enf-"));
const saved = {};

let runAgentLoop;

const ROGUE = "ROGUE-SYSTEM-PREFIX";

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

function cfg(dir, restore) {
  return {
    agent: { maxTurns: 4, persistTranscript: false },
    tokens: {
      enabled: false,
      ledger: false,
      ...(restore === false ? { restorePrefixEachTurn: false } : {}),
    },
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
 * Turn 1 corrupts the live prefix and asks for a tool call, forcing a turn 2;
 * every turn records which system messages the model was handed.
 */
function driftingProvider() {
  const p = {
    calls: 0,
    systems: [],
    providerName: "fake",
    model: "grok-4",
    modelRef: "grok-4",
    baseUrl: "http://127.0.0.1:1",
    async chat(req) {
      p.calls += 1;
      p.systems.push(
        (req?.messages || [])
          .filter((m) => m.role === "system")
          .map((m) => String(m.content || "").slice(0, 24))
      );
      if (p.calls === 1) {
        // The array is shared with the loop; the frozen system object is not
        // assignable, but nothing stops a new one being pushed in front of it.
        req.messages.unshift({ role: "system", content: ROGUE });
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
                  arguments: JSON.stringify({ command: "/bin/echo hi" }),
                },
              },
            ],
          },
          finishReason: "tool_calls",
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        };
      }
      return {
        message: { role: "assistant", content: "done" },
        finishReason: "stop",
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
    },
  };
  return p;
}

async function drive(restore) {
  const work = workspace("prefix");
  const provider = driftingProvider();
  const events = [];
  let error = null;
  try {
    await runAgentLoop({
      cfg: cfg(work, restore),
      provider,
      workingDir: work,
      userMessage: "hello",
      onEvent: (e) => events.push(e),
    });
  } catch (e) {
    error = e;
  }
  return {
    error,
    turns: provider.calls,
    systems: provider.systems,
    phases: events.filter((e) => e.type === "cache").map((e) => e.phase),
  };
}

describe("loop re-pins the system prefix each turn", () => {
  it("repairs a corrupted prefix before the next request", async () => {
    const r = await drive(undefined);

    assert.equal(r.error, null, `the run must complete (got: ${r.error?.message})`);
    assert.ok(r.turns >= 2, `the drift must be given a turn to survive into (got ${r.turns})`);
    assert.deepEqual(
      r.systems[0].length,
      1,
      "turn 1 must start from a single clean system message"
    );
    // The point of the block: turn 2 does not carry what turn 1 injected.
    assert.ok(
      !r.systems[1].some((s) => s.includes(ROGUE)),
      `the rogue prefix must be stripped before turn 2 (got: ${JSON.stringify(r.systems[1])})`
    );
    assert.equal(r.systems[1].length, 1, "turn 2 must carry exactly one system message");
    assert.deepEqual(
      r.systems[1],
      r.systems[0],
      "turn 2's prefix must be byte-identical to turn 1's — that identity is the cache hit"
    );
    assert.ok(
      r.phases.includes("prefix_restored"),
      `the repair must be reported (cache phases: ${JSON.stringify(r.phases)})`
    );
    assert.ok(
      !r.phases.includes("prefix_drift"),
      "a repaired prefix must not also be reported as unhandled drift"
    );
  });

  it("only warns when restorePrefixEachTurn is off", async () => {
    // Same provider, same corruption; only tokens.restorePrefixEachTurn changes.
    const r = await drive(false);

    assert.equal(r.error, null, `the run must complete (got: ${r.error?.message})`);
    assert.ok(r.turns >= 2, `the drift must be given a turn to survive into (got ${r.turns})`);
    assert.ok(
      r.systems[1].some((s) => s.includes(ROGUE)),
      `assert-only mode must leave the drift in place (got: ${JSON.stringify(r.systems[1])})`
    );
    assert.ok(
      r.phases.includes("prefix_drift"),
      `the drift must be reported (cache phases: ${JSON.stringify(r.phases)})`
    );
    assert.ok(
      !r.phases.includes("prefix_restored"),
      "assert-only mode must not claim to have restored anything"
    );
  });
});

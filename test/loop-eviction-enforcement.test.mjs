/**
 * Context eviction is wired into the turn loop, not merely available: old tool
 * results really are shed from the array handed to the provider.
 *
 * Seventh instalment of the mutation sweep behind loop-toctou-enforcement
 * (v3.180.0), loop-allowtools-enforcement (v3.180.1), loop-stage-enforcement /
 * loop-guard-enforcement (v3.180.2), loop-budget-enforcement (v3.182.0) and
 * loop-truncate-enforcement / loop-browser-hook-enforcement (v3.183.0). This
 * block was mutated to a no-op on 2026-08-25 and the full suite stayed green:
 *
 *     AC: if (false && evictOpts.enabled && evictOpts.policy !== "none") { ... }
 *
 * Nothing masked it. evictMessages has exactly one caller in the whole tree,
 * src/agent/loop.mjs, and the two suites that exercise eviction —
 * test/eviction-last-user.test.mjs and test/anthropic-thinking-replay.test.mjs
 * — import the pure functions directly (the latter also reads loop.mjs as
 * text, which a no-op'd `if` still satisfies). The algorithm was covered; the
 * wiring was not. With the block dead, a long session hands the model every
 * tool result it ever produced until the provider rejects the request.
 *
 * The `cache`/`pressure` event is NOT discriminating: measureContextPressure
 * runs above the `if`, so pressure still fires under the mutant. The
 * fingerprints asserted below belong to eviction alone — the `cache`/`eviction`
 * event, emitted only inside the mutated branch, and the "[evicted tool
 * result]" stub, written only by src/tokens/eviction.mjs and
 * src/tokens/tool-lru.mjs, both reachable only through that call.
 *
 * Levers, and why these and not the obvious ones: configured maxMessages does
 * not survive contact with the loop — pressureToEvictionTweaks is spread AFTER
 * evictionOptsFromConfig and rewrites maxMessages to 24/32/40 at any pressure
 * >= 0.4, so a tight message window is silently discarded. maxChars is not
 * rewritten, so the pair drives the char-budget path instead: four ~1.4KB tool
 * results against a 4000-char budget. Per-result truncation and compaction are
 * switched off so that the only thing in the loop that can shorten an old tool
 * message is the block under test (compaction shrinks the same transcript, and
 * with it left on it — not eviction — was doing the shedding).
 *
 * Both directions: the mirror runs the same four commands with the same budget
 * and changes exactly one field, tokens.eviction.enabled, and requires every
 * result intact at full length. Without it, a loop that dropped tool history
 * unconditionally would pass.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-evict-enf-"));
const saved = {};

let runAgentLoop;

/** Four turns of this comfortably exceed the 4000-char budget below. */
const PAD = "A".repeat(1400);
const TURNS = 4;
const FULL_LEN = PAD.length + " TURN-1\n".length; // /bin/echo adds one newline
const STUB = "[evicted tool result]";

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

function cfg(dir, eviction) {
  return {
    agent: { maxTurns: TURNS + 2, persistTranscript: false },
    tokens: {
      enabled: false,
      ledger: false,
      // Isolate the block under test: both of these also shorten tool history.
      truncate: { enabled: false },
      compaction: { enabled: false },
      eviction,
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

/** Emits TURNS large echoes, then finishes; records the last messages seen. */
function echoProvider() {
  const p = {
    calls: 0,
    seen: null,
    providerName: "fake",
    model: "grok-4",
    modelRef: "grok-4",
    baseUrl: "http://127.0.0.1:1",
    async chat(req) {
      p.calls += 1;
      p.seen = req?.messages || null;
      if (p.calls <= TURNS) {
        return {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: `call_${p.calls}`,
                type: "function",
                function: {
                  name: "xclaw_bash",
                  arguments: JSON.stringify({
                    command: `/bin/echo ${PAD} TURN-${p.calls}`,
                  }),
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

async function drive(eviction) {
  const work = workspace("evict");
  const provider = echoProvider();
  const events = [];
  let error = null;
  try {
    await runAgentLoop({
      cfg: cfg(work, eviction),
      provider,
      workingDir: work,
      userMessage: "echo repeatedly",
      onEvent: (e) => events.push(e),
    });
  } catch (e) {
    error = e;
  }
  const tools = Array.isArray(provider.seen)
    ? provider.seen.filter((m) => m.role === "tool").map((m) => String(m.content || ""))
    : [];
  return {
    error,
    tools,
    evictions: events.filter((e) => e.type === "cache" && e.phase === "eviction"),
    pressures: events.filter((e) => e.type === "cache" && e.phase === "pressure"),
  };
}

describe("loop sheds old tool results when the context budget is exceeded", () => {
  it("evicts the oldest results and keeps the newest", async () => {
    const r = await drive({ maxChars: 4000, toolMaxChars: 300, protectRecent: 2 });

    assert.equal(r.error, null, `the run must complete (got: ${r.error?.message})`);
    assert.equal(r.tools.length, TURNS, "every turn must still have a tool message");

    // Emitted only inside the mutated branch.
    assert.ok(
      r.evictions.length > 0,
      "the loop must report eviction; pressure alone is measured above the " +
        "branch and fires either way"
    );
    const acted = r.evictions.some(
      (e) => (e.truncated || 0) + (e.stubbed || 0) + (e.dropped || 0) > 0
    );
    assert.ok(acted, "the eviction report must record real actions, not an empty pass");

    // Behaviour, not just reporting: the model's view of the old turns shrank.
    assert.ok(
      r.tools[0].length < FULL_LEN,
      `the oldest result must be shed (got ${r.tools[0].length} of ${FULL_LEN} chars)`
    );
    assert.ok(
      r.tools[0].includes(STUB) || r.tools[0].includes("[truncated"),
      `the oldest result must carry an eviction marker (got: ${r.tools[0].slice(0, 60)})`
    );
    // Selective, not blanket — the most recent turns are protected.
    assert.equal(
      r.tools[TURNS - 1].length,
      FULL_LEN,
      "the newest result must survive intact"
    );
    assert.match(r.tools[TURNS - 1], /TURN-4/, "the newest result must be the newest turn's");
  });

  it("keeps the whole transcript when eviction is disabled", async () => {
    // Same commands, same budget; only tokens.eviction.enabled changes.
    const r = await drive({ enabled: false, maxChars: 4000, toolMaxChars: 300, protectRecent: 2 });

    assert.equal(r.error, null, `the run must complete (got: ${r.error?.message})`);
    assert.equal(r.tools.length, TURNS, "every turn must still have a tool message");
    assert.equal(r.evictions.length, 0, "a disabled evictor must not report eviction");
    assert.ok(
      r.pressures.length > 0,
      "pressure is still measured with eviction off — which is why the test " +
        "above cannot assert on it"
    );
    for (const [i, t] of r.tools.entries()) {
      assert.equal(
        t.length,
        FULL_LEN,
        `result ${i + 1} must be untouched (got ${t.length} of ${FULL_LEN} chars)`
      );
      assert.ok(!t.includes(STUB), `result ${i + 1} must not be stubbed`);
    }
  });
});

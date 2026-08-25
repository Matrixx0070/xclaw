/**
 * Two refusals that the loop COMPUTES correctly and was never proven to OBEY:
 * the cost-governor pre-check (before the computer session) and the quota
 * hard-block circuit (before tool dispatch).
 *
 * Fifth instalment of the mutation sweep behind loop-toctou-enforcement (v3.180.0),
 * loop-allowtools-enforcement (v3.180.1), loop-stage-enforcement and
 * loop-guard-enforcement (v3.180.2). Both blocks below were mutated to a no-op
 * on 2026-08-25 and the full suite stayed green at 3024 tests:
 *
 *     AB: if (false && !budget.ok) { ... }        // loop.mjs cost pre-check
 *     X:  if (false && circ && circ.ok === false) // loop.mjs quota circuit
 *
 * AB survived because a SECOND gate absorbs it: evaluateTurnPreflight calls the
 * same checkLoopCostBudget once per turn, so a capped run is still stopped and
 * the provider is still never reached. What the mutation destroys is *where*
 * the refusal happens. The pre-check exists to refuse "before computer/session"
 * — with it deleted the run first calls ensureComputer() and createSession(),
 * spending the resource the cap exists to protect. So the discriminating
 * assertions here are that the loop THROWS and that no `computer/session` event
 * was emitted; asserting only "the run was blocked" would pass under both.
 *
 * The two existing wire tests for this area (quota-hard-circuit-wire,
 * loop-cost-auth-wire) assert on the text of files under patches/. Those files
 * are inputs to a past migration, not the shipped code: the guards could be
 * deleted from src/agent/loop.mjs and both would still pass.
 *
 * Both directions, as ever. A gate that refuses everything satisfies the
 * negative half alone, so each mirror runs the SAME provider under the SAME
 * config with only the guarded field changed — the cap, the seat's paused flag,
 * the circuit's tripped flag — and requires the run to complete.
 *
 * Hermetic: temp HOME/state, a per-case configDir so the cost ledger of one
 * case cannot decide another, injected fake provider, no network.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-budget-enf-"));
const saved = {};

let runAgentLoop;

before(async () => {
  for (const k of ["HOME", "XCLAW_STATE_DIR", "XCLAW_MAX_HARD_BLOCKS_PER_JOB"]) {
    saved[k] = process.env[k];
  }
  process.env.HOME = tmpHome;
  process.env.XCLAW_STATE_DIR = tmpHome;
  delete process.env.XCLAW_MAX_HARD_BLOCKS_PER_JOB;
  ({ runAgentLoop } = await import("../src/agent/loop.mjs"));
});

after(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

/** Fresh config dir per case: the cost ledger lives in it. */
function configDir(label) {
  return fs.mkdtempSync(path.join(tmpHome, `${label}-cfg-`));
}

function workspace(label) {
  return fs.realpathSync(fs.mkdtempSync(path.join(tmpHome, `${label}-`)));
}

/** Seed today's governor ledger with a known spend. */
function seedSpend(dir, spentUsd) {
  fs.writeFileSync(
    path.join(dir, "cost-governor.json"),
    JSON.stringify({
      day: new Date().toISOString().slice(0, 10),
      spentUsd,
      jobs: 1,
      paused: false,
      events: [],
    })
  );
}

function cfg({ dir, cost = {}, seats, security = {}, quota } = {}) {
  return {
    agent: { maxTurns: 3, persistTranscript: false },
    tokens: { enabled: false, ledger: false },
    skills: { enabled: false },
    memory: { enabled: false },
    computer: { autoStart: false },
    hooks: { log: false },
    security: { autoApprove: true, criticalOverride: "legacy", ...security },
    paths: { configDir: dir },
    cost,
    ...(seats ? { seats } : {}),
    ...(quota ? { quota } : {}),
  };
}

/** Counting text-only provider — the count is the proof no model was billed. */
function countingProvider() {
  const p = {
    calls: 0,
    providerName: "fake",
    model: "grok-4",
    modelRef: "grok-4",
    baseUrl: "http://127.0.0.1:1",
    async chat() {
      p.calls += 1;
      return {
        message: { role: "assistant", content: "done" },
        finishReason: "stop",
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
    },
  };
  return p;
}

/** One bash call on turn 1, then a text finish. */
function bashThenText(args) {
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
                function: { name: "xclaw_bash", arguments: JSON.stringify(args) },
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

/** Drive one run, capturing events whether it resolves or rejects. */
async function drive(conf, provider, extra = {}) {
  const events = [];
  let error = null;
  try {
    await runAgentLoop({
      cfg: conf,
      provider,
      workingDir: extra.workingDir,
      userMessage: "run it",
      onEvent: (e) => events.push(e),
      ...extra,
    });
  } catch (e) {
    error = e;
  }
  return {
    error,
    events,
    // The pre-check's whole purpose: refuse BEFORE the computer session.
    session: events.some((e) => e.type === "computer" && e.phase === "session"),
    blocked: events.some((e) => e.type === "cost" && e.phase === "blocked"),
    denials: events.filter((e) => e.type === "security").map((e) => e.phase),
    started: events.some((e) => e.type === "tool" && e.phase === "start"),
  };
}

describe("loop enforces the daily cost hard cap before it spends anything", () => {
  it("refuses a run over the cap, before the computer session and before the model", async () => {
    const dir = configDir("cap-over");
    seedSpend(dir, 4);
    const provider = countingProvider();

    const r = await drive(cfg({ dir, cost: { dailyHardUsd: 1 } }), provider);

    assert.ok(r.error, "an over-cap run must reject, not return a result");
    assert.equal(r.error.budgetBlock, true, `refusal must be typed (got: ${r.error?.message})`);
    assert.equal(r.error.code, "BUDGET_EXCEEDED");
    assert.ok(r.blocked, "the block must be reported on the event stream");
    // Enforcement, not reporting: the per-turn pre-flight would also stop this
    // run, but only after paying for a computer session.
    assert.equal(r.session, false, "a capped run must not open a computer session");
    assert.equal(provider.calls, 0, "a capped run must never reach the model");
  });

  it("runs the same spend under a cap that allows it", async () => {
    const dir = configDir("cap-under");
    seedSpend(dir, 4);
    const provider = countingProvider();

    // Identical ledger, identical everything — only the ceiling moves.
    const r = await drive(
      cfg({ dir, cost: { dailyHardUsd: 100, dailySoftUsd: 100 } }),
      provider
    );

    assert.equal(r.error, null, `an under-cap run must complete (got: ${r.error?.message})`);
    assert.equal(r.blocked, false, "nothing may be reported as blocked");
    assert.ok(r.session, "the run must have reached the computer session");
    assert.ok(
      provider.calls >= 1,
      "the model must actually have been called — otherwise the test above is " +
        "satisfied by a gate that refuses every run"
    );
  });
});

describe("loop enforces the seat gate before it spends anything", () => {
  // Regression: the pre-check threw budget.message and its own catch re-threw
  // only on the substrings "hard cap"/"Hard daily". "Seat <label> is paused"
  // contains neither, so this refusal was swallowed here and the run went on to
  // open a computer session before the per-turn pre-flight stopped it.
  it("refuses a paused seat before the computer session", async () => {
    const dir = configDir("seat-paused");
    const provider = countingProvider();

    const r = await drive(
      cfg({
        dir,
        cost: { dailyHardUsd: 100, dailySoftUsd: 100 },
        seats: { enabled: true, byPeer: { default: { label: "s1", paused: true } } },
      }),
      provider
    );

    assert.ok(r.error, "a paused seat must reject the run");
    assert.equal(r.error.budgetBlock, true, `refusal must be typed (got: ${r.error?.message})`);
    assert.equal(r.error.code, "SEAT_BUDGET_EXCEEDED");
    assert.equal(r.session, false, "a paused seat must not open a computer session");
    assert.equal(provider.calls, 0, "a paused seat must never reach the model");
  });

  it("runs the same seat when it is not paused", async () => {
    const dir = configDir("seat-live");
    const provider = countingProvider();

    const r = await drive(
      cfg({
        dir,
        cost: { dailyHardUsd: 100, dailySoftUsd: 100 },
        seats: { enabled: true, byPeer: { default: { label: "s1", paused: false } } },
      }),
      provider
    );

    assert.equal(r.error, null, `a live seat must complete (got: ${r.error?.message})`);
    assert.ok(r.session, "the run must have reached the computer session");
    assert.ok(provider.calls >= 1, "a live seat must reach the model");
  });
});

describe("loop enforces the quota hard-block circuit", () => {
  // The circuit is fed from `options.job || options.receiptCollector`. These
  // cases use the receiptCollector source deliberately: a tripped circuit on
  // `job` is ALSO seen by the cost governor at the turn pre-flight, which
  // aborts the run (`cost/governor_blocked`, reason quota_hard_circuit) before
  // any tool is dispatched — so a job-sourced test would pass with the dispatch
  // guard deleted, which is the exact failure this file exists to prevent. The
  // governor does not read receiptCollector, so here the dispatch guard is the
  // only thing that can stop the call.
  it("refuses tool dispatch once the circuit is tripped", async () => {
    const work = workspace("circ-open");
    const dir = configDir("circ-open");
    const marker = path.join(work, "ran");

    const r = await drive(
      cfg({ dir, cost: { dailyHardUsd: 100, dailySoftUsd: 100 } }),
      bashThenText({ command: `/usr/bin/touch ${marker}` }),
      {
        workingDir: work,
        receiptCollector: { quotaHardCircuit: { tripped: true, hardBlocks: 3, limit: 3 } },
      }
    );

    assert.ok(
      r.denials.includes("quota_hard_circuit"),
      `a tripped circuit must be reported (saw: ${r.denials.join(",")})`
    );
    assert.equal(r.started, false, "a circuit-refused call must never reach dispatch");
    assert.ok(!fs.existsSync(marker), "the refused command must not have executed");
  });

  it("runs the same command when the circuit is not tripped", async () => {
    const work = workspace("circ-shut");
    const dir = configDir("circ-shut");
    const marker = path.join(work, "ran");

    const r = await drive(
      cfg({ dir, cost: { dailyHardUsd: 100, dailySoftUsd: 100 } }),
      bashThenText({ command: `/usr/bin/touch ${marker}` }),
      { workingDir: work, receiptCollector: {} }
    );

    assert.ok(
      !r.denials.includes("quota_hard_circuit"),
      `an untripped circuit must not refuse (saw: ${r.denials.join(",")})`
    );
    assert.ok(
      fs.existsSync(marker),
      "the permitted command must actually have run — otherwise the test above " +
        "is satisfied by a circuit that refuses everything"
    );
  });
});

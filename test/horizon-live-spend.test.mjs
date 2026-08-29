import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * The live soak's dollar cap was compared against a counter nobody
 * incremented: `policy.usedUsd` was assigned once from the checkpoint and
 * every later reader saw that same frozen value. Five goals x maxUsd each,
 * with no aggregate, so a $2 soak could spend $10 and report ok.
 */
describe("live soak spend accounting", () => {
  it("reads a turn's cost from where the agent actually reports it", async () => {
    const { turnCostUsd } = await import("../src/eval/live-spend.mjs");
    // runAgent returns `usage: raw.usage`; loop.mjs returns `usage: usageSnap`,
    // whose costUsd is a number only when hasCost. Reading `result.costUsd`
    // (the obvious guess) yields undefined on every real run.
    assert.deepEqual(
      turnCostUsd({ usage: { hasCost: true, costUsd: 1.25 } }),
      { usd: 1.25, known: true }
    );
  });

  it("treats an un-costed turn as unknown, never as free", async () => {
    const { turnCostUsd } = await import("../src/eval/live-spend.mjs");
    // The tracker returns null wholesale when disabled, and costUsd null when
    // the provider reported no cost. Both must read as "unknown" — counting
    // them as $0 is how a cap becomes unenforceable without saying so.
    for (const r of [
      { usage: null },
      { usage: { hasCost: false, costUsd: null } },
      {},
      // hasCost is the authority, not the presence of a number. A usable
      // costUsd next to hasCost:false is the tracker saying "this figure is
      // not a price" — dropping the flag and reading the field anyway is how
      // a stale or placeholder number gets spent against a real budget.
      { usage: { hasCost: false, costUsd: 5 } },
      { usage: { costUsd: 5 } },
    ]) {
      assert.deepEqual(turnCostUsd(r), { usd: 0, known: false }, JSON.stringify(r));
    }
  });

  it("accumulates across turns and counts what it could not price", async () => {
    const { accumulateSpend } = await import("../src/eval/live-spend.mjs");
    let s = accumulateSpend(undefined, { usage: { hasCost: true, costUsd: 2 } });
    s = accumulateSpend(s, { usage: { hasCost: true, costUsd: 3 } });
    s = accumulateSpend(s, { usage: null });
    assert.equal(s.usedUsd, 5);
    assert.equal(s.unpricedTurns, 1);
  });

  it("stops a multi-goal soak once the aggregate cap is passed", async () => {
    process.env.XAI_API_KEY = process.env.XAI_API_KEY || "test-key-not-real";
    const { runHorizonLive } = await import(
      "../src/eval/horizon-live.mjs?spend=" + Date.now()
    );
    let calls = 0;
    const r = await runHorizonLive({
      requireLive: true,
      maxUsd: 1.5,
      maxTurns: 100,
      runAgent: async () => {
        calls++;
        return { ok: true, usage: { hasCost: true, costUsd: 1 } };
      },
    });
    // $1/goal against a $1.50 cap: goal 1 and 2 run, the cap is passed at $2,
    // and nothing further is dispatched. Before the fix all five ran.
    assert.equal(calls, 2, `dispatched ${calls} goals against a $1.50 cap`);
    assert.equal(r.ok, false);
    assert.equal(r.code, "SOAK_USD_EXCEEDED");
    assert.equal(r.policy.usedUsd, 2);
  });

  it("a soak whose turns cannot be priced says so instead of reporting $0", async () => {
    process.env.XAI_API_KEY = process.env.XAI_API_KEY || "test-key-not-real";
    const { runHorizonLive } = await import(
      "../src/eval/horizon-live.mjs?unpriced=" + Date.now()
    );
    const r = await runHorizonLive({
      requireLive: true,
      maxUsd: 1.5,
      maxTurns: 100,
      runAgent: async () => ({ ok: true }),
    });
    // Every goal runs — an unpriced turn is not evidence of overspend — but the
    // report must not let "$0 of $1.50" stand as a measured fact.
    assert.equal(r.unpricedTurns, 5, JSON.stringify(r.unpricedTurns));
  });

  it("delivers the soak's caps through the one field the agent request keeps", async () => {
    process.env.XAI_API_KEY = process.env.XAI_API_KEY || "test-key-not-real";
    const { runHorizonLive } = await import(
      "../src/eval/horizon-live.mjs?transit=" + Date.now()
    );
    // normalizeAgentRequest passes a fixed allow-list; maxUsd and maxTurns are
    // not on it, so passing them as top-level options delivered neither. cfg is
    // on it, and is where the loop and the run governor read both.
    const seen = [];
    await runHorizonLive({
      requireLive: true,
      maxUsd: 4,
      maxTurns: 7,
      // Synthetic ids: no case file, so no per-case maxTurns to override with.
      ids: ["spend-t1", "spend-t2"],
      goals: { "spend-t1": "first goal", "spend-t2": "second goal" },
      cfg: { agent: { budget: { maxUsd: 9 } } },
      runAgent: async (req) => {
        seen.push({
          maxTurns: req.cfg?.agent?.maxTurns,
          budget: req.cfg?.agent?.budget?.maxUsd,
        });
        return { ok: true, usage: { hasCost: true, costUsd: 1 } };
      },
    });
    assert.equal(seen.length, 2);
    assert.equal(seen[0].maxTurns, 7, JSON.stringify(seen[0]));
    // First goal: $4 of soak headroom vs a $9 configured budget -> the tighter
    // of the two. A soak remainder may tighten an operator's budget, never
    // loosen it. After $1 spent, the headroom tightens again.
    assert.equal(seen[0].budget, 4, JSON.stringify(seen[0]));
    assert.equal(seen[1].budget, 3, JSON.stringify(seen[1]));
  });

  it("honours a case's own turn cap over the soak-wide fallback", async () => {
    process.env.XAI_API_KEY = process.env.XAI_API_KEY || "test-key-not-real";
    const { runHorizonLive } = await import(
      "../src/eval/horizon-live.mjs?case=" + Date.now()
    );
    // policy.maxTurns is the soak's iteration ceiling and only stands in when a
    // case declares nothing; a4-G12 declares 6 and must get 6.
    const seen = [];
    await runHorizonLive({
      requireLive: true,
      maxUsd: 50,
      maxTurns: 40,
      ids: ["a4-G12-budget-near-limit", "no-such-case-id"],
      goals: { "no-such-case-id": "fallback goal" },
      runAgent: async (req) => {
        seen.push(req.cfg?.agent?.maxTurns);
        return { ok: true, usage: { hasCost: true, costUsd: 0 } };
      },
    });
    assert.deepEqual(seen, [6, 40]);
  });

  it("stops a soak once it has run more goals than the ceiling allows", async () => {
    process.env.XAI_API_KEY = process.env.XAI_API_KEY || "test-key-not-real";
    const { runHorizonLive } = await import(
      "../src/eval/horizon-live.mjs?turns=" + Date.now()
    );
    let calls = 0;
    const r = await runHorizonLive({
      requireLive: true,
      maxUsd: 1000,
      maxTurns: 3,
      runAgent: async () => {
        calls += 1;
        return { ok: true, usage: { hasCost: true, costUsd: 0 } };
      },
    });
    // Five default goals, a ceiling of three: the fourth is the first whose
    // running count exceeds it. Before the counter was wired, all five ran.
    assert.equal(calls, 4);
    assert.equal(r.mode, "soak_blocked");
    assert.equal(r.code, "SOAK_TURNS_EXCEEDED");
    assert.equal(r.ok, false);
  });

  it("never loosens a configured budget that is tighter than the soak headroom", async () => {
    const { budgetForTurn } = await import("../src/eval/live-spend.mjs");
    assert.equal(budgetForTurn(0.5, 100), 0.5);
    assert.equal(budgetForTurn(100, 0.5), 0.5);
    assert.equal(budgetForTurn(undefined, 2), 2);
    assert.equal(budgetForTurn(2, undefined), 2);
    assert.equal(budgetForTurn(undefined, undefined), null);
    // Exhaustion is a bound of ZERO, not an absent bound. These used to return
    // the configured ceiling (or null), and the caller spreads null as no
    // `maxUsd` key at all — so the moment the soak ran out of money, the run
    // governor stopped having anything to compare against.
    assert.equal(budgetForTurn(2, -5), 0);
    assert.equal(budgetForTurn(2, 0), 0);
    assert.equal(budgetForTurn(undefined, 0), 0);
  });

  it("stops the soak when the budget is spent to the exact penny", async () => {
    process.env.XAI_API_KEY = process.env.XAI_API_KEY || "test-key-not-real";
    const { runHorizonLive } = await import(
      "../src/eval/horizon-live.mjs?exact=" + Date.now()
    );
    // Two goals at $1 against a $2 cap lands on exactly zero headroom.
    // checkSoakCaps blocks on strict `>`, so $2 > $2 is false and the third
    // goal used to start — with a null per-turn budget, i.e. no cap at all.
    let calls = 0;
    const r = await runHorizonLive({
      requireLive: true,
      maxUsd: 2,
      maxTurns: 100,
      runAgent: async () => {
        calls += 1;
        return { ok: true, usage: { hasCost: true, costUsd: 1 } };
      },
    });
    assert.equal(calls, 2);
    assert.equal(r.mode, "soak_blocked");
    assert.equal(r.code, "SOAK_USD_EXCEEDED");
    assert.equal(r.ok, false);
  });

  it("advances the checkpoint per goal, so a crash mid-soak is not free", async () => {
    process.env.XAI_API_KEY = process.env.XAI_API_KEY || "test-key-not-real";
    const os = await import("node:os");
    const path = await import("node:path");
    const fsp = await import("node:fs/promises");
    const { loadSoakCheckpoint } = await import(
      "../src/eval/horizon-soak-checkpoint.mjs"
    );
    const { runHorizonLive } = await import(
      "../src/eval/horizon-live.mjs?crash=" + Date.now()
    );
    const base = await fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-soak-crash-"));
    let calls = 0;
    const r = await runHorizonLive({
      requireLive: true,
      maxUsd: 100,
      maxTurns: 100,
      soakJobId: "spend-crash",
      soakBase: base,
      runAgent: async () => {
        calls += 1;
        if (calls > 2) throw new Error("provider exploded");
        return { ok: true, usage: { hasCost: true, costUsd: 0.5 } };
      },
    });
    assert.equal(r.mode, "live_error");
    // The end-of-loop save never runs on this path, so the per-goal checkpoint
    // is the only record. It was fed `...opts` — the values the run STARTED
    // from — so it re-wrote $0 after every goal and the resumed soak spent the
    // same budget again.
    const cp = await loadSoakCheckpoint("spend-crash", { base });
    assert.equal(cp.usedUsd, 1);
    assert.equal(cp.turns, 2);
    await fsp.rm(base, { recursive: true, force: true });
  });

  it("persists the spend it actually accumulated, not the frozen opening balance", async () => {
    process.env.XAI_API_KEY = process.env.XAI_API_KEY || "test-key-not-real";
    const { runHorizonLive } = await import(
      "../src/eval/horizon-live.mjs?persist=" + Date.now()
    );
    const r = await runHorizonLive({
      requireLive: true,
      maxUsd: 100,
      maxTurns: 100,
      runAgent: async () => ({ ok: true, usage: { hasCost: true, costUsd: 0.5 } }),
    });
    // Five goals at $0.50. The checkpoint and report used to write the opening
    // balance, so a resumed soak restarted from $0 every time.
    assert.equal(r.usedUsd, 2.5);
    assert.equal(r.policy.usedUsd, 2.5);
    assert.equal(r.unpricedTurns, 0);
    // The written report is the operator-facing artefact; it carried the
    // opening balance too, so a $2.50 soak filed itself as $0.00.
    assert.equal(r.liveReport.usedUsd, 2.5);
    assert.equal(r.liveReport.unpricedTurns, 0);
  });

  it("starts a resumed soak from the spend it already carried", async () => {
    process.env.XAI_API_KEY = process.env.XAI_API_KEY || "test-key-not-real";
    const { runHorizonLive } = await import(
      "../src/eval/horizon-live.mjs?resume=" + Date.now()
    );
    // $1.40 already spent against a $1.50 cap. One more goal fits; the second
    // must not. Opening the accumulator at $0 instead of the carried balance
    // buys a resumed soak a whole extra goal every time it restarts.
    let calls = 0;
    const r = await runHorizonLive({
      requireLive: true,
      maxUsd: 1.5,
      maxTurns: 100,
      usedUsd: 1.4,
      runAgent: async () => {
        calls += 1;
        return { ok: true, usage: { hasCost: true, costUsd: 1 } };
      },
    });
    assert.equal(calls, 1);
    assert.equal(r.usedUsd, 2.4);
    assert.equal(r.mode, "soak_blocked");
    assert.equal(r.code, "SOAK_USD_EXCEEDED");
    // WHICH guard stopped it is operator-facing, and the two are not
    // interchangeable: the cap is the aggregate ceiling being exceeded, the
    // exhaustion guard is headroom hitting zero. Feeding the cap the frozen
    // opening balance instead of the accumulator leaves the run stopping for
    // the wrong stated reason at the wrong goal.
    assert.match(r.reason, /usedUsd 2\.4 > maxUsd 1\.5/);
  });

  it("counts a soak the caps stopped as a block", async () => {
    process.env.XAI_API_KEY = process.env.XAI_API_KEY || "test-key-not-real";
    const { getSoakBlockTotal } = await import(
      "../src/eval/horizon-soak-metrics.mjs"
    );
    const { runHorizonLive } = await import(
      "../src/eval/horizon-live.mjs?blockmetric=" + Date.now()
    );
    // The pre-loop block increments this; the in-loop one has to as well, or a
    // soak that overspends and stops looks identical to one that finished.
    const before = getSoakBlockTotal();
    const r = await runHorizonLive({
      requireLive: true,
      maxUsd: 1.5,
      maxTurns: 100,
      runAgent: async () => ({ ok: true, usage: { hasCost: true, costUsd: 1 } }),
    });
    assert.equal(r.mode, "soak_blocked");
    assert.equal(getSoakBlockTotal(), before + 1);
  });

  it("checkpoints the spend a resumed soak must start from", async () => {
    process.env.XAI_API_KEY = process.env.XAI_API_KEY || "test-key-not-real";
    const os = await import("node:os");
    const path = await import("node:path");
    const fsp = await import("node:fs/promises");
    const { loadSoakCheckpoint } = await import(
      "../src/eval/horizon-soak-checkpoint.mjs"
    );
    const { runHorizonLive } = await import(
      "../src/eval/horizon-live.mjs?ckpt=" + Date.now()
    );
    const base = await fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-soak-spend-"));
    const r = await runHorizonLive({
      requireLive: true,
      maxUsd: 100,
      maxTurns: 100,
      soakJobId: "spend-ckpt",
      soakBase: base,
      runAgent: async () => ({ ok: true, usage: { hasCost: true, costUsd: 0.5 } }),
    });
    assert.equal(r.mode, "live");
    // The checkpoint is the ONLY thing a resumed soak reads. Writing the
    // opening balance here is what let a soak restart from $0 forever.
    const cp = await loadSoakCheckpoint("spend-ckpt", { base });
    assert.equal(cp.usedUsd, 2.5);
    assert.equal(cp.turns, 5);
    await fsp.rm(base, { recursive: true, force: true });
  });

  it("treats a cost that is not a finite number as unpriced, not as zero", async () => {
    const { turnCostUsd, accumulateSpend } = await import(
      "../src/eval/live-spend.mjs"
    );
    for (const costUsd of [NaN, Infinity, -Infinity, "abc", null, undefined]) {
      assert.deepEqual(
        turnCostUsd({ usage: { hasCost: true, costUsd } }),
        { usd: 0, known: false },
        String(costUsd)
      );
    }
    // hasCost true with an unusable number is the dangerous shape: it claims a
    // measurement exists. It must still land in the honesty channel.
    assert.deepEqual(
      accumulateSpend(
        { usedUsd: 1, unpricedTurns: 0 },
        { usage: { hasCost: true, costUsd: Infinity } }
      ),
      { usedUsd: 1, unpricedTurns: 1 }
    );
    assert.deepEqual(accumulateSpend({}, { usage: { hasCost: false } }), {
      usedUsd: 0,
      unpricedTurns: 1,
    });
  });

});

describe("live report fields from a finished run", () => {
  it("takes the runner's own numbers, not the opening balance", async () => {
    const { liveReportFromRun } = await import(
      "../src/eval/horizon-live-report.mjs"
    );
    // The CLI's second write to the same path used to file policy.turns — the
    // count this run STARTED from, 0 on a fresh run — over the truthful report
    // the runner had just written, and hardcode a clean canary over a real one.
    const out = liveReportFromRun(
      {
        ok: true,
        mode: "live",
        usedUsd: 2.5,
        unpricedTurns: 3,
        policy: { usedUsd: 0, turns: 0 },
        liveReport: { turns: 5, canary: { fail: 2 } },
      },
      { ids: ["a", "b"], soakJobId: "job-1" }
    );
    assert.equal(out.turns, 5);
    assert.equal(out.usedUsd, 2.5);
    assert.equal(out.unpricedTurns, 3);
    assert.deepEqual(out.canary, { fail: 2 });
    assert.equal(out.soakJobId, "job-1");
    assert.deepEqual(out.ids, ["a", "b"]);
  });

  it("falls back to the checkpoint policy when the runner wrote nothing", async () => {
    const { liveReportFromRun } = await import(
      "../src/eval/horizon-live-report.mjs"
    );
    // soak_blocked, lease_denied and live_error all return before the runner
    // writes a report, so on those paths this write is the only record there
    // will be — the policy is the fallback, never the preference.
    const out = liveReportFromRun(
      { ok: false, mode: "soak_blocked", policy: { usedUsd: 1.4, turns: 7 } },
      { soakJobId: null }
    );
    assert.equal(out.ok, false);
    assert.equal(out.mode, "soak_blocked");
    assert.equal(out.usedUsd, 1.4);
    assert.equal(out.turns, 7);
    assert.equal(out.unpricedTurns, 0);
    assert.deepEqual(out.canary, { fail: 0 });
  });
});

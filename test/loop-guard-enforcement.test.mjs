/**
 * The three pre-dispatch guards — sandbox, egress, receipt — must actually STOP
 * a call, not merely compute a verdict.
 *
 * Fourth instalment of the mutation sweep that produced
 * loop-toctou-enforcement.test.mjs (v3.180.0),
 * loop-allowtools-enforcement.test.mjs (v3.180.1) and
 * loop-stage-enforcement.test.mjs. Each of the three blocks below was mutated
 * to a no-op on 2026-08-25 and the full suite stayed green:
 *
 *     const sand = { ok: true };   // was guardToolPaths(cfg, workingDir, name, args)
 *     const eg   = { ok: true };   // was guardToolEgress(cfg, name, args)
 *     const riskR = { ok: true };  // was guardHighRiskReceipt(name, ..., cfg)
 *
 *     P: # tests 3016  # pass 3016  # fail 0
 *     Q: # tests 3016  # pass 3016  # fail 0
 *     R: # tests 3016  # pass 3016  # fail 0
 *
 * The guard modules themselves have unit tests. Those tests call the guard
 * directly, so they prove the verdict is COMPUTED correctly and say nothing
 * about whether the loop obeys it — which is the whole of the security
 * property. Delete the three `if (!ok) return;` blocks and every one of those
 * unit tests still passes while workspace containment, the egress screen and
 * the receipt requirement are silently off in the product.
 *
 * Each guard is asserted in both directions. A guard that denies everything
 * would satisfy the negative test alone, so each mirror runs the SAME tool
 * under the SAME config with only the guarded field changed, and requires the
 * side effect to land. Neither half of a pair can be satisfied by a constant.
 *
 * Approvals are OFF in every case on purpose (`autoApprove: true,
 * criticalOverride: "legacy"`). An outside-workspace path is critical-tier
 * since v3.126.0; if the run pended, the approval gate would be what stopped
 * the call and these tests would pass with the guards deleted.
 *
 * Hermetic: temp HOME/state, injected fake provider, no network. The execs are
 * real `/usr/bin/touch` runs inside the temp tree — the observable proof is
 * whether the file exists. The one network command targets the `.invalid` TLD,
 * which by RFC 6761 never resolves, so even a fully disabled egress guard
 * cannot reach a real host.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-guard-enf-"));
const saved = {};

let runAgentLoop;

before(async () => {
  for (const k of ["HOME", "XCLAW_STATE_DIR", "XCLAW_EGRESS", "XCLAW_PROFILE"]) {
    saved[k] = process.env[k];
  }
  process.env.HOME = tmpHome;
  process.env.XCLAW_STATE_DIR = tmpHome;
  // The egress mode is read from the env FIRST; a developer shell that exports
  // either of these would decide the outcome instead of the cfg under test.
  delete process.env.XCLAW_EGRESS;
  delete process.env.XCLAW_PROFILE;
  ({ runAgentLoop } = await import("../src/agent/loop.mjs"));
});

after(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

/** Fake provider: one bash call on turn 1, then a text finish. */
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

function cfg({ agent = {}, security = {} } = {}) {
  return {
    agent: { maxTurns: 3, persistTranscript: false, ...agent },
    tokens: { enabled: false, ledger: false },
    skills: { enabled: false },
    memory: { enabled: false },
    computer: { autoStart: false },
    hooks: { log: false },
    security: { autoApprove: true, criticalOverride: "legacy", ...security },
  };
}

/** Drive one turn and collect the events. */
async function run(conf, args, extra = {}) {
  const events = [];
  await runAgentLoop({
    cfg: conf,
    provider: bashThenText(args),
    workingDir: extra.workingDir,
    userMessage: "run it",
    onEvent: (e) => events.push(e),
    ...extra,
  });
  return {
    events,
    denials: events.filter((e) => e.type === "security").map((e) => e.phase),
    started: events.some((e) => e.type === "tool" && e.phase === "start"),
    phases: events
      .filter((e) => e.type === "tool" || e.type === "security")
      .map((e) => `${e.type}:${e.phase}`)
      .join(","),
  };
}

function workspace(label) {
  return fs.realpathSync(fs.mkdtempSync(path.join(tmpHome, `${label}-`)));
}

describe("loop enforces the workspace sandbox", () => {
  it("denies a cwd outside the workspace, and nothing runs there", async () => {
    const work = workspace("sbx-in");
    const outside = fs.realpathSync(
      fs.mkdtempSync(path.join(tmpHome, "sbx-out-"))
    );
    const escaped = path.join(outside, "escaped");

    // `cwd` is a STRICT_PATH_ARG_KEY. Pointing it at a sibling of the
    // workspace is the containment breach the sandbox exists to refuse.
    const r = await run(cfg(), { command: "/usr/bin/touch escaped", cwd: outside }, {
      workingDir: work,
    });

    assert.ok(
      r.denials.includes("sandbox_denied"),
      `the escape must be refused (saw: ${r.phases})`
    );
    // The security property. Everything above is reporting; this is enforcement.
    assert.ok(!r.started, "a sandbox-denied call must never reach dispatch");
    assert.ok(!fs.existsSync(escaped), "nothing may be written outside the workspace");
  });

  it("runs the same command when the cwd is inside the workspace", async () => {
    const work = workspace("sbx-ok");
    const inside = path.join(work, "landed");

    const r = await run(cfg(), { command: "/usr/bin/touch landed", cwd: work }, {
      workingDir: work,
    });

    assert.ok(
      !r.denials.includes("sandbox_denied"),
      `an in-workspace path must not be refused (saw: ${r.phases})`
    );
    assert.ok(
      fs.existsSync(inside),
      "the permitted command must actually have run — otherwise the test " +
        "above is satisfied by a sandbox that denies everything"
    );
  });
});

describe("loop enforces the egress policy", () => {
  it("denies a network-capable command under mode=deny", async () => {
    const work = workspace("eg-no");
    const marker = path.join(work, "curled");

    // `.invalid` never resolves (RFC 6761), so this cannot reach a host even
    // with the guard removed; the marker is what proves the shell never ran.
    const r = await run(
      cfg({ security: { egress: { mode: "deny" } } }),
      { command: `/usr/bin/curl -sS https://nowhere.invalid && /usr/bin/touch ${marker}` },
      { workingDir: work }
    );

    assert.ok(
      r.denials.includes("egress_denied"),
      `a network command must be refused under mode=deny (saw: ${r.phases})`
    );
    assert.ok(!r.started, "an egress-denied call must never reach dispatch");
    assert.ok(!fs.existsSync(marker), "the blocked shell must not have executed");
  });

  it("runs a non-network command under the same mode=deny policy", async () => {
    const work = workspace("eg-ok");
    const marker = path.join(work, "local");

    const r = await run(
      cfg({ security: { egress: { mode: "deny" } } }),
      { command: `/usr/bin/touch ${marker}` },
      { workingDir: work }
    );

    assert.ok(
      !r.denials.includes("egress_denied"),
      `mode=deny screens network commands, not every command (saw: ${r.phases})`
    );
    assert.ok(
      fs.existsSync(marker),
      "a local command must still run — otherwise the test above is satisfied " +
        "by an egress guard that denies everything"
    );
  });
});

describe("loop carries the frozen plan into the spawn args", () => {
  // The fourth no-op mutation from the same sweep:
  //
  //     if (false && auth.plan && isExecTool(name)) {   // loop.mjs
  //
  //     S: # tests 3016  # pass 3016  # fail 0
  //
  // The router cannot compensate: it backfills `args.systemRunPlan` from
  // `req.plan`, and the loop passes `plan: args.systemRunPlan || null` — the
  // very field this block sets. With the block off, the plan the gate froze
  // never leaves the loop, and the bundle's spawn-time argv/cwd check has
  // nothing to compare against. Enforcement is silently gone while every
  // approval, every plan build and every TOCTOU revalidation still runs.
  //
  // The spawn-side rejection lives in the bundle and is not reachable from a
  // unit test. What IS observable is the payload actually handed to dispatch:
  // the `tool start` event carries the exact args object the router receives.

  it("hands dispatch the plan bound to this exact call", async () => {
    const work = workspace("plan-on");
    const marker = path.join(work, "planned");

    const r = await run(cfg(), { command: `/usr/bin/touch ${marker}` }, {
      workingDir: work,
    });

    const start = r.events.find((e) => e.type === "tool" && e.phase === "start");
    assert.ok(start, `the call must reach dispatch (saw: ${r.phases})`);

    const plan = start.args?.systemRunPlan;
    assert.ok(plan, "the frozen plan must travel with the args, not stay in the gate");
    // Bound to THIS call: argv and cwd are chosen by the test at runtime, so no
    // fabricated or constant plan can satisfy these.
    assert.deepEqual(plan.argv, ["/usr/bin/touch", marker]);
    assert.equal(plan.cwd, work);
    assert.equal(plan.isExec, true);
    assert.ok(plan.fingerprint, "the plan must be fingerprinted for revalidation");
  });

  it("attaches no plan when plan binding is switched off", async () => {
    // The mirror. Unconditionally stamping something onto every exec call would
    // satisfy the test above; here the gate issues no plan and the args must
    // say so rather than carry a placeholder the spawn side would try to check.
    const work = workspace("plan-off");
    const marker = path.join(work, "unplanned");

    const r = await run(
      cfg({ security: { bindSystemRunPlan: false } }),
      { command: `/usr/bin/touch ${marker}` },
      { workingDir: work }
    );

    const start = r.events.find((e) => e.type === "tool" && e.phase === "start");
    assert.ok(start, `the call must still run (saw: ${r.phases})`);
    assert.equal(
      start.args?.systemRunPlan,
      undefined,
      "no plan was frozen, so none may be attached"
    );
    assert.ok(fs.existsSync(marker), "binding off must not block the call");
  });
});

describe("loop enforces the high-risk receipt requirement", () => {
  const receiptCfg = cfg({ agent: { requireReceiptForHighRisk: true } });

  it("blocks a high-risk tool when no evidence has been collected", async () => {
    const work = workspace("rc-no");
    const marker = path.join(work, "unreceipted");

    const r = await run(receiptCfg, { command: `/usr/bin/touch ${marker}` }, {
      workingDir: work,
    });

    assert.ok(
      r.denials.includes("receipt_required"),
      `xclaw_bash is high-risk and must be held (saw: ${r.phases})`
    );
    assert.ok(!r.started, "an unreceipted high-risk call must never reach dispatch");
    assert.ok(!fs.existsSync(marker), "the blocked command must not have executed");
  });

  it("runs the same tool once evidence is present", async () => {
    const work = workspace("rc-ok");
    const marker = path.join(work, "receipted");

    const r = await run(receiptCfg, { command: `/usr/bin/touch ${marker}` }, {
      workingDir: work,
      evidence: [{ kind: "unit-test", ref: "loop-guard-enforcement" }],
    });

    assert.ok(
      !r.denials.includes("receipt_required"),
      `evidence must satisfy the requirement (saw: ${r.phases})`
    );
    assert.ok(
      fs.existsSync(marker),
      "the receipted command must actually have run — otherwise the test " +
        "above is satisfied by a guard that blocks every high-risk tool"
    );
  });
});

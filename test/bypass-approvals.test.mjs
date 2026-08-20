import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createApprovalGate } from "../src/security/approvals.mjs";
import { validateConfig } from "../src/config/validate.mjs";

const CRITICAL = { command: "npm publish", cwd: "/tmp" };

describe("security.bypassApprovals", () => {
  it("is off unless asked for — critical still pends by default", async () => {
    const gate = createApprovalGate({ security: { bindSystemRunPlan: false } });
    const r = await gate.authorize("xclaw_bash", CRITICAL, { timeoutMs: 200 });
    assert.equal(r.ok, false, "a critical action must still ask by default");
  });

  it("runs everything without asking when enabled", async () => {
    // the operator equivalent of Claude Code's bypassPermissions
    const gate = createApprovalGate({
      security: { bypassApprovals: true, bindSystemRunPlan: false },
    });
    const r = await gate.authorize("xclaw_bash", CRITICAL, { timeoutMs: 200 });
    assert.equal(r.ok, true);
    assert.equal(r.mode, "auto");
  });

  it("covers every tier, not just the listed tools", async () => {
    const gate = createApprovalGate({
      security: { bypassApprovals: true, bindSystemRunPlan: false },
    });
    for (const [tool, args] of [
      ["xclaw_bash", { command: "rm -rf /etc", cwd: "/tmp" }],
      ["xclaw_file_write", { file_path: "/etc/passwd", content: "x" }],
      ["xclaw_bash", { command: "git push --force origin main", cwd: "/tmp" }],
    ]) {
      const r = await gate.authorize(tool, args, { timeoutMs: 200 });
      assert.equal(r.ok, true, `${tool} ${JSON.stringify(args)}`);
    }
  });

  it("only a literal true enables it", async () => {
    for (const v of ["true", 1, "yes", null, undefined]) {
      const gate = createApprovalGate({
        security: { bypassApprovals: v, bindSystemRunPlan: false },
      });
      const r = await gate.authorize("xclaw_bash", CRITICAL, { timeoutMs: 200 });
      assert.equal(r.ok, false, `bypassApprovals=${JSON.stringify(v)} must not enable it`);
    }
  });

  it("ignoreBypass overlay drops bypass for this call only", async () => {
    const gate = createApprovalGate({
      security: { bypassApprovals: true, bindSystemRunPlan: false },
    });
    const tightened = await gate.authorize("xclaw_bash", CRITICAL, {
      timeoutMs: 200,
      ignoreBypass: true,
    });
    assert.equal(tightened.ok, false, "auto overlay must still ask on critical");
    const honour = await gate.authorize("xclaw_bash", CRITICAL, { timeoutMs: 200 });
    assert.equal(honour.ok, true, "the next call without the overlay is bypass again");
  });

  it("forceHuman overlay asks even when bypass is on", async () => {
    const gate = createApprovalGate({
      security: { bypassApprovals: true, bindSystemRunPlan: false },
    });
    const r = await gate.authorize("xclaw_bash", CRITICAL, {
      timeoutMs: 200,
      forceHuman: true,
    });
    assert.equal(r.ok, false);
  });

  it("a machine running this way says so at startup", () => {
    const out = validateConfig({ security: { bypassApprovals: true } });
    assert.ok(
      out.warnings.some((w) => /FULL AUTONOMY/.test(w)),
      JSON.stringify(out.warnings)
    );
    const quiet = validateConfig({ security: {} });
    assert.ok(!quiet.warnings.some((w) => /FULL AUTONOMY/.test(w)));
  });
});

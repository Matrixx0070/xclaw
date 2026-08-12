import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApprovalGate } from "../src/security/approvals.mjs";
import { EXEC_TOOLS } from "../src/security/system-run-plan.mjs";

const slaCfg = (dir) => ({
  security: {
    approvalPolicy: "risky",
    requireApproval: ["bash", "xclaw_bash"],
    approvalSlaMs: 60,
    approvalSlaAction: "approve",
    approvalSlaTickMs: 15,
    approvalTimeoutMs: 2000,
    planRoot: dir,
  },
});

describe("SLA auto-approve revalidates the plan (brief 1.2)", () => {
  it("stable environment → sla_auto approval", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-sla-ok-"));
    try {
      const gate = createApprovalGate(slaCfg(dir));
      const r = await gate.authorize("bash", { command: "echo hi", cwd: dir });
      assert.equal(r.ok, true);
      assert.equal(r.mode, "sla_auto");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("cwd swapped for a symlink before the SLA fires → denied with plan_drift", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-sla-drift-"));
    const cwdA = path.join(base, "a");
    const cwdB = path.join(base, "b");
    fs.mkdirSync(cwdA);
    fs.mkdirSync(cwdB);
    try {
      const gate = createApprovalGate(slaCfg(base));
      const p = gate.authorize("bash", { command: "echo hi", cwd: cwdA });
      // TOCTOU: while the request sits pending, cwd A becomes a symlink to B
      setTimeout(() => {
        try {
          fs.rmdirSync(cwdA);
          fs.symlinkSync(cwdB, cwdA);
        } catch {
          /* if this races past the SLA the assertion below still catches it */
        }
      }, 10);
      const r = await p;
      assert.equal(r.ok, false);
      assert.equal(r.reason, "plan_drift");
      assert.ok(r.drift?.cwd, `expected cwd drift, got ${JSON.stringify(r)}`);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("EXEC_TOOLS single source", () => {
  it("approvals defaults derive from system-run-plan's set", async () => {
    const gate = createApprovalGate({
      security: { approvalPolicy: "risky", approvalTimeoutMs: 50, approvalSlaMs: 50 },
    });
    // every EXEC_TOOLS member requires approval by default → times out (deny)
    for (const tool of EXEC_TOOLS) {
      const r = await gate.authorize(tool, { command: "id" }, { timeoutMs: 60 });
      assert.equal(r.ok, false, `${tool} should be approval-gated by default`);
    }
  });
});

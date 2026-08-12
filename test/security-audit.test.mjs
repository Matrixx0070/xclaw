
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runSecurityAudit } from "../src/security/audit.mjs";
import { buildApprovalDigest } from "../src/security/approval-digest.mjs";
import { createApprovalGate, resetSharedApprovalGate } from "../src/security/approvals.mjs";

describe("security audit", () => {
  it("ok on localhost defaults", () => {
    const a = runSecurityAudit({
      gateway: { host: "127.0.0.1" },
      security: { autoApprove: false },
      sandbox: { enabled: true },
      agent: { apiKey: "x" },
    });
    assert.equal(a.errors, 0);
    assert.equal(a.ok, true);
    assert.ok(
      a.findings.some(
        (f) => f.id === "security.systemRunPlan" && f.level === "ok"
      )
    );
  });
  it("warns when bindSystemRunPlan explicitly off", () => {
    const a = runSecurityAudit({
      gateway: { host: "127.0.0.1" },
      security: { autoApprove: false, bindSystemRunPlan: false },
      agent: { apiKey: "x" },
    });
    assert.ok(
      a.findings.some(
        (f) => f.id === "security.systemRunPlan" && f.level === "warn"
      )
    );
  });
  it("errors on remote computer without token", () => {
    const a = runSecurityAudit({
      gateway: { host: "127.0.0.1" },
      computer: { remoteUrl: "http://10.0.0.2:4243" },
      agent: { apiKey: "x" },
    });
    assert.ok(a.findings.some((f) => f.id === "computer.remoteAuth" && f.level === "error"));
    assert.equal(a.ok, false);
  });
  it("warns public bind without token", () => {
    const a = runSecurityAudit({
      gateway: { host: "0.0.0.0" },
      agent: { apiKey: "x" },
    });
    assert.ok(a.findings.some((f) => f.id === "gateway.bind" && f.level === "warn"));
    assert.ok(a.findings.some((f) => f.id === "gateway.token"));
  });
});

describe("approval digest + plan fingerprint", () => {
  it("includes plan fingerprint in digest lines when present", async () => {
    const shared = resetSharedApprovalGate({
      security: {
        autoApprove: false,
        approvalPolicy: "risky",
        requireApproval: ["bash"],
        bindSystemRunPlan: true,
        approvalSlaMs: 60_000,
      },
    });
    const p = shared.authorize("bash", { command: "echo digest-plan" }, { timeoutMs: 5_000 });
    await new Promise((r) => setTimeout(r, 20));
    const digest = buildApprovalDigest({
      security: { approvalSlaMs: 60_000 },
    });
    assert.ok(digest.pending >= 1);
    assert.ok(/plan=[0-9a-f]{12}/.test(digest.text), digest.text);
    const list = shared.listPending();
    if (list[0]) shared.decide(list[0].id, false, "cleanup");
    await p.catch(() => {});
  });
});

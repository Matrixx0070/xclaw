
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runSecurityAudit } from "../src/security/audit.mjs";

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

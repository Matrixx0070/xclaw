import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checkShellEgress,
  guardToolEgress,
  getEgressPolicy,
} from "../src/security/egress.mjs";

describe("egress policy", () => {
  it("lab default allows curl", () => {
    const r = checkShellEgress({ profile: "lab" }, "curl https://example.com");
    assert.equal(r.ok, true);
  });

  it("prod default denies curl", () => {
    const r = checkShellEgress({ profile: "prod" }, "curl https://example.com");
    assert.equal(r.ok, false);
    assert.match(r.error, /egress denied/);
  });

  it("allowlist permits listed host only", () => {
    const cfg = {
      profile: "prod",
      security: { egress: { mode: "allowlist", allowHosts: ["api.x.ai"] } },
    };
    assert.equal(
      checkShellEgress(cfg, "curl https://api.x.ai/v1/models").ok,
      true
    );
    assert.equal(
      checkShellEgress(cfg, "curl https://evil.example/x").ok,
      false
    );
  });

  it("local bash without network is always ok in deny mode", () => {
    const r = checkShellEgress({ profile: "prod" }, "echo hello && ls /tmp");
    assert.equal(r.ok, true);
  });

  it("guardToolEgress only applies to bash-like tools", () => {
    const cfg = { profile: "prod" };
    assert.equal(guardToolEgress(cfg, "xclaw_file_read", { path: "/a" }).ok, true);
    assert.equal(
      guardToolEgress(cfg, "xclaw_bash", { command: "wget http://x" }).ok,
      false
    );
  });

  it("XCLAW_EGRESS env overrides profile", () => {
    const prev = process.env.XCLAW_EGRESS;
    process.env.XCLAW_EGRESS = "deny";
    try {
      assert.equal(getEgressPolicy({ profile: "lab" }).mode, "deny");
    } finally {
      if (prev == null) delete process.env.XCLAW_EGRESS;
      else process.env.XCLAW_EGRESS = prev;
    }
  });
});

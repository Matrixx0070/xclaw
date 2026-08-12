import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PROFILES, applyProfile } from "../src/config/profiles.mjs";

describe("P2 prod profile honesty", () => {
  it("prod pack sets autoApprove false and requireAuth", () => {
    const p = PROFILES.prod;
    assert.equal(p.security.autoApprove, false);
    assert.equal(p.gateway.requireAuth, true);
    assert.equal(p.security.egress?.mode, "deny");
    assert.equal(p.security.osSandbox, "auto");
    assert.equal(p.security.spawnEnforce, "check");
    assert.equal(p.swarm?.autoMerge, false);
  });

  it("applyProfile merges prod onto base", () => {
    const cfg = applyProfile({ profile: "prod" });
    assert.equal(cfg.security?.autoApprove, false);
    assert.equal(cfg.gateway?.requireAuth, true);
    assert.equal(cfg.security?.egress?.mode, "deny");
  });

  it("lab still auto-approves", () => {
    assert.equal(PROFILES.lab.security.autoApprove, true);
  });
});

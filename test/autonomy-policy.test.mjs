
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveAutonomyLevel,
  applyAutonomyLevel,
  autonomyPolicySummary,
  autonomyOverlay,
} from "../src/config/autonomy-policy.mjs";
import { enforceProdHardening } from "../src/config/load.mjs";

describe("autonomy-policy", () => {
  it("resolves explicit level", () => {
    delete process.env.XCLAW_AUTONOMY_LEVEL;
    assert.equal(resolveAutonomyLevel({ autonomy: { level: "full" } }), "full");
    assert.equal(resolveAutonomyLevel({ autonomy: { level: "off" } }), "off");
  });

  it("env wins over config level", () => {
    process.env.XCLAW_AUTONOMY_LEVEL = "supervised";
    assert.equal(resolveAutonomyLevel({ autonomy: { level: "full" } }), "supervised");
    delete process.env.XCLAW_AUTONOMY_LEVEL;
  });

  it("infers supervised from prod profile", () => {
    delete process.env.XCLAW_AUTONOMY_LEVEL;
    assert.equal(resolveAutonomyLevel({ profile: "prod" }), "supervised");
  });

  it("off disables autoApprove and heartbeat", () => {
    delete process.env.XCLAW_AUTONOMY_LEVEL;
    const cfg = applyAutonomyLevel({ autonomy: { level: "off" } });
    assert.equal(cfg.security.autoApprove, false);
    assert.equal(cfg.autonomy.heartbeat.enabled, false);
  });

  it("full enables heartbeat by default", () => {
    delete process.env.XCLAW_AUTONOMY_LEVEL;
    const cfg = applyAutonomyLevel({ autonomy: { level: "full" } });
    assert.equal(cfg.security.autoApprove, true);
    assert.equal(cfg.autonomy.heartbeat.enabled, true);
  });

  it("does not clobber explicit autoApprove", () => {
    delete process.env.XCLAW_AUTONOMY_LEVEL;
    const cfg = applyAutonomyLevel({
      autonomy: { level: "full" },
      security: { autoApprove: false },
    });
    assert.equal(cfg.security.autoApprove, false);
  });

  it("summary exposes level", () => {
    delete process.env.XCLAW_AUTONOMY_LEVEL;
    const s = autonomyPolicySummary({ autonomy: { level: "lab" } });
    assert.equal(s.level, "lab");
    assert.equal(s.autoApprove, true);
  });

  it("overlay keys stable", () => {
    for (const level of ["off", "supervised", "lab", "full"]) {
      const o = autonomyOverlay(level);
      assert.ok(o.security);
      assert.ok(o.autonomy.level === level);
    }
  });
});

describe("enforceProdHardening", () => {
  it("forces autoApprove off on prod", () => {
    delete process.env.XCLAW_AUTONOMY_LEVEL;
    delete process.env.XCLAW_ALLOW_PROD_AUTO;
    const cfg = enforceProdHardening({
      profile: "prod",
      security: { autoApprove: true, approvalPolicy: "never" },
      autonomy: { level: "full" },
      swarm: { autoMerge: true },
    });
    assert.equal(cfg.security.autoApprove, false);
    assert.equal(cfg.security.approvalPolicy, "risky");
    assert.equal(cfg.autonomy.level, "supervised");
    assert.equal(cfg.swarm.autoMerge, false);
  });

  it("does not touch lab", () => {
    const cfg = enforceProdHardening({
      profile: "lab",
      security: { autoApprove: true },
    });
    assert.equal(cfg.security.autoApprove, true);
  });
});

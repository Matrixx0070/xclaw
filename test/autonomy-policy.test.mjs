import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveAutonomyLevel,
  applyAutonomyLevel,
  autonomyPolicySummary,
  autonomyOverlay,
} from "../src/config/autonomy-policy.mjs";

describe("autonomy-policy", () => {
  it("resolves explicit level", () => {
    assert.equal(resolveAutonomyLevel({ autonomy: { level: "full" } }), "full");
    assert.equal(resolveAutonomyLevel({ autonomy: { level: "off" } }), "off");
  });

  it("infers supervised from prod profile", () => {
    assert.equal(resolveAutonomyLevel({ profile: "prod" }), "supervised");
  });

  it("off disables autoApprove and heartbeat", () => {
    const cfg = applyAutonomyLevel({ autonomy: { level: "off" } });
    assert.equal(cfg.security.autoApprove, false);
    assert.equal(cfg.autonomy.heartbeat.enabled, false);
  });

  it("full enables heartbeat by default", () => {
    const cfg = applyAutonomyLevel({ autonomy: { level: "full" } });
    assert.equal(cfg.security.autoApprove, true);
    assert.equal(cfg.autonomy.heartbeat.enabled, true);
  });

  it("does not clobber explicit autoApprove", () => {
    const cfg = applyAutonomyLevel({
      autonomy: { level: "full" },
      security: { autoApprove: false },
    });
    assert.equal(cfg.security.autoApprove, false);
  });

  it("summary exposes level", () => {
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

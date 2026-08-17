
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { enforceProdHardening } from "../src/config/load.mjs";

describe("enforceProdHardening", () => {
  it("forces autoApprove off on prod", () => {
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
    assert.ok(cfg._prodHardening.length >= 2);
  });

  it("does not touch lab", () => {
    const cfg = enforceProdHardening({
      profile: "lab",
      security: { autoApprove: true },
    });
    assert.equal(cfg.security.autoApprove, true);
  });
});

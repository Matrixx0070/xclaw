import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyProfile, listProfiles, PROFILES } from "../src/config/profiles.mjs";

describe("profiles", () => {
  it("lists three profiles", () => {
    const list = listProfiles();
    assert.equal(list.length, 3);
    assert.ok(PROFILES.dev && PROFILES.lab && PROFILES.prod);
  });
  it("lab enables autoApprove", () => {
    const cfg = applyProfile({
      profile: "lab",
      security: { autoApprove: false },
      agent: { maxTurns: 5 },
      gateway: { host: "127.0.0.1" },
    });
    assert.equal(cfg.security.autoApprove, true);
    assert.equal(cfg.agent.maxTurns, 20);
  });
  it("prod disables eval cron", () => {
    const cfg = applyProfile({
      profile: "prod",
      eval: { cron: { enabled: true, everyMs: 1 } },
      security: {},
      agent: {},
      gateway: {},
    });
    assert.equal(cfg.eval.cron.enabled, false);
  });
});

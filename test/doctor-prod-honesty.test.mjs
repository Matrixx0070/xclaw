
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  prodHonestyChecks,
  profileMismatchChecks,
} from "../src/cli/doctor-prod-honesty.mjs";

describe("prod honesty", () => {
  it("skips when profile is not prod", () => {
    const c = prodHonestyChecks({ profile: "lab" });
    assert.equal(c.length, 1);
    assert.equal(c[0].status, "ok");
    assert.match(c[0].message, /skipped/);
  });

  it("errors on prod + autoApprove without token", () => {
    const prev = process.env.XCLAW_GATEWAY_TOKEN;
    delete process.env.XCLAW_GATEWAY_TOKEN;
    delete process.env.GATEWAY_TOKEN;
    try {
      const c = prodHonestyChecks({
        profile: "prod",
        security: { autoApprove: true, egress: { mode: "deny" } },
        gateway: {},
        swarm: { autoMerge: false },
      });
      const byId = Object.fromEntries(c.map((x) => [x.id, x]));
      assert.equal(byId["security.prod.token"].status, "error");
      assert.equal(byId["security.prod.autoApprove"].status, "error");
      assert.equal(byId["security.prod.egress"].status, "ok");
    } finally {
      if (prev !== undefined) process.env.XCLAW_GATEWAY_TOKEN = prev;
    }
  });

  it("errors on prod autoMerge and open requireAuth", () => {
    const c = prodHonestyChecks({
      profile: "prod",
      security: { autoApprove: false },
      gateway: { token: "secret", requireAuth: false },
      swarm: { autoMerge: true },
    });
    const byId = Object.fromEntries(c.map((x) => [x.id, x]));
    assert.equal(byId["security.prod.swarmAutoMerge"].status, "error");
    assert.equal(byId["security.prod.requireAuth"].status, "error");
    assert.equal(byId["security.prod.token"].status, "ok");
    assert.equal(byId["security.prod.autoApprove"].status, "ok");
  });

  it("profile mismatch: prod+autoApprove is error", () => {
    const c = profileMismatchChecks({
      profile: "prod",
      security: { autoApprove: true },
    });
    assert.equal(c[0].id, "profile.mismatch");
    assert.equal(c[0].status, "error");
  });

  it("profile mismatch: lab+autoApprove false is warn", () => {
    const c = profileMismatchChecks({
      profile: "lab",
      security: { autoApprove: false },
    });
    assert.equal(c[0].status, "warn");
  });

  it("aligned lab profile is ok", () => {
    const c = profileMismatchChecks({
      profile: "lab",
      security: { autoApprove: true, approvalPolicy: "never" },
    });
    assert.equal(c[0].status, "ok");
  });
});

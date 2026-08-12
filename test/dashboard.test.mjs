
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDashboard } from "../src/gateway/dashboard.mjs";

describe("dashboard", () => {
  it("builds snapshot without throwing", async () => {
    const d = await buildDashboard({
      profile: "dev",
      computer: { host: "127.0.0.1", port: 4243 },
      gateway: { host: "127.0.0.1", port: 18790 },
      agent: { model: "grok-4.3", maxTurns: 15 },
      security: { autoApprove: false },
      paths: { configDir: "/tmp/xclaw-dash-test-missing" },
    });
    assert.equal(d.profile, "dev");
    assert.ok(d.computer);
    assert.ok(d.agent);
  });
});

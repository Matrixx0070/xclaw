
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildStatusReport } from "../src/gateway/report.mjs";

describe("status report", () => {
  it("returns markdown", async () => {
    const rep = await buildStatusReport({
      profile: "dev",
      computer: { host: "127.0.0.1", port: 4243 },
      gateway: { host: "127.0.0.1", port: 18790 },
      agent: { model: "grok-4.3", provider: "xai", maxTurns: 15 },
      security: { autoApprove: false },
      paths: { configDir: "/tmp/xclaw-report-missing" },
    });
    assert.ok(rep.markdown.includes("# XClaw status report"));
    assert.ok(rep.markdown.includes("Queue"));
  });
});

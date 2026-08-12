
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderMetrics } from "../src/gateway/metrics.mjs";

describe("metrics", () => {
  it("renders prometheus text", async () => {
    const text = await renderMetrics({
      profile: "dev",
      computer: { host: "127.0.0.1", port: 4243 },
      paths: { configDir: "/tmp/xclaw-metrics-missing" },
      queue: { concurrency: 1 },
    });
    assert.ok(text.includes("xclaw_info"));
    assert.ok(text.includes("xclaw_computer_up"));
  });
});

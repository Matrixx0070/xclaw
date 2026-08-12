import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeSLOs } from "../src/ops/slo.mjs";

describe("slo", () => {
  it("computes without throw", async () => {
    const s = await computeSLOs({
      paths: { configDir: "/tmp/xclaw-slo-missing" },
      computer: { host: "127.0.0.1", port: 1 },
      slo: { computerUp: false },
    });
    assert.ok(s.at);
    assert.ok(Array.isArray(s.breaches));
  });
});

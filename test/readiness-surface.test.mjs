import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stopAuthReadiness } from "../src/gateway/stop-health.mjs";

describe("ready/health surfaceVersion", () => {
  it("stop readiness exposes surfaceVersion", () => {
    const r = stopAuthReadiness({ profile: "lab" });
    assert.ok(r.surfaceVersion);
  });
});

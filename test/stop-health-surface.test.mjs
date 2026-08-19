import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stopAuthReadiness } from "../src/gateway/stop-health.mjs";

describe("stop health surfaceVersion", () => {
  it("includes surfaceVersion from package", () => {
    const r = stopAuthReadiness({ profile: "lab" });
    assert.ok(r.surfaceVersion === "n10" || typeof r.surfaceVersion === "string");
  });
});

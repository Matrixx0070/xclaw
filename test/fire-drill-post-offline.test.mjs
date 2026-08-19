import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fireDrillPostOffline, runStopFireDrill } from "../src/eval/stop-fire-drill.mjs";

describe("fire-drill post_offline", () => {
  it("returns GATEWAY_OFFLINE", async () => {
    const r = await fireDrillPostOffline();
    assert.equal(r.name, "post_offline");
    assert.equal(r.ok, true);
  });
  it("includes post_offline in full drill", async () => {
    const r = await runStopFireDrill();
    const names = (r.steps || []).map((s) => s.name);
    assert.ok(names.includes("post_offline"), names.join(","));
  });
});

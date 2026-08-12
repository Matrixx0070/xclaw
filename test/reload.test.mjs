
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { softReloadConfig } from "../src/config/reload.mjs";

describe("softReloadConfig", () => {
  it("mutates live cfg without throwing", async () => {
    const live = {
      profile: "dev",
      agent: { model: "x", maxTurns: 5 },
      security: { autoApprove: false },
      paths: {},
    };
    const r = await softReloadConfig(live);
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.changed));
    assert.ok(live.agent);
  });
});

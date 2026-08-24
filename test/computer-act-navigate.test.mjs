import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runComputerAct } from "../src/computer/modules/computer-act-tool.mjs";
import { lookupCuaError } from "../src/computer/cua-errors.mjs";

describe("computer_act navigate", () => {
  it("unreachable CDP endpoint fails closed (not unknown action)", async () => {
    process.env.XCLAW_CDP_URL = "http://127.0.0.1:59991";
    process.env.XCLAW_CUA_RETRIES = "0";
    try {
      const r = await runComputerAct({ action: "navigate", url: "https://example.com" });
      assert.equal(r.ok, false);
      assert.equal(r.code, "CDP_ATTACH_FAILED");
    } finally {
      delete process.env.XCLAW_CDP_URL;
      delete process.env.XCLAW_CUA_RETRIES;
    }
  });

  it("catalog has CUA_ACT_NEED_URL", () => {
    const e = lookupCuaError("CUA_ACT_NEED_URL");
    assert.ok(e);
    assert.match(e.recovery, /url/i);
  });

  it("with CDP missing url returns NEED_URL or attach fail", async () => {
    process.env.XCLAW_CDP_URL = "http://127.0.0.1:59991";
    process.env.XCLAW_CUA_RETRIES = "0";
    const r = await runComputerAct({ action: "navigate" });
    assert.equal(r.ok, false);
    assert.ok(
      ["CUA_ACT_NEED_URL", "CDP_ATTACH_FAILED"].includes(r.code),
      r.code
    );
  });
});

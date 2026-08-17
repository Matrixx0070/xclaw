import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runComputerAct } from "../src/computer/modules/computer-act-tool.mjs";

describe("computer_act stub (I2)", () => {
  it("fails closed on native", async () => {
    delete process.env.XCLAW_COMPUTER_ENGINE;
    delete process.env.XCLAW_CDP_URL;
    const r = await runComputerAct({ action: "click", x: 10, y: 10 });
    assert.equal(r.ok, false);
    assert.equal(r.code, "CUA_ACT_REQUIRES_BUNDLE");
  });
  it("redirects observe to browser_tab", async () => {
    const r = await runComputerAct({ action: "observe" });
    assert.equal(r.code, "USE_BROWSER_OBSERVE");
  });
});

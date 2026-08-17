import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runComputerAct } from "../src/computer/modules/computer-act-tool.mjs";

describe("computer_act (I2b)", () => {
  it("fails closed on native without CDP", async () => {
    delete process.env.XCLAW_COMPUTER_ENGINE;
    delete process.env.XCLAW_CDP_URL;
    delete process.env.CDP_URL;
    const r = await runComputerAct({ action: "click", x: 10, y: 10 });
    assert.equal(r.ok, false);
    assert.equal(r.code, "CUA_ACT_REQUIRES_BUNDLE");
  });

  it("redirects observe to browser_tab", async () => {
    const r = await runComputerAct({ action: "observe" });
    assert.equal(r.code, "USE_BROWSER_OBSERVE");
  });

  it("bundle without CDP is NOT_EXTRACTED", async () => {
    process.env.XCLAW_COMPUTER_ENGINE = "bundle";
    delete process.env.XCLAW_CDP_URL;
    delete process.env.CDP_URL;
    const r = await runComputerAct({ action: "click", x: 1, y: 1 });
    assert.equal(r.ok, false);
    assert.equal(r.code, "CUA_ACT_NOT_EXTRACTED");
    delete process.env.XCLAW_COMPUTER_ENGINE;
  });

  it("CDP URL set but unreachable → CDP_ATTACH_FAILED", async () => {
    process.env.XCLAW_CDP_URL = "http://127.0.0.1:59999";
    const r = await runComputerAct({ action: "click", x: 5, y: 5 });
    assert.equal(r.ok, false);
    assert.equal(r.code, "CDP_ATTACH_FAILED");
    delete process.env.XCLAW_CDP_URL;
  });
});

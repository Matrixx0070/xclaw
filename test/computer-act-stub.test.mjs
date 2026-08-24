import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runComputerAct } from "../src/computer/modules/computer-act-tool.mjs";

describe("computer_act (single native engine)", () => {
  it("redirects observe to browser_tab", async () => {
    const r = await runComputerAct({ action: "observe" });
    assert.equal(r.code, "USE_BROWSER_OBSERVE");
  });

  it("navigate without url fails typed before any browser work", async () => {
    const r = await runComputerAct({ action: "navigate" });
    assert.equal(r.ok, false);
    assert.equal(r.code, "CUA_ACT_NEED_URL");
  });

  it("CDP URL set but unreachable → CDP_ATTACH_FAILED (external endpoint wins, no spawn)", async () => {
    process.env.XCLAW_CDP_URL = "http://127.0.0.1:59999";
    try {
      const r = await runComputerAct({ action: "click", x: 5, y: 5 });
      assert.equal(r.ok, false);
      assert.equal(r.code, "CDP_ATTACH_FAILED");
    } finally {
      delete process.env.XCLAW_CDP_URL;
    }
  });
});

import { cacheObserveResult, getCachedObserve } from "../src/computer/modules/computer-act-tool.mjs";

describe("observe ref cache (I4)", () => {
  it("stores and retrieves elements by tabId", () => {
    cacheObserveResult("tab_1", {
      url: "https://example.com",
      elements: [{ ref: "e1", role: "link", name: "Docs" }],
    });
    const c = getCachedObserve("tab_1");
    assert.equal(c.elements[0].ref, "e1");
    assert.equal(c.elements[0].name, "Docs");
  });
});

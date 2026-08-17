import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { enrichCuaError, lookupCuaError, CUA_ERROR_CATALOG } from "../src/computer/cua-errors.mjs";
import { runComputerAct } from "../src/computer/modules/computer-act-tool.mjs";
import { runDesktopAct } from "../src/computer/modules/desktop-driver.mjs";

describe("CUA error handling", () => {
  it("catalog has core codes", () => {
    assert.ok(CUA_ERROR_CATALOG.CUA_ACT_REQUIRES_BUNDLE);
    assert.ok(CUA_ERROR_CATALOG.DESKTOP_GUI_DISABLED);
    assert.ok(CUA_ERROR_CATALOG.AX_TCC_REQUIRED);
  });

  it("enrichCuaError adds recovery", () => {
    const r = enrichCuaError({ ok: false, code: "DESKTOP_GUI_DISABLED", error: "off" });
    assert.match(r.recovery, /XCLAW_DESKTOP_GUI/);
    assert.equal(r.severity, "warn");
  });

  it("computer_act fail includes recovery", async () => {
    delete process.env.XCLAW_CDP_URL;
    delete process.env.CDP_URL;
    const r = await runComputerAct({ action: "click", x: 1, y: 1 });
    assert.equal(r.ok, false);
    assert.equal(r.code, "CUA_ACT_REQUIRES_BUNDLE");
    assert.ok(r.recovery || r.hint);
  });

  it("desktop act disabled includes recovery", async () => {
    const r = await runDesktopAct({ action: "click", x: 1, y: 1 }, {});
    assert.equal(r.code, "DESKTOP_GUI_DISABLED");
    assert.ok(r.recovery || r.hint);
  });

  it("lookup unknown is null", () => {
    assert.equal(lookupCuaError("NOT_A_REAL_CODE"), null);
  });
});

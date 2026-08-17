import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  probeDesktopDriver,
  runDesktopAct,
} from "../src/computer/modules/desktop-driver.mjs";
import { runComputerAct } from "../src/computer/modules/computer-act-tool.mjs";

describe("desktop driver (I5)", () => {
  it("probe defaults disabled", () => {
    const p = probeDesktopDriver({});
    assert.equal(p.enabled, false);
  });

  it("runDesktopAct fails closed without opt-in", async () => {
    const r = await runDesktopAct({ action: "click", x: 1, y: 1 }, {});
    assert.equal(r.ok, false);
    assert.equal(r.code, "DESKTOP_GUI_DISABLED");
  });

  it("computer_act surface=desktop routes to driver", async () => {
    delete process.env.XCLAW_DESKTOP_GUI;
    const r = await runComputerAct({ surface: "desktop", action: "click", x: 1, y: 1 });
    assert.equal(r.ok, false);
    assert.equal(r.code, "DESKTOP_GUI_DISABLED");
  });

  it("opt-in without tools → NO_BACKEND or UNSUPPORTED", async () => {
    const r = await runDesktopAct(
      { action: "click", x: 1, y: 1 },
      { XCLAW_DESKTOP_GUI: "1" }
    );
    assert.equal(r.ok, false);
    assert.ok(
      ["DESKTOP_GUI_NO_BACKEND", "DESKTOP_GUI_UNSUPPORTED_OS", "DESKTOP_ACT_FAILED"].includes(
        r.code
      ),
      r.code
    );
  });
});

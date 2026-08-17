import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runDesktopObserve } from "../src/computer/modules/desktop-driver.mjs";
import { runComputerAct } from "../src/computer/modules/computer-act-tool.mjs";

describe("desktop observe AT-SPI (I5b)", () => {
  it("runDesktopObserve returns structured result or honest error", async () => {
    const r = await runDesktopObserve({ max: 10 });
    assert.equal(typeof r.ok, "boolean");
    if (r.ok) {
      assert.equal(r.mode, "atspi");
      assert.ok(Array.isArray(r.elements));
    } else {
      assert.ok(
        [
          "ATSPI_NOT_INSTALLED",
          "ATSPI_REGISTRY_FAILED",
          "ATSPI_WALK_FAILED",
          "ATSPI_EMPTY",
          "ATSPI_HELPER_MISSING",
          "ATSPI_EXEC_FAILED",
          "ATSPI_BAD_JSON",
          "DESKTOP_OBSERVE_UNSUPPORTED_OS",
        ].includes(r.code),
        r.code
      );
    }
  });

  it("computer_act surface=desktop action=observe routes", async () => {
    const r = await runComputerAct({
      surface: "desktop",
      action: "observe",
      max: 5,
    });
    assert.equal(typeof r.ok, "boolean");
  });
});

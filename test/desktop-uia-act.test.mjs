import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runDesktopAct } from "../src/computer/modules/desktop-driver.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const actScript = path.join(root, "scripts/desktop-uia-act.py");

describe("Windows UIA act (W2)", () => {
  it("helper on non-Windows returns DESKTOP_GUI_UNSUPPORTED_OS", async () => {
    let stdout;
    try {
      const r = await execFileAsync("python3", [actScript, "click", "--x", "1", "--y", "1"], {
        timeout: 10000,
      });
      stdout = r.stdout;
    } catch (e) {
      stdout = e.stdout || "";
      if (!stdout) throw e;
    }
    const j = JSON.parse(String(stdout).trim());
    if (process.platform === "win32") {
      assert.equal(typeof j.ok, "boolean");
    } else {
      assert.equal(j.ok, false);
      assert.equal(j.code, "DESKTOP_GUI_UNSUPPORTED_OS");
    }
  });

  it("runDesktopAct still fail-closed without opt-in", async () => {
    const r = await runDesktopAct({ action: "click", x: 1, y: 1 }, {});
    assert.equal(r.code, "DESKTOP_GUI_DISABLED");
  });

  it("opt-in on Linux still uses linux path codes", async () => {
    if (process.platform !== "linux") return;
    const r = await runDesktopAct(
      { action: "click", x: 1, y: 1 },
      { XCLAW_DESKTOP_GUI: "1" }
    );
    assert.equal(r.ok, false);
    assert.ok(
      ["DESKTOP_GUI_NO_BACKEND", "DESKTOP_ACT_FAILED"].includes(r.code),
      r.code
    );
  });
});

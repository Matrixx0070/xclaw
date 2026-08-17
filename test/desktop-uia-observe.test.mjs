import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runDesktopObserve } from "../src/computer/modules/desktop-driver.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const uiaScript = path.join(root, "scripts/desktop-uia-observe.py");

describe("Windows UIA observe (W1)", () => {
  it("helper on non-Windows returns DESKTOP_OBSERVE_UNSUPPORTED_OS", async () => {
    const { stdout } = await execFileAsync("python3", [uiaScript, "--max", "5"], {
      timeout: 10000,
    }).catch(async (e) => {
      if (e.stdout) return { stdout: e.stdout };
      throw e;
    });
    const j = JSON.parse(String(stdout).trim());
    if (process.platform === "win32") {
      assert.equal(typeof j.ok, "boolean");
    } else {
      assert.equal(j.ok, false);
      assert.equal(j.code, "DESKTOP_OBSERVE_UNSUPPORTED_OS");
    }
  });

  it("runDesktopObserve still works on current platform", async () => {
    const r = await runDesktopObserve({ max: 5 });
    assert.equal(typeof r.ok, "boolean");
    if (process.platform === "linux") {
      // AT-SPI path
      assert.ok(r.ok === true || String(r.code || "").includes("ATSPI") || r.code === "DESKTOP_OBSERVE_UNSUPPORTED_OS");
    } else if (process.platform === "win32") {
      assert.ok(r.ok === true || String(r.code || "").startsWith("UIA") || r.code === "DESKTOP_OBSERVE_UNSUPPORTED_OS");
    }
  });
});

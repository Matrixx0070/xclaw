import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runDesktopObserve } from "../src/computer/modules/desktop-driver.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const axScript = path.join(root, "scripts/desktop-ax-observe.py");

describe("macOS AX observe (M1)", () => {
  it("helper on non-macOS returns DESKTOP_OBSERVE_UNSUPPORTED_OS", async () => {
    let stdout;
    try {
      const r = await execFileAsync("python3", [axScript, "--max", "5"], { timeout: 10000 });
      stdout = r.stdout;
    } catch (e) {
      stdout = e.stdout || "";
      if (!stdout) throw e;
    }
    const j = JSON.parse(String(stdout).trim());
    if (process.platform === "darwin") {
      assert.equal(typeof j.ok, "boolean");
      // may be AX_TCC_REQUIRED or AX_NOT_INSTALLED or ok
    } else {
      assert.equal(j.ok, false);
      assert.equal(j.code, "DESKTOP_OBSERVE_UNSUPPORTED_OS");
    }
  });

  it("runDesktopObserve still returns structured result on this host", async () => {
    const r = await runDesktopObserve({ max: 5 });
    assert.equal(typeof r.ok, "boolean");
  });
});

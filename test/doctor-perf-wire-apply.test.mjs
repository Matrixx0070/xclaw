import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("doctor-perf-wire", () => {
  it("is registered in SHIP_PATCHES", () => {
    const src = fs.readFileSync(path.join(root, "scripts/apply-ship-patches.mjs"), "utf8");
    assert.ok(src.includes("doctor-perf-wire.patch"));
    assert.ok(src.includes("pushPerfChecks"));
  });

  it("applies onto a copy of doctor.mjs", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-dpw-"));
    const dest = path.join(tmp, "src", "cli");
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(path.join(root, "src/cli/doctor.mjs"), path.join(dest, "doctor.mjs"));
    const r = spawnSync(
      "git",
      ["apply", "--directory", tmp, path.join(root, "patches/doctor-perf-wire.patch")],
      { cwd: root, encoding: "utf8" }
    );
    const landed = fs.readFileSync(path.join(dest, "doctor.mjs"), "utf8");
    if (r.status !== 0 && !landed.includes("pushPerfChecks")) {
      assert.fail(r.stderr || r.stdout || "apply failed");
    }
    assert.ok(landed.includes("pushPerfChecks"));
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

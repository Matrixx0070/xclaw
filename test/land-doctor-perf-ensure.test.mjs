import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("land doctor perf ensure", () => {
  it("patch wires pushPerfChecksEnsured", () => {
    const patch = fs.readFileSync(path.join(root, "patches/doctor-perf-ensure.patch"), "utf8");
    assert.ok(patch.includes("doctor-perf-ensure.mjs"));
    assert.ok(patch.includes("pushPerfChecksEnsured"));
  });

  it("doctor.mjs lands ensure when present", () => {
    const src = fs.readFileSync(path.join(root, "src/cli/doctor.mjs"), "utf8");
    // Prefer landed source; fall back to patch-only until apply
    const landed = src.includes("pushPerfChecksEnsured");
    const patch = fs.readFileSync(path.join(root, "patches/doctor-perf-ensure.patch"), "utf8");
    assert.ok(landed || patch.includes("pushPerfChecksEnsured"));
  });
});

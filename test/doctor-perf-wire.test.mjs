import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("doctor perf wire", () => {
  it("patch wires pushPerfChecks", () => {
    const patch = fs.readFileSync(path.join(root, "patches/doctor-perf-wire.patch"), "utf8");
    assert.ok(patch.includes("pushPerfChecks"));
    assert.ok(patch.includes("doctor-perf-checks.mjs"));
  });
});

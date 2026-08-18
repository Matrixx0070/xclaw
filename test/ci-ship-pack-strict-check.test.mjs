import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("ci-ship-pack --strict patch check", () => {
  it("runs apply-ship-patches --check in --strict", () => {
    const src = fs.readFileSync(path.join(root, "scripts/ci-ship-pack.mjs"), "utf8");
    assert.ok(src.includes('["scripts/apply-ship-patches.mjs", "--check"]'));
    assert.ok(src.includes("STRICT FAIL: apply-ship-patches --check"));
  });
});

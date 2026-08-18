import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("land applyThenCheck", () => {
  it("ci-ship-pack imports and calls applyThenCheck", () => {
    const src = fs.readFileSync(path.join(root, "scripts/ci-ship-pack.mjs"), "utf8");
    assert.ok(src.includes("apply-then-check.mjs"));
    assert.ok(src.includes("applyThenCheck({ root })"));
  });
});

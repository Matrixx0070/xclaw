import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("release-gate land-all applied", () => {
  it("source includes land-all-check step", () => {
    const src = fs.readFileSync(path.join(root, "scripts/release-gate.mjs"), "utf8");
    assert.ok(src.includes("land-all-check"));
    assert.ok(src.includes("fsSync"));
    assert.ok(src.includes("land-all.mjs") || src.includes("land-batch5"));
  });
});

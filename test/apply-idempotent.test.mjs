import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXTRA_SHIP_PATCHES } from "../src/ci/ship-patches-extra.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("idempotent ship patches", () => {
  it("tracks inlined import landings", () => {
    const files = EXTRA_SHIP_PATCHES.map((e) => e.file);
    assert.ok(files.includes("ship-patches-extra.patch"));
    assert.ok(files.includes("ci-ship-pack-extra-tests.patch"));
    assert.ok(files.includes("ci-ship-pack-apply-then-check.patch"));
  });

  it("apply-ship-patches uses --check before apply", () => {
    const src = fs.readFileSync(path.join(root, "scripts/apply-ship-patches.mjs"), "utf8");
    assert.ok(src.includes('["apply", "--check"'));
    assert.ok(src.includes("markers; patch does not apply") || src.includes("idempotent soft"));
  });
});

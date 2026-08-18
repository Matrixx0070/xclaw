import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SHIP_PACK_EXTRA_UNIT_TESTS } from "../src/ci/ship-pack-unit-tests.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("ship-pack extra unit tests", () => {
  it("patch wires extras into ci-ship-pack", () => {
    const src = fs.readFileSync(path.join(root, "patches/ci-ship-pack-extra-tests.patch"), "utf8");
    assert.ok(src.includes("SHIP_PACK_EXTRA_UNIT_TESTS"));
    assert.ok(src.includes("...SHIP_PACK_EXTRA_UNIT_TESTS"));
  });

  it("listed extras exist", () => {
    for (const f of SHIP_PACK_EXTRA_UNIT_TESTS) {
      assert.ok(fs.existsSync(path.join(root, f)), f);
    }
  });
});

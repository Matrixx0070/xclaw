import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SHIP_PACK_EXTRA_UNIT_TESTS } from "../src/ci/ship-pack-unit-tests.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("ship-pack extra unit tests", () => {
  it("includes self in the extra list", () => {
    assert.ok(SHIP_PACK_EXTRA_UNIT_TESTS.includes("test/ship-pack-unit-tests.test.mjs"));
  });

  it("listed extras exist", () => {
    for (const f of SHIP_PACK_EXTRA_UNIT_TESTS) {
      assert.ok(fs.existsSync(path.join(root, f)), f);
    }
  });
});

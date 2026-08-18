import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("land extra imports", () => {
  it("apply-ship-patches uses extraShipEntries", () => {
    const src = fs.readFileSync(path.join(root, "scripts/apply-ship-patches.mjs"), "utf8");
    assert.ok(src.includes("extraShipEntries"));
    assert.ok(src.includes("ship-patches-extra.mjs"));
  });

  it("ci-ship-pack uses SHIP_PACK_EXTRA_UNIT_TESTS", () => {
    const src = fs.readFileSync(path.join(root, "scripts/ci-ship-pack.mjs"), "utf8");
    assert.ok(src.includes("SHIP_PACK_EXTRA_UNIT_TESTS"));
    assert.ok(src.includes("...SHIP_PACK_EXTRA_UNIT_TESTS"));
  });
});

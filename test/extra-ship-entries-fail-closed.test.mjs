import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extraShipEntries } from "../src/ci/ship-patches-extra.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("extraShipEntries fail-closed", () => {
  it("apply-ship-patches loads extras dynamically with FAIL log", () => {
    const src = fs.readFileSync(path.join(root, "scripts/apply-ship-patches.mjs"), "utf8");
    assert.ok(src.includes("loadExtraEntries"));
    assert.ok(src.includes("FAIL extraShipEntries import"));
    assert.ok(!src.includes('import { extraShipEntries } from'));
  });

  it("extraShipEntries is a function on the module", () => {
    assert.equal(typeof extraShipEntries, "function");
    const entries = extraShipEntries(() => "");
    assert.ok(Array.isArray(entries));
  });
});

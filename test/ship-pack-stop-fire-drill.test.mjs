import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("ship-pack / release-gate stop-fire-drill", () => {
  it("scripts exist and are wired", () => {
    assert.ok(fs.existsSync(path.join(root, "scripts/stop-fire-drill.mjs")));
    const shipPatch = fs.readFileSync(
      path.join(root, "patches/ship-pack-stop-fire-drill.patch"),
      "utf8"
    );
    assert.ok(shipPatch.includes("stop-fire-drill"));
    const rgPatch = fs.readFileSync(
      path.join(root, "patches/release-gate-stop-fire-drill.patch"),
      "utf8"
    );
    assert.ok(rgPatch.includes("stop-fire-drill"));
  });
});

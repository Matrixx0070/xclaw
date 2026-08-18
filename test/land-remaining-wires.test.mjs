import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("land remaining wires", () => {
  it("script exists", () => {
    assert.ok(fs.existsSync(path.join(root, "scripts/land-remaining-wires.mjs")));
  });
});

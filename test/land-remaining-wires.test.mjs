import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REMAINING_WIRES } from "../scripts/land-remaining-wires.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("land remaining wires", () => {
  it("lists five production-wire patches", () => {
    assert.equal(REMAINING_WIRES.length, 5);
  });

  it("each patch file exists", () => {
    for (const e of REMAINING_WIRES) {
      assert.ok(fs.existsSync(path.join(root, e.file)), e.file);
    }
  });
});

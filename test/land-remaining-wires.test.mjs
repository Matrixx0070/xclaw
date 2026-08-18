import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REMAINING_WIRES } from "../scripts/land-remaining-wires.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("land remaining wires", () => {
  it("includes hash-verify and require-tip", () => {
    assert.ok(REMAINING_WIRES.some((e) => e.file.includes("checkpoint-hash-verify")));
    assert.ok(REMAINING_WIRES.some((e) => e.file.includes("checkpoint-require-tip")));
  });

  it("each patch file exists", () => {
    for (const e of REMAINING_WIRES) {
      assert.ok(fs.existsSync(path.join(root, e.file)), e.file);
    }
  });
});

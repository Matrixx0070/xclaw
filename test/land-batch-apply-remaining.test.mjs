import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("land-batch-apply-remaining", () => {
  it("script and mega-patch exist", () => {
    assert.ok(fs.existsSync(path.join(root, "scripts/land-batch-apply-remaining.mjs")));
    assert.ok(fs.existsSync(path.join(root, "patches/land-batch-apply-remaining.patch")));
    const patch = fs.readFileSync(
      path.join(root, "patches/land-batch-apply-remaining.patch"),
      "utf8"
    );
    assert.ok(patch.includes("stopSignMain") || patch.includes("x-xclaw-token"));
    assert.ok(patch.includes("attachStopSummary") || patch.includes("land-kill-switch-wires"));
  });
});

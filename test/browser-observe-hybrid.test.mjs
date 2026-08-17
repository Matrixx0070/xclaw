/**
 * P0.4 — Hybrid observe: set-of-marks + bbox formatting.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatA11ySnapshot,
  STRUCTURE_SNAPSHOT_JS,
} from "../src/browser/sense.mjs";

describe("hybrid observe structure", () => {
  it("STRUCTURE_SNAPSHOT_JS includes bbox and mark fields", () => {
    assert.match(STRUCTURE_SNAPSHOT_JS, /mark/);
    assert.match(STRUCTURE_SNAPSHOT_JS, /getBoundingClientRect/);
    assert.match(STRUCTURE_SNAPSHOT_JS, /viewport/);
  });

  it("formatA11ySnapshot shows @mark and click coords", () => {
    const tree = formatA11ySnapshot(
      [
        {
          mark: 1,
          role: "button",
          name: "Submit",
          depth: 0,
          bbox: { cx: 120, cy: 40 },
        },
        {
          mark: 2,
          role: "link",
          name: "Home",
          depth: 1,
          bbox: { cx: 10, cy: 10 },
        },
      ],
      { maxNodes: 10 }
    );
    assert.match(tree, /@1/);
    assert.match(tree, /@2/);
    assert.match(tree, /\(120,40\)/);
    assert.match(tree, /Submit/);
  });
});

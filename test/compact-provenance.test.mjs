/**
 * Memory compaction keeps source IDs — no silent drop.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  collectSourceIds,
  compactEntriesWithProvenance,
  compactStoreIfNeeded,
  verifyProvenance,
} from "../src/memory/compact-provenance.mjs";

describe("compact provenance", () => {
  it("collectSourceIds inherits nested sources", () => {
    const ids = collectSourceIds({
      id: "c1",
      sourceIds: ["a", "b"],
      meta: { sourceIds: ["b", "d"] },
    });
    assert.deepEqual(ids.sort(), ["a", "b", "c1", "d"].sort());
  });

  it("compactEntriesWithProvenance preserves all input ids", () => {
    const entries = [
      { id: "m1", text: "wrote foo.txt" },
      { id: "m2", text: "ran tests, 3 passed" },
      { id: "m3", text: "fixed claim gate" },
    ];
    const { entry, sourceIds, dropped } = compactEntriesWithProvenance(entries);
    assert.equal(dropped, false);
    assert.deepEqual(sourceIds.sort(), ["m1", "m2", "m3"]);
    assert.ok(entry.text.includes("foo") || entry.text.includes("tests"));
    const v = verifyProvenance(entry, ["m1", "m2", "m3"]);
    assert.equal(v.ok, true);
  });

  it("compactStoreIfNeeded folds overflow with provenance", () => {
    const store = Array.from({ length: 12 }, (_, i) => ({
      id: `e${i}`,
      text: `note ${i} about task`,
    }));
    const { store: next, compacted, report } = compactStoreIfNeeded(store, {
      maxEntries: 8,
      compactBatch: 6,
    });
    assert.equal(report.compacted, true);
    assert.ok(compacted);
    assert.ok(next.length <= 8);
    assert.ok(compacted.sourceIds.length >= 5);
    const v = verifyProvenance(compacted, compacted.sourceIds);
    assert.equal(v.ok, true);
  });

  it("no compact when under max", () => {
    const store = [{ id: "a", text: "x" }];
    const r = compactStoreIfNeeded(store, { maxEntries: 10 });
    assert.equal(r.report.compacted, false);
    assert.equal(r.store.length, 1);
  });
});

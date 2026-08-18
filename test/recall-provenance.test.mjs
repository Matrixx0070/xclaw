import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compactEntriesWithProvenance } from "../src/memory/compact-provenance.mjs";
import { expandProvenance, expandRecallHits } from "../src/memory/recall-provenance.mjs";

describe("recall provenance expand", () => {
  it("expands compact note to original entries", () => {
    const originals = [
      { id: "m1", text: "wrote foo" },
      { id: "m2", text: "ran tests" },
    ];
    const { entry } = compactEntriesWithProvenance(originals);
    const store = [...originals, entry];
    const exp = expandProvenance(entry, store);
    assert.equal(exp.ok, true);
    assert.equal(exp.missing.length, 0);
    assert.ok(exp.sources.some((s) => s.id === "m1"));
    assert.ok(exp.sources.some((s) => s.id === "m2"));
  });

  it("reports missing source ids", () => {
    const exp = expandProvenance(
      { id: "c", sourceIds: ["gone"] },
      [{ id: "other", text: "x" }]
    );
    assert.equal(exp.ok, false);
    assert.deepEqual(exp.missing, ["gone"]);
  });

  it("expandRecallHits attaches provenance", () => {
    const originals = [{ id: "a", text: "alpha" }];
    const { entry } = compactEntriesWithProvenance(originals);
    const hits = expandRecallHits([{ ev: entry, score: 1 }], [...originals, entry]);
    assert.equal(hits[0].provenance.ok, true);
    assert.equal(hits[0].provenance.sources[0].id, "a");
  });
});

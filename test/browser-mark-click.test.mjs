/**
 * Feature 4 — mark cache + resolve error codes
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  setMarksFromStructure,
  resolveMark,
  clearMarkCache,
  resetAllMarkCaches,
  getMarkCacheStats,
} from "../src/browser/mark-cache.mjs";

describe("mark-cache", () => {
  beforeEach(() => resetAllMarkCaches());

  it("setMarksFromStructure then resolveMark", () => {
    const r = setMarksFromStructure(
      "s1",
      {
        url: "https://example.com",
        nodes: [
          { mark: 1, bbox: { cx: 10, cy: 20, w: 40, h: 12 }, role: "button", name: "Go" },
          { mark: 2, bbox: { x: 0, y: 0, w: 8, h: 8 }, role: "link", name: "Home" },
        ],
      },
      { tabId: "t1" }
    );
    assert.equal(r.ok, true);
    assert.equal(r.count, 2);
    const hit = resolveMark("s1", 1, { tabId: "t1" });
    assert.equal(hit.ok, true);
    assert.equal(hit.x, 10);
    assert.equal(hit.y, 20);
    const hit2 = resolveMark("s1", 2, { tabId: "t1" });
    assert.equal(hit2.ok, true);
    assert.equal(hit2.x, 4);
    assert.equal(hit2.y, 4);
  });

  it("MARK_CACHE_EMPTY", () => {
    const r = resolveMark("none", 1);
    assert.equal(r.ok, false);
    assert.equal(r.code, "MARK_CACHE_EMPTY");
  });

  it("MARK_UNKNOWN", () => {
    setMarksFromStructure("s1", {
      nodes: [{ mark: 1, bbox: { cx: 1, cy: 1, w: 2, h: 2 } }],
    });
    const r = resolveMark("s1", 9);
    assert.equal(r.ok, false);
    assert.equal(r.code, "MARK_UNKNOWN");
    assert.deepEqual(r.validMarks, [1]);
  });

  it("MARK_NOT_VISIBLE", () => {
    setMarksFromStructure("s1", {
      nodes: [{ mark: 3, bbox: { cx: 0, cy: 0, w: 0, h: 0 } }],
    });
    const r = resolveMark("s1", 3);
    assert.equal(r.ok, false);
    assert.equal(r.code, "MARK_NOT_VISIBLE");
  });

  it("MARK_STALE on TTL", () => {
    setMarksFromStructure("s1", {
      nodes: [{ mark: 1, bbox: { cx: 5, cy: 5, w: 1, h: 1 } }],
    });
    const r = resolveMark("s1", 1, { ttlMs: -1 });
    assert.equal(r.ok, false);
    assert.equal(r.code, "MARK_STALE");
  });

  it("MARK_STALE on url mismatch", () => {
    setMarksFromStructure("s1", {
      url: "https://a.example",
      nodes: [{ mark: 1, bbox: { cx: 5, cy: 5, w: 1, h: 1 } }],
    });
    const r = resolveMark("s1", 1, { url: "https://b.example" });
    assert.equal(r.ok, false);
    assert.equal(r.code, "MARK_STALE");
  });

  it("clearMarkCache", () => {
    setMarksFromStructure("s1", {
      nodes: [{ mark: 1, bbox: { cx: 1, cy: 1, w: 1, h: 1 } }],
    });
    clearMarkCache("s1");
    assert.equal(resolveMark("s1", 1).code, "MARK_CACHE_EMPTY");
  });

  it("stats", () => {
    setMarksFromStructure("s1", {
      url: "https://x",
      nodes: [{ mark: 2, bbox: { cx: 1, cy: 1, w: 1, h: 1 } }],
    });
    const st = getMarkCacheStats("s1");
    assert.equal(st.count, 1);
    assert.deepEqual(st.marks, [2]);
  });
});

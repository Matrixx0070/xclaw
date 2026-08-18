import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeStopSurfaceVersion, stampStopSurfaceOnEvidence } from "../src/ci/stop-surface-version.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("stop surface version", () => {
  it("computes stable short hash", () => {
    const a = computeStopSurfaceVersion(root);
    const b = computeStopSurfaceVersion(root);
    assert.equal(a.version, b.version);
    assert.ok(a.version.length === 16);
    assert.ok(a.files.length >= 3);
  });
  it("stamps evidence object", () => {
    const ev = {};
    stampStopSurfaceOnEvidence(ev, root);
    assert.ok(ev.stopSurface.version);
  });
});

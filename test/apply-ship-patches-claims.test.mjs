import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("ship patches include claims + receipt hash", () => {
  // goal-receipt-hash.patch deleted with goal-loop.mjs (S6b, 2026-08-23):
  // the legacy runner is gone; the receipt-hash capability lives in
  // jobs/stamp-tool-hash and is asserted by its own tests.
  it("apply-ship-patches lists the claims wire", () => {
    const src = fs.readFileSync(path.join(root, "scripts/apply-ship-patches.mjs"), "utf8");
    assert.ok(src.includes("job-claims-gate-wire.patch"));
    assert.ok(src.includes("gateStructuredClaims"));
    assert.ok(!src.includes("goal-receipt-hash.patch"), "deleted patch not re-listed");
  });

  it("claims patch file exists", () => {
    assert.ok(fs.existsSync(path.join(root, "patches/job-claims-gate-wire.patch")));
  });
});

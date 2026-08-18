import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("ship patches include claims + receipt hash", () => {
  it("apply-ship-patches lists both files", () => {
    const src = fs.readFileSync(path.join(root, "scripts/apply-ship-patches.mjs"), "utf8");
    assert.ok(src.includes("job-claims-gate-wire.patch"));
    assert.ok(src.includes("goal-receipt-hash.patch"));
    assert.ok(src.includes("gateStructuredClaims"));
    assert.ok(src.includes("toolHashTip"));
  });

  it("patch files exist", () => {
    assert.ok(fs.existsSync(path.join(root, "patches/job-claims-gate-wire.patch")));
    assert.ok(fs.existsSync(path.join(root, "patches/goal-receipt-hash.patch")));
  });
});

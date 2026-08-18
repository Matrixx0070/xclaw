import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("land remaining ship patches", () => {
  it("combined land patch covers all ship wires", () => {
    const p = fs.readFileSync(path.join(root, "patches/land-remaining-ship.patch"), "utf8");
    for (const m of [
      "gateStructuredClaims",
      "authorizeQuotaPreflight",
      "redactEvent",
      "withLedgerLock",
      "pushSkillsIntegrity",
      "toolHashTip",
    ]) {
      assert.ok(p.includes(m), m);
    }
  });
});

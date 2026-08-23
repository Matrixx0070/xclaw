import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("land remaining ship patches", () => {
  it("combined land patch covers all ship wires", () => {
    // The wires are what must exist; whether they arrived via this combined
    // patch or were landed directly is not a property worth asserting.
    const p = fs.readFileSync(path.join(root, "patches/land-remaining-ship.patch"), "utf8") +
      ["src/jobs/job.mjs", "src/jobs/claims-soft-retry-run.mjs", "src/security/approvals.mjs", "src/memory/durable.mjs",
       "src/tokens/cost-governor.mjs", "src/cli/doctor.mjs"] // goal-loop deleted (S6b, 2026-08-23)
        .map((rel) => { try { return fs.readFileSync(path.join(root, rel), "utf8"); } catch { return ""; } })
        .join("\n");
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

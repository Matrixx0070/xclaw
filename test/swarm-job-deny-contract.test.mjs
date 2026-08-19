import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("job deny contract", () => {
  it("runJob source returns costBlocked + SWARM_LEDGER_HARD_CAP", () => {
    const src = fs.readFileSync(path.join(root, "src/jobs/job.mjs"), "utf8");
    assert.ok(src.includes("SWARM_LEDGER_HARD_CAP"));
    assert.ok(src.includes("costBlocked: true"));
    assert.ok(src.includes("reserveUsd"));
    assert.ok(src.includes("settleUsd"));
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
describe("land-batch-n2", () => {
  it("mega-patch covers collector, stop-help, openapi gate", () => {
    const p = fs.readFileSync(path.join(root, "patches/land-batch-n2.patch"), "utf8");
    assert.ok(p.includes("attachReceiptCollectorToJob"));
    assert.ok(p.includes("printStopHelp"));
    assert.ok(p.includes("openapi-stop-dryrun"));
  });
});

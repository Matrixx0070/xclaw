import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("ship-pack land-batch wire", () => {
  it("ci-ship-pack imports and calls runLandBatchChecks", () => {
    const src = fs.readFileSync(path.join(root, "scripts/ci-ship-pack.mjs"), "utf8");
    assert.ok(src.includes('from "../src/ci/land-batch-check.mjs"'));
    assert.ok(src.includes("runLandBatchChecks(root)"));
    assert.ok(src.includes("land-batch --check"));
  });
});

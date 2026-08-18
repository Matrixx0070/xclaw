import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("ship-pack autonomy smoke", () => {
  it("ci-ship-pack lists autonomy offline tests", () => {
    const src = fs.readFileSync(path.join(root, "scripts/ci-ship-pack.mjs"), "utf8");
    assert.ok(src.includes("autonomy-harness-offline.test.mjs"));
    assert.ok(src.includes("autonomy-smoke-offline"));
  });

  it("autonomy-smoke-offline script exists", () => {
    assert.ok(fs.existsSync(path.join(root, "scripts/autonomy-smoke-offline.mjs")));
  });
});

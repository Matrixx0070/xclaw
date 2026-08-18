import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("ship-pack strict requires autonomy smoke", () => {
  it("ci-ship-pack strict path requires autonomySmokeOk", () => {
    const src = fs.readFileSync(path.join(root, "scripts/ci-ship-pack.mjs"), "utf8");
    assert.ok(src.includes("autonomySmokeOk"));
    assert.ok(src.includes("STRICT FAIL: autonomy-smoke-offline required under --strict"));
    assert.ok(src.includes("strict: autonomy smoke passed"));
  });

  it("autonomy-smoke-offline script is present", () => {
    assert.ok(fs.existsSync(path.join(root, "scripts/autonomy-smoke-offline.mjs")));
  });
});

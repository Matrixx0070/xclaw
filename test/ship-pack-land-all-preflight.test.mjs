import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("ship-pack land-all preflight", () => {
  it("ci-ship-pack runs land-all before land-batch check", () => {
    const src = fs.readFileSync(path.join(root, "scripts/ci-ship-pack.mjs"), "utf8");
    assert.ok(src.includes("scripts/land-all.mjs"));
    const iLand = src.indexOf("land-all (idempotent apply)");
    const iCheck = src.indexOf("land-batch --check");
    assert.ok(iLand > 0 && iCheck > iLand);
  });
});

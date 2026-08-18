/**
 * ship-pack --strict fails when doctor report has errors.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("ship-pack strict flag", () => {
  it("script documents --strict and env XCLAW_SHIP_STRICT", () => {
    const src = fs.readFileSync(path.join(root, "scripts/ci-ship-pack.mjs"), "utf8");
    assert.match(src, /--strict/);
    assert.match(src, /XCLAW_SHIP_STRICT/);
    assert.match(src, /STRICT FAIL/);
  });

  it("package.json has ship:pack:strict", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    assert.equal(pkg.scripts["ship:pack:strict"], "node scripts/ci-ship-pack.mjs --strict");
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts/apply-ship-patches.mjs");

describe("apply-ship-patches", () => {
  it("--check exits 0 when markers present", () => {
    const r = spawnSync(process.execPath, [script, "--check"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
  });

  it("idempotent apply exits 0", () => {
    const r = spawnSync(process.execPath, [script], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.match(r.stderr || "", /already applied|done|APPLIED/i);
  });
});

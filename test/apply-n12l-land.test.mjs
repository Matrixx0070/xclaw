import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("apply-n12l land", () => {
  it("apply-n12l exits 0", () => {
    const apply = path.join(root, "scripts/apply-n12l-g18.mjs");
    assert.ok(fs.existsSync(apply));
    const r = spawnSync(process.execPath, [apply], {
      encoding: "utf8",
      cwd: root,
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
  });
});

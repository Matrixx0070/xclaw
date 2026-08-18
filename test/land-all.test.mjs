import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("land-all wires", () => {
  it("mega patch exists", () => {
    const mega = path.join(root, "patches/land-all-wires.patch");
    assert.ok(fs.existsSync(mega));
    assert.ok(fs.existsSync(path.join(root, "scripts/land-all.mjs")));
  });

  it("land-all --check is runnable", () => {
    const r = spawnSync(process.execPath, ["scripts/land-all.mjs", "--check"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.ok(r.status === 0 || r.status === 1);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("authorize-quota-job patch", () => {
  it("git apply --check succeeds", () => {
    const fp = path.join(root, "patches/authorize-quota-job.patch");
    assert.ok(fs.existsSync(fp));
    const r = spawnSync("git", ["apply", "--check", fp], { cwd: root, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr || r.stdout);
  });
});

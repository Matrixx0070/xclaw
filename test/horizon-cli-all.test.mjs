import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("horizon cli", () => {
  it("offline --all exits 0", () => {
    spawnSync(
      process.execPath,
      [path.join(root, "scripts/apply-horizon-pack.mjs")],
      { cwd: root, encoding: "utf8" }
    );
    const r = spawnSync(
      process.execPath,
      [path.join(root, "src/eval/horizon-cli.mjs"), "--offline", "--all"],
      { encoding: "utf8", cwd: root, timeout: 60_000 }
    );
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const j = JSON.parse(r.stdout);
    assert.equal(j.ok, true);
    assert.equal(j.includeAll, true);
  });
  it("live without --confirm-live is dry-run", () => {
    const r = spawnSync(
      process.execPath,
      [path.join(root, "src/eval/horizon-cli.mjs"), "--live"],
      { encoding: "utf8", cwd: root }
    );
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const j = JSON.parse(r.stdout);
    assert.equal(j.mode, "live_dry_run");
  });
});

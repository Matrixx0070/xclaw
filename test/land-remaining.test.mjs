import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("land-remaining", () => {
  it("script exists and supports flags", () => {
    const fp = path.join(root, "scripts/land-remaining.mjs");
    assert.ok(fs.existsSync(fp));
    const src = fs.readFileSync(fp, "utf8");
    assert.ok(src.includes("land-remaining"));
    assert.ok(src.includes("--check"));
    assert.ok(src.includes("--json"));
  });

  it("--json returns structured results", () => {
    const r = spawnSync(process.execPath, ["scripts/land-remaining.mjs", "--json", "--check"], {
      cwd: root,
      encoding: "utf8",
    });
    const out = (r.stdout || "").trim();
    assert.ok(out.startsWith("{"), out.slice(0, 80));
    const j = JSON.parse(out);
    assert.ok(Array.isArray(j.results));
    assert.ok(Array.isArray(j.already) || Array.isArray(j.need));
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { resolveComputerEngine } from "../src/computer/engine.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("Strategy C computer policy", () => {
  it("SOURCE_OF_TRUTH declares strategy C", () => {
    const sot = JSON.parse(
      fs.readFileSync(path.join(root, "src/computer/SOURCE_OF_TRUTH.json"), "utf8")
    );
    assert.equal(sot.strategy, "C");
    assert.equal(sot.policy?.handEditBundle, false);
  });

  it("runtime bundle artifact exists", () => {
    const p = path.join(root, "src/computer/xclaw-server.mjs");
    assert.ok(fs.existsSync(p));
    assert.ok(fs.statSync(p).size > 1_000_000);
  });

  it("MODULE_MAP extracted modules exist", () => {
    const map = JSON.parse(
      fs.readFileSync(path.join(root, "src/computer/MODULE_MAP.json"), "utf8")
    );
    for (const e of map.extracted) {
      assert.ok(
        fs.existsSync(path.join(root, e.path)),
        `missing ${e.path}`
      );
    }
  });

  it("build:computer stub exits 0 and writes stamp", () => {
    const r = spawnSync(
      process.execPath,
      [path.join(root, "scripts/build-computer-bundle.mjs")],
      { encoding: "utf8", cwd: root }
    );
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const stamp = JSON.parse(
      fs.readFileSync(path.join(root, "src/computer/build-stamp.json"), "utf8")
    );
    assert.equal(stamp.strategy, "C");
    assert.ok(["C1","C2","C3"].includes(stamp.phase));
    assert.equal(stamp.fullRebuild, false);
  });

  it("transitional default engine is still native", () => {
    assert.equal(resolveComputerEngine({}), "native");
  });

  it("bundle engine selectable", () => {
    assert.equal(
      resolveComputerEngine({ computer: { engine: "bundle" } }),
      "bundle"
    );
  });
});

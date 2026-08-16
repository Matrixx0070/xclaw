import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  resolveComputerEngine,
  describeComputerEngine,
} from "../src/computer/engine.mjs";
import { MAINTAINED_TOOLS } from "../src/computer/modules/registry.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const matrixPath = path.join(root, "src/computer/PARITY_MATRIX.json");

describe("Strategy C4 parity matrix", () => {
  it("PARITY_MATRIX.json exists and lists registry tools", () => {
    assert.ok(fs.existsSync(matrixPath));
    const matrix = JSON.parse(fs.readFileSync(matrixPath, "utf8"));
    assert.equal(matrix.phase, "C4");
    assert.equal(matrix.policy?.handEditBundle, false);
    assert.equal(matrix.policy?.defaultEngine, "bundle");
    const names = new Set(matrix.tools.map((t) => t.name));
    for (const t of MAINTAINED_TOOLS) {
      assert.ok(names.has(t.name), `matrix missing registry tool ${t.name}`);
    }
  });

  it("defaultPath tools are not native=missing", () => {
    const matrix = JSON.parse(fs.readFileSync(matrixPath, "utf8"));
    for (const t of matrix.tools) {
      if (t.defaultPath) {
        assert.notEqual(
          t.native,
          "missing",
          `${t.name} is defaultPath but native=missing`
        );
      }
    }
  });

  it("default engine is bundle; describeComputerEngine works", () => {
    const prev = process.env.XCLAW_COMPUTER_ENGINE;
    const prevN = process.env.XCLAW_COMPUTER_NATIVE;
    delete process.env.XCLAW_COMPUTER_ENGINE;
    delete process.env.XCLAW_COMPUTER_NATIVE;
    try {
      assert.equal(resolveComputerEngine({}), "bundle");
      const d = describeComputerEngine({});
      assert.equal(d.engine, "bundle");
      assert.equal(d.isDefaultBundle, true);
      assert.equal(d.policy?.defaultEngine, "bundle");
      assert.match(String(d.strategyPhase || ""), /C4/);
    } finally {
      if (prev !== undefined) process.env.XCLAW_COMPUTER_ENGINE = prev;
      else delete process.env.XCLAW_COMPUTER_ENGINE;
      if (prevN !== undefined) process.env.XCLAW_COMPUTER_NATIVE = prevN;
      else delete process.env.XCLAW_COMPUTER_NATIVE;
    }
  });

  it("check-computer-parity script exits 0", () => {
    const r = spawnSync(
      process.execPath,
      [path.join(root, "scripts/check-computer-parity.mjs")],
      { cwd: root, encoding: "utf8" }
    );
    if (r.status !== 0) {
      console.error(r.stdout);
      console.error(r.stderr);
    }
    assert.equal(r.status, 0);
  });
});

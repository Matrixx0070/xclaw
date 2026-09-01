/**
 * soak/ ledger must live in the config dir that owns the instance.
 *
 * `baseDir()` resolved `~/.xclaw/soak` from `os.homedir()` while
 * production writers (`appendSoakRun(cfg)` / `appendFlake(cfg)` at
 * scripts/soak-run.mjs and scripts/soak-multinight.mjs, both via
 * `loadConfig()`) already had cfg in scope.
 * Two consequences, same class as v3.297.0 alert-state.json /
 * v3.533.0 eval-quarantine.json:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single soak/ directory, so instance B listed instance A's nights.
 *  2. The suite wrote into the operator's real `~/.xclaw/soak`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `appendSoakRun` / `appendFlake`
 * still return the in-memory row without persisting (do not `mkdir(null)`).
 * Honour existing `XCLAW_CONFIG_DIR`. No new env.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  soakStoreDir,
  soakPaths,
  appendSoakRun,
  appendFlake,
  getSoakSummary,
} from "../src/eval/soak.mjs";

const HOME_SOAK = path.join(os.homedir(), ".xclaw", "soak");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-soak-cfg-"));
}

function homeSoakListing() {
  try {
    return fs.readdirSync(HOME_SOAK).sort();
  } catch {
    return null;
  }
}

function resolverSlice() {
  const src = fs.readFileSync(
    new URL("../src/eval/soak.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("export function soakStoreDir");
  const end = src.indexOf("export async function appendSoakRun");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

describe("soak ledger follows paths.configDir", () => {
  after(() => {
    if (SAVED_CONFIG_DIR === undefined) delete process.env.XCLAW_CONFIG_DIR;
    else process.env.XCLAW_CONFIG_DIR = SAVED_CONFIG_DIR;
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(soakStoreDir(cfg), path.join(dir, "soak"));
    assert.notEqual(soakStoreDir(cfg), HOME_SOAK);
    assert.equal(soakPaths(cfg).dir, path.join(dir, "soak"));
    assert.equal(soakPaths(cfg).runs, path.join(dir, "soak", "runs.jsonl"));
  });

  test("a write lands in the config dir and never touches the home soak dir", async () => {
    const dir = await tmpDir();
    const homeBefore = homeSoakListing();

    const cfg = { paths: { configDir: dir } };
    const rec = await appendSoakRun(cfg, {
      tags: ["pin-configDir"],
      passed: 1,
      failed: 0,
      total: 1,
      passRate: 1,
    });
    assert.equal(rec.tags[0], "pin-configDir");
    const raw = fs.readFileSync(soakPaths(cfg).runs, "utf8");
    assert.ok(raw.includes("pin-configDir"), "soak ledger did not persist into paths.configDir");
    const s = await getSoakSummary(cfg);
    assert.equal(s.runs, 1);

    assert.deepEqual(homeSoakListing(), homeBefore, "soak ledger wrote the home soak dir");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      assert.equal(soakStoreDir({}), path.join(dir, "soak"));
      await appendSoakRun({}, { tags: ["pin-env"], passed: 1, failed: 0, total: 1, passRate: 1 });
      const raw = fs.readFileSync(soakPaths({}).runs, "utf8");
      assert.ok(raw.includes("pin-env"));
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no dir and never writes home", async () => {
    assert.equal(soakStoreDir({}), null);
    assert.equal(soakStoreDir(), null);
    assert.notEqual(soakStoreDir({}), HOME_SOAK);
    assert.deepEqual(soakPaths({}), { dir: null, runs: null, flakes: null, summary: null });

    const homeBefore = homeSoakListing();
    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    const rec = await appendSoakRun({}, { tags: ["nope"], passed: 1, failed: 0, total: 1, passRate: 1 });
    assert.equal(rec.tags[0], "nope");
    const flake = await appendFlake({}, { caseId: "nope" });
    assert.equal(flake.caseId, "nope");
    const s = await getSoakSummary({});
    assert.equal(s.runs, 0);
    assert.equal(s.flakes, 0);

    assert.deepEqual(homeSoakListing(), homeBefore, "no-configDir soak ledger wrote home soak dir");
    assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir soak ledger mkdir cwd/null");
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
  });
});

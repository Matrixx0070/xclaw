/**
 * evolution/events.jsonl must live in the config dir that owns the instance.
 *
 * `evolveDir()` resolved `~/.xclaw/evolution` from `os.homedir()` while
 * production writers (`appendEvolveLog(cfg)` via `runEvolutionTick(cfg)`
 * at cron/heartbeat.mjs:120) already had cfg in scope.
 * Two consequences, same class as v3.297.0 alert-state.json /
 * v3.546.0 ops-schedule.json:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single evolution log, so instance B stamped instance A's
 *     self-evolution ticks.
 *  2. The suite wrote into the operator's real `~/.xclaw`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `appendEvolveLog` still returns
 * `null` without persisting (do not `mkdir(null)`).
 * Honour existing `XCLAW_CONFIG_DIR`. No new env.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  evolveDir,
  appendEvolveLog,
} from "../src/autonomy/self-evolve.mjs";

const HOME_EV = path.join(os.homedir(), ".xclaw", "evolution");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-evolve-cfg-"));
}

function homeEvListing() {
  try {
    return fs.readdirSync(HOME_EV).sort();
  } catch {
    return null;
  }
}

function resolverSlice() {
  const src = fs.readFileSync(
    new URL("../src/autonomy/self-evolve.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("export function evolveDir");
  const end = src.indexOf("export async function appendEvolveLog");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

describe("self-evolve log follows paths.configDir", () => {
  after(() => {
    if (SAVED_CONFIG_DIR === undefined) delete process.env.XCLAW_CONFIG_DIR;
    else process.env.XCLAW_CONFIG_DIR = SAVED_CONFIG_DIR;
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(evolveDir(cfg), path.join(dir, "evolution"));
    assert.notEqual(evolveDir(cfg), HOME_EV);
  });

  test("a write lands in the config dir and never touches the home evolution dir", async () => {
    const dir = await tmpDir();
    const homeBefore = homeEvListing();

    const cfg = { paths: { configDir: dir } };
    const fp = await appendEvolveLog(cfg, { kind: "pin", id: "pin-job" });
    assert.equal(fp, path.join(dir, "evolution", "events.jsonl"));
    assert.ok(fs.existsSync(fp), "evolve log did not persist into paths.configDir");
    const body = fs.readFileSync(fp, "utf8");
    assert.match(body, /"kind":"pin"/);
    assert.match(body, /"id":"pin-job"/);

    assert.deepEqual(homeEvListing(), homeBefore, "evolve wrote the home evolution dir");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      assert.equal(evolveDir({}), path.join(dir, "evolution"));
      const fp = await appendEvolveLog({}, { kind: "pin-env" });
      assert.equal(fp, path.join(dir, "evolution", "events.jsonl"));
      assert.ok(fs.existsSync(fp));
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no dir and never writes home", async () => {
    assert.equal(evolveDir({}), null);
    assert.equal(evolveDir(), null);
    assert.notEqual(evolveDir({}), HOME_EV);

    const homeBefore = homeEvListing();
    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    assert.equal(await appendEvolveLog({}, { kind: "nope" }), null);
    assert.equal(await appendEvolveLog(undefined, { kind: "nope" }), null);

    assert.deepEqual(homeEvListing(), homeBefore, "no-configDir evolve wrote home evolution dir");
    assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir evolve mkdir cwd/null");
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
  });
});

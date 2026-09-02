/**
 * ops-schedule.json must live in the config dir that owns the instance.
 *
 * `dueStatePath()` resolved `~/.xclaw/ops-schedule.json` from
 * `os.homedir()` while production writers (`markRan(cfg)` /
 * `markArmed(cfg)` at cron/scheduler.mjs:99/207 and
 * ops/scheduler.mjs:70) already had cfg in scope.
 * Two consequences, same class as v3.297.0 alert-state.json /
 * v3.545.0 merge proposals:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single ops-schedule.json, so instance B stamped
 *     instance A's maintenance clock.
 *  2. The suite wrote into the operator's real `~/.xclaw`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `markRan`/`markArmed` still return
 * `false` without persisting (do not `mkdir(null)`).
 * Honour existing `XCLAW_CONFIG_DIR`. No new env.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  dueStatePath,
  markRan,
  markArmed,
  readDueState,
  readDueStateSync,
  readAnchorsSync,
} from "../src/ops/due.mjs";

const HOME_STAMP = path.join(os.homedir(), ".xclaw", "ops-schedule.json");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-due-cfg-"));
}

function homeStampListing() {
  try {
    return fs.readFileSync(HOME_STAMP, "utf8");
  } catch {
    return null;
  }
}

function resolverSlice() {
  const src = fs.readFileSync(
    new URL("../src/ops/due.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("export function dueStatePath");
  const end = src.indexOf("export async function readDueState");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

describe("ops due-stamp follows paths.configDir", () => {
  after(() => {
    if (SAVED_CONFIG_DIR === undefined) delete process.env.XCLAW_CONFIG_DIR;
    else process.env.XCLAW_CONFIG_DIR = SAVED_CONFIG_DIR;
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(dueStatePath(cfg), path.join(dir, "ops-schedule.json"));
    assert.notEqual(dueStatePath(cfg), HOME_STAMP);
  });

  test("a write lands in the config dir and never touches the home stamp", async () => {
    const dir = await tmpDir();
    const homeBefore = homeStampListing();

    const cfg = { paths: { configDir: dir } };
    const t0 = 1_700_000_000_000;
    assert.equal(await markArmed(cfg, "pin-job", t0), true);
    assert.equal(await markRan(cfg, "pin-job", t0 + 1), true);
    const state = await readDueState(cfg);
    assert.equal(state["pin-job"], t0 + 1);
    assert.deepEqual(readDueStateSync(cfg), state);
    const anchors = readAnchorsSync(cfg);
    assert.equal(anchors.lastRun["pin-job"], t0 + 1);
    assert.equal(anchors.armed["pin-job"], t0);
    assert.ok(
      fs.existsSync(path.join(dir, "ops-schedule.json")),
      "due stamp did not persist into paths.configDir"
    );

    assert.equal(homeStampListing(), homeBefore, "due wrote the home stamp");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      assert.equal(dueStatePath({}), path.join(dir, "ops-schedule.json"));
      const t0 = 1_700_000_000_100;
      assert.equal(await markRan({}, "pin-env", t0), true);
      assert.ok(fs.existsSync(path.join(dir, "ops-schedule.json")));
      assert.equal((await readDueState({}))["pin-env"], t0);
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no dir and never writes home", async () => {
    assert.equal(dueStatePath({}), null);
    assert.equal(dueStatePath(), null);
    assert.notEqual(dueStatePath({}), HOME_STAMP);

    const homeBefore = homeStampListing();
    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    assert.equal(await markArmed({}, "nope", 1), false);
    assert.equal(await markRan({}, "nope", 1), false);
    assert.deepEqual(await readDueState({}), {});
    assert.deepEqual(readDueStateSync({}), {});
    assert.deepEqual(readAnchorsSync({}), { lastRun: {}, armed: {} });

    assert.equal(homeStampListing(), homeBefore, "no-configDir due wrote home stamp");
    assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir due mkdir cwd/null");
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
  });
});

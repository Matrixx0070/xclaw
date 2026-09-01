/**
 * computer.pid / computer.meta.json / logs/computer.log must live in the
 * config dir that owns the instance.
 *
 * `configDir()` resolved `~/.xclaw` from `os.homedir()` while production
 * writers (`writePid` / `writeMeta` / `appendLog` via `startComputer`
 * which `await loadConfig()` internally at computer/manager.mjs,
 * gateway/index.mjs, computer/ensure.mjs, computer/watchdog.mjs;
 * `stopComputer(cfg)` at session-control.mjs and gateway/index.mjs)
 * already had cfg in scope.
 * Two consequences, same class as v3.297.0 alert-state.json /
 * v3.537.0 credentials.json:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single computer.pid, so instance B overwrote instance A's
 *     supervisor state.
 *  2. The suite wrote into the operator's real `~/.xclaw`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `writePid` / `writeMeta` still
 * no-op without persisting (do not `mkdir(null)`). Honour existing
 * `XCLAW_CONFIG_DIR`. No new env.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  computerConfigDir,
  computerPidPath,
  computerMetaPath,
  computerLogPath,
  writePid,
  writeMeta,
} from "../src/computer/manager.mjs";

const HOME_PID = path.join(os.homedir(), ".xclaw", "computer.pid");
const HOME_META = path.join(os.homedir(), ".xclaw", "computer.meta.json");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-comp-cfg-"));
}

function resolverSlice() {
  const src = fs.readFileSync(
    new URL("../src/computer/manager.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("export function computerConfigDir");
  const end = src.indexOf("export function computerProbeHost");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

describe("computer supervisor files follow paths.configDir", () => {
  after(() => {
    if (SAVED_CONFIG_DIR === undefined) delete process.env.XCLAW_CONFIG_DIR;
    else process.env.XCLAW_CONFIG_DIR = SAVED_CONFIG_DIR;
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(computerConfigDir(cfg), dir);
    assert.equal(computerPidPath(cfg), path.join(dir, "computer.pid"));
    assert.equal(computerMetaPath(cfg), path.join(dir, "computer.meta.json"));
    assert.equal(computerLogPath(cfg), path.join(dir, "logs", "computer.log"));
    assert.notEqual(computerPidPath(cfg), HOME_PID);
  });

  test("a write lands in the config dir and never touches the home computer files", async () => {
    const dir = await tmpDir();
    const homePidBefore = fs.existsSync(HOME_PID);
    const homeMetaBefore = fs.existsSync(HOME_META);

    const cfg = { paths: { configDir: dir } };
    await writePid(cfg, 424242);
    await writeMeta(cfg, { pid: 424242, engine: "pin" });
    assert.ok(fs.existsSync(path.join(dir, "computer.pid")), "pid did not persist into paths.configDir");
    assert.ok(fs.existsSync(path.join(dir, "computer.meta.json")), "meta did not persist into paths.configDir");
    assert.equal((await fsp.readFile(path.join(dir, "computer.pid"), "utf8")).trim(), "424242");

    assert.equal(fs.existsSync(HOME_PID), homePidBefore, "computer wrote the home computer.pid");
    assert.equal(fs.existsSync(HOME_META), homeMetaBefore, "computer wrote the home computer.meta.json");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      assert.equal(computerConfigDir({}), dir);
      assert.equal(computerPidPath({}), path.join(dir, "computer.pid"));
      await writePid({}, 7);
      assert.ok(fs.existsSync(path.join(dir, "computer.pid")));
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no file and never writes home", async () => {
    assert.equal(computerConfigDir({}), null);
    assert.equal(computerConfigDir(), null);
    assert.equal(computerPidPath({}), null);
    assert.equal(computerMetaPath({}), null);
    assert.equal(computerLogPath({}), null);
    assert.notEqual(computerPidPath({}), HOME_PID);

    const homePidBefore = fs.existsSync(HOME_PID);
    const homeMetaBefore = fs.existsSync(HOME_META);
    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    await writePid({}, 99);
    await writeMeta({}, { pid: 99 });

    assert.equal(fs.existsSync(HOME_PID), homePidBefore, "no-configDir computer wrote home computer.pid");
    assert.equal(fs.existsSync(HOME_META), homeMetaBefore, "no-configDir computer wrote home computer.meta.json");
    assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir computer mkdir cwd/null");
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
  });
});

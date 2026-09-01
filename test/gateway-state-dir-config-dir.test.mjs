/**
 * Supervised gateway state (crash-history + single-instance lock) must live
 * in the config dir that owns the instance.
 *
 * `startGatewaySupervised()` resolved `~/.xclaw` from `os.homedir()` while
 * cfg was already in scope. `lockPath` independently homed when `stateDir`
 * was unset. `gateway.runLoop === true` is default-OFF, but when the flag
 * is on two instances on one host with different `paths.configDir` shared
 * one crash-history and one `tmp/gateway-*.lock`; the suite wrote the
 * operator's real `~/.xclaw`. Same class as v3.297.0 alert-state.json /
 * v3.511.0 telegram-writer.lock.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. acquire no-ops a null path (do not
 * mkdir(null)). Crash-guard no-ops a null stateDir (do not path.join(null)).
 * Do not honour `XCLAW_STATE_DIR` (seats/auth fallback, not this lock).
 * Production threads cfg so live still locks under configDir.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  defaultGatewayStateDir,
  acquireGatewayLock,
} from "../src/gateway/run-loop.mjs";
import { applyCrashLoopGuard } from "../src/gateway/crash-guard.mjs";

const HOME_STATE = path.join(os.homedir(), ".xclaw");
const HOME_LOCK = path.join(HOME_STATE, "tmp", "gateway-default.lock");
const HOME_CRASH = path.join(HOME_STATE, "gateway-crash-history.json");

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-gw-state-cfg-"));
}

function homeLockExists() {
  return fs.existsSync(HOME_LOCK);
}

function homeCrashExists() {
  return fs.existsSync(HOME_CRASH);
}

describe("gateway supervised state follows paths.configDir", () => {
  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(defaultGatewayStateDir({ cfg }), dir);
    assert.notEqual(defaultGatewayStateDir({ cfg }), HOME_STATE);
  });

  test("acquire with cfg writes the config dir and never touches the home dir", async () => {
    const dir = await tmpDir();
    const homeBefore = homeLockExists();
    const cfg = { paths: { configDir: dir } };
    const expected = path.join(dir, "tmp", "gateway-18765.lock");

    const lock = await acquireGatewayLock({ cfg, port: 18765 });
    assert.equal(lock.file, expected);
    assert.equal(lock.skipped, undefined);
    assert.equal(fs.existsSync(expected), true);
    assert.equal(fs.readFileSync(expected, "utf8"), String(process.pid));

    assert.equal(homeLockExists(), homeBefore, "acquire wrote the home gateway lock");
    await lock.release();
  });

  test("an explicit opts.stateDir still wins over the config dir", async () => {
    const dir = await tmpDir();
    const explicit = path.join(dir, "explicit-state");
    const cfg = { paths: { configDir: dir } };
    assert.equal(defaultGatewayStateDir({ stateDir: explicit, cfg }), explicit);
  });

  test("with no configDir there is NO home fallback — it names no dir and never writes home", async () => {
    assert.equal(defaultGatewayStateDir({}), null);
    assert.equal(defaultGatewayStateDir(), null);
    assert.notEqual(defaultGatewayStateDir({}), HOME_STATE);

    const homeBefore = homeLockExists();
    const lock = await acquireGatewayLock({});
    assert.equal(lock.file, null);
    assert.equal(lock.skipped, true);
    await lock.release();

    assert.equal(homeLockExists(), homeBefore, "no-configDir acquire wrote the home lock");
  });

  test("crash-guard with no stateDir is a no-op and never writes home or cwd", async () => {
    const homeBefore = homeCrashExists();
    const cwdFile = path.join(process.cwd(), "gateway-crash-history.json");
    const cwdBefore = fs.existsSync(cwdFile);

    const guard = applyCrashLoopGuard(null);
    assert.equal(guard.delayMs, 0);
    guard.clear();

    assert.equal(homeCrashExists(), homeBefore, "null crash-guard wrote the home history");
    assert.equal(fs.existsSync(cwdFile), cwdBefore, "null crash-guard wrote cwd history");
  });

  test("startGatewaySupervised threads cfg into defaultGatewayStateDir", () => {
    const gw = fs.readFileSync(new URL("../src/gateway/index.mjs", import.meta.url), "utf8");
    const supervised = gw.slice(
      gw.indexOf("async function startGatewaySupervised"),
      gw.indexOf("export async function startGateway"),
    );
    assert.match(supervised, /defaultGatewayStateDir\(\{ cfg \}\)/);
    assert.match(supervised, /applyCrashLoopGuard\(stateRoot\)/);
    assert.doesNotMatch(supervised, /os\.homedir\(\)/);
  });
});

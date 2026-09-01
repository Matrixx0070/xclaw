/**
 * last-drain.json must live in the config dir that owns the instance.
 *
 * `lastDrainPath()` resolved `~/.xclaw/last-drain.json` from
 * `os.homedir()` while production stop writers (`recordLastDrain(drain,
 * { cfg })` at stop-route / ws-stop-control / sse-stop-control) already
 * had cfg in scope. Two consequences, same class as v3.297.0
 * alert-state.json / v3.520.0 swarm-ledger.lease:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single last-drain.json, so instance B's doctor reported
 *     instance A's last stop.
 *  2. The suite wrote into the operator's real `~/.xclaw/last-drain.json`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `recordLastDrain` no-ops a null
 * path (in-memory `last` still set; do not `mkdir(null)`). Honour
 * existing `XCLAW_CONFIG_DIR`. No new env.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  lastDrainPath,
  recordLastDrain,
  loadLastDrain,
  getLastDrain,
} from "../src/gateway/last-drain.mjs";

const HOME_DRAIN = path.join(os.homedir(), ".xclaw", "last-drain.json");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-ld-cfg-"));
}

function resolverSlice() {
  const src = fs.readFileSync(
    new URL("../src/gateway/last-drain.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("export function lastDrainPath");
  const end = src.indexOf("export function recordLastDrain");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

describe("last-drain follows paths.configDir", () => {
  after(() => {
    if (SAVED_CONFIG_DIR === undefined) delete process.env.XCLAW_CONFIG_DIR;
    else process.env.XCLAW_CONFIG_DIR = SAVED_CONFIG_DIR;
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(lastDrainPath(cfg), path.join(dir, "last-drain.json"));
    assert.notEqual(lastDrainPath(cfg), HOME_DRAIN);
  });

  test("a write lands in the config dir and never touches the home file", async () => {
    const dir = await tmpDir();
    const homeBefore = fs.existsSync(HOME_DRAIN)
      ? fs.readFileSync(HOME_DRAIN)
      : null;

    const cfg = { paths: { configDir: dir } };
    const rec = recordLastDrain(
      { sessionsKilled: 7, wsClosed: 1, sseClosed: 0, authMethod: "hmac" },
      { cfg }
    );
    assert.equal(rec.sessionsKilled, 7);
    const raw = fs.readFileSync(path.join(dir, "last-drain.json"), "utf8");
    assert.ok(raw.includes("hmac"), "last-drain did not persist into paths.configDir");
    const got = getLastDrain(cfg);
    assert.equal(got.sessionsKilled, 7);

    const homeAfter = fs.existsSync(HOME_DRAIN)
      ? fs.readFileSync(HOME_DRAIN)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "last-drain wrote the home last-drain.json");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      assert.equal(lastDrainPath({}), path.join(dir, "last-drain.json"));
      recordLastDrain(
        { sessionsKilled: 3, wsClosed: 0, sseClosed: 0, authMethod: "token" },
        {}
      );
      const raw = fs.readFileSync(path.join(dir, "last-drain.json"), "utf8");
      assert.ok(raw.includes("token"));
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no file and never writes home", async () => {
    assert.equal(lastDrainPath({}), null);
    assert.equal(lastDrainPath(), null);
    assert.notEqual(lastDrainPath({}), HOME_DRAIN);

    const homeBefore = fs.existsSync(HOME_DRAIN)
      ? fs.readFileSync(HOME_DRAIN)
      : null;

    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    const rec = recordLastDrain(
      { sessionsKilled: 9, wsClosed: 0, sseClosed: 0, authMethod: "lab" },
      {}
    );
    assert.equal(rec.sessionsKilled, 9, "null-path record must still set in-memory last");
    assert.equal(getLastDrain({}).sessionsKilled, 9);
    assert.equal(loadLastDrain({}).sessionsKilled, 9);

    const homeAfter = fs.existsSync(HOME_DRAIN)
      ? fs.readFileSync(HOME_DRAIN)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "no-configDir last-drain wrote the home file");
    assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir last-drain mkdir cwd/null");
  });

  test("explicit extra.path still writes when no configDir", async () => {
    const dir = await tmpDir();
    const fp = path.join(dir, "explicit-drain.json");
    const homeBefore = fs.existsSync(HOME_DRAIN)
      ? fs.readFileSync(HOME_DRAIN)
      : null;
    recordLastDrain(
      { sessionsKilled: 1, wsClosed: 0, sseClosed: 0, authMethod: "hmac" },
      { path: fp }
    );
    assert.ok(fs.existsSync(fp), "extra.path did not write");
    const raw = fs.readFileSync(fp, "utf8");
    assert.ok(raw.includes("hmac"));
    const homeAfter = fs.existsSync(HOME_DRAIN)
      ? fs.readFileSync(HOME_DRAIN)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "extra.path write touched home");
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
  });
});

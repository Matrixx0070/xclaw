/**
 * control.sqlite must live in the config dir that owns the instance.
 *
 * `controlPlaneFile()` resolved `~/.xclaw/state/control.sqlite` from
 * `os.homedir()` while production `getControlPlane(cfg)` at gateway boot
 * already had cfg in scope. `loadConfig()` stamps `paths.configDir`
 * unconditionally and does not stamp `stateDir` or `controlPlaneFile`, so
 * the resolver still homed. Two consequences, same class as v3.297.0
 * alert-state.json:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single control.sqlite, so instance B's pairing/delivery/
 *     task state mixed with instance A's.
 *  2. The suite wrote into the operator's real `~/.xclaw/state/control.sqlite`.
 *
 * Home fallback is refused. A cfg without configDir is never a real
 * caller. Such a path is `null`. Honour `XCLAW_CONTROL_PLANE_FILE` (it
 * exists). Do not honour `XCLAW_STATE_DIR` (seats/auth fallback).
 * Production already threads cfg so live still persists under configDir.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  controlPlaneFile,
  openControlPlane,
  openControlPlaneExclusive,
  getControlPlane,
  stopControlPlane,
} from "../src/state/control-plane.mjs";
import { probeSqlFile } from "../src/persist/sql-quarantine.mjs";

const HOME_FILE = path.join(os.homedir(), ".xclaw", "state", "control.sqlite");
const SAVED_CONTROL_PLANE_FILE = process.env.XCLAW_CONTROL_PLANE_FILE;
const SAVED_STATE_DIR = process.env.XCLAW_STATE_DIR;
delete process.env.XCLAW_CONTROL_PLANE_FILE;
delete process.env.XCLAW_STATE_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-control-cfg-"));
}

describe("control-plane sqlite follows paths.configDir", () => {
  after(() => {
    if (SAVED_CONTROL_PLANE_FILE === undefined) delete process.env.XCLAW_CONTROL_PLANE_FILE;
    else process.env.XCLAW_CONTROL_PLANE_FILE = SAVED_CONTROL_PLANE_FILE;
    if (SAVED_STATE_DIR === undefined) delete process.env.XCLAW_STATE_DIR;
    else process.env.XCLAW_STATE_DIR = SAVED_STATE_DIR;
    stopControlPlane();
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(controlPlaneFile(cfg), path.join(dir, "state", "control.sqlite"));
    assert.notEqual(controlPlaneFile(cfg), HOME_FILE);
  });

  test("a write lands in the config dir and never touches the home file", async () => {
    const dir = await tmpDir();
    const homeBefore = fs.existsSync(HOME_FILE)
      ? fs.readFileSync(HOME_FILE)
      : null;

    const cfg = { paths: { configDir: dir } };
    const kit = openControlPlane(cfg);
    try {
      const expected = path.join(dir, "state", "control.sqlite");
      assert.equal(controlPlaneFile(cfg), expected);
      assert.equal(fs.existsSync(expected), true);
      const row = kit.prepare("SELECT version FROM schema_meta WHERE key = ?").get("control");
      assert.equal(typeof row.version, "number");
    } finally {
      kit.close();
    }

    const homeAfter = fs.existsSync(HOME_FILE)
      ? fs.readFileSync(HOME_FILE)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "open wrote the home control.sqlite");
  });

  test("an explicit paths.controlPlaneFile still wins over the config dir", async () => {
    const dir = await tmpDir();
    const explicit = path.join(dir, "custom-control.sqlite");
    const cfg = {
      paths: { configDir: dir, controlPlaneFile: explicit },
    };
    assert.equal(controlPlaneFile(cfg), explicit);
  });

  test("paths.stateDir wins over configDir", async () => {
    const dir = await tmpDir();
    const stateDir = path.join(dir, "explicit-state");
    const cfg = { paths: { configDir: dir, stateDir } };
    assert.equal(controlPlaneFile(cfg), path.join(stateDir, "control.sqlite"));
  });

  test("XCLAW_CONTROL_PLANE_FILE wins over configDir", async () => {
    const dir = await tmpDir();
    const envFile = path.join(dir, "via-env.sqlite");
    process.env.XCLAW_CONTROL_PLANE_FILE = envFile;
    try {
      const cfg = { paths: { configDir: dir } };
      assert.equal(controlPlaneFile(cfg), envFile);
    } finally {
      delete process.env.XCLAW_CONTROL_PLANE_FILE;
    }
  });

  test("XCLAW_STATE_DIR is not honoured", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_STATE_DIR = path.join(dir, "env-state");
    try {
      const cfg = { paths: { configDir: dir } };
      assert.equal(controlPlaneFile(cfg), path.join(dir, "state", "control.sqlite"));
    } finally {
      delete process.env.XCLAW_STATE_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no file and never writes home", async () => {
    assert.equal(controlPlaneFile({}), null);
    assert.equal(controlPlaneFile(), null);
    assert.notEqual(controlPlaneFile({}), HOME_FILE);

    const homeBefore = fs.existsSync(HOME_FILE)
      ? fs.readFileSync(HOME_FILE)
      : null;
    const cwdFile = path.join(process.cwd(), "control.sqlite");
    const cwdState = path.join(process.cwd(), "state", "control.sqlite");
    const cwdBefore = fs.existsSync(cwdFile);
    const cwdStateBefore = fs.existsSync(cwdState);

    assert.equal(openControlPlane({}), null);
    assert.equal(openControlPlaneExclusive({}), null);
    stopControlPlane();
    assert.equal(getControlPlane({}), null);

    const homeAfter = fs.existsSync(HOME_FILE)
      ? fs.readFileSync(HOME_FILE)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "no-configDir open wrote the home file");
    assert.equal(fs.existsSync(cwdFile), cwdBefore, "no-configDir open wrote cwd");
    assert.equal(fs.existsSync(cwdState), cwdStateBefore, "no-configDir open wrote cwd/state");
  });

  test("probeSqlFile and doctor existSync tolerate a null path", () => {
    const pushed = [];
    probeSqlFile((id, status, message) => pushed.push({ id, status, message }), "sql.control", null);
    assert.equal(pushed.length, 1);
    assert.equal(pushed[0].status, "info");

    const doctor = fs.readFileSync(new URL("../src/cli/doctor.mjs", import.meta.url), "utf8");
    assert.match(doctor, /if \(controlFile && fsSync\.existsSync\(controlFile\)\)/);
    const fix = fs.readFileSync(new URL("../src/cli/doctor-fix.mjs", import.meta.url), "utf8");
    assert.match(fix, /if \(!plane\)/);
  });

  test("getControlPlane at gateway boot threads cfg", () => {
    const gw = fs.readFileSync(new URL("../src/gateway/index.mjs", import.meta.url), "utf8");
    assert.match(gw, /getControlPlane\(cfg\)/);
    const src = fs.readFileSync(new URL("../src/state/control-plane.mjs", import.meta.url), "utf8");
    assert.doesNotMatch(src, /os\.homedir\(\)/);
    const resolver = src.slice(
      src.indexOf("export function controlPlaneFile"),
      src.indexOf("export function pairingJsonFile"),
    );
    assert.doesNotMatch(resolver, /XCLAW_STATE_DIR/);
    assert.match(resolver, /XCLAW_CONTROL_PLANE_FILE/);
  });
});

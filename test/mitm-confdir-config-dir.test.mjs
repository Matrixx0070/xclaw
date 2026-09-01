/**
 * MITM confdir must live in the config dir that owns the instance.
 *
 * `mitmConfdir()` resolved `~/.xclaw/mitm` from `os.homedir()` while
 * production `startMitm(cfg)` at supervisor and browser-tools already
 * had cfg in scope. `loadConfig()` stamps `paths.configDir`
 * unconditionally and does not stamp `browser.mitm.confdir`, so the
 * resolver still homed. Supervisor `loadMitmCfg()` is raw JSON without
 * configDir, and `tick()` rotated `flows.jsonl` via `mitmConfdir()` with
 * no cfg. Two consequences, same class as v3.297.0 alert-state.json:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single mitm confdir (pid/log/flows/CA).
 *  2. The suite wrote into the operator's real `~/.xclaw/mitm`.
 *
 * Home fallback is refused. A cfg without configDir is never a real
 * caller. Such a path is `null`. Honour `XCLAW_MITM_CONFDIR` (it
 * exists). Do not honour `XCLAW_STATE_DIR` (seats/auth fallback).
 * Supervisor stamps configDir onto loadMitmCfg and threads cfg into
 * tick so live still persists under configDir when MITM is on.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  mitmConfdir,
  mitmPidPath,
  mitmLogPath,
  mitmFlowsPath,
  ensureMitmConfdir,
  startMitm,
  stopMitm,
  readMitmFlows,
  mitmStatus,
  clearMitmFlows,
} from "../src/browser/mitm.mjs";

const HOME_DIR = path.join(os.homedir(), ".xclaw", "mitm");
const SAVED_MITM_CONFDIR = process.env.XCLAW_MITM_CONFDIR;
const SAVED_STATE_DIR = process.env.XCLAW_STATE_DIR;
const SAVED_MITM = process.env.XCLAW_MITM;
delete process.env.XCLAW_MITM_CONFDIR;
delete process.env.XCLAW_STATE_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-mitm-cfg-"));
}

describe("mitm confdir follows paths.configDir", () => {
  after(() => {
    if (SAVED_MITM_CONFDIR === undefined) delete process.env.XCLAW_MITM_CONFDIR;
    else process.env.XCLAW_MITM_CONFDIR = SAVED_MITM_CONFDIR;
    if (SAVED_STATE_DIR === undefined) delete process.env.XCLAW_STATE_DIR;
    else process.env.XCLAW_STATE_DIR = SAVED_STATE_DIR;
    if (SAVED_MITM === undefined) delete process.env.XCLAW_MITM;
    else process.env.XCLAW_MITM = SAVED_MITM;
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(mitmConfdir(cfg), path.join(dir, "mitm"));
    assert.notEqual(mitmConfdir(cfg), HOME_DIR);
    assert.equal(mitmPidPath(cfg), path.join(dir, "mitm", "mitm.pid"));
    assert.equal(mitmLogPath(cfg), path.join(dir, "mitm", "mitm.log"));
    assert.equal(mitmFlowsPath(cfg), path.join(dir, "mitm", "flows.jsonl"));
  });

  test("a write lands in the config dir and never touches the home dir", async () => {
    const dir = await tmpDir();
    const homeBefore = fs.existsSync(HOME_DIR);
    const homeListing = homeBefore ? fs.readdirSync(HOME_DIR).sort() : null;

    const cfg = { paths: { configDir: dir } };
    const confdir = await ensureMitmConfdir(cfg);
    const expected = path.join(dir, "mitm");
    assert.equal(confdir, expected);
    assert.equal(fs.existsSync(path.join(expected, "addons.py")), true);

    const homeAfter = fs.existsSync(HOME_DIR);
    assert.equal(homeAfter, homeBefore, "ensure wrote the home mitm dir");
    if (homeBefore) {
      assert.deepEqual(fs.readdirSync(HOME_DIR).sort(), homeListing, "ensure mutated the home mitm dir");
    }
  });

  test("an explicit browser.mitm.confdir still wins over the config dir", async () => {
    const dir = await tmpDir();
    const explicit = path.join(dir, "custom-mitm");
    const cfg = {
      paths: { configDir: dir },
      browser: { mitm: { confdir: explicit } },
    };
    assert.equal(mitmConfdir(cfg), explicit);
  });

  test("XCLAW_MITM_CONFDIR wins over configDir", async () => {
    const dir = await tmpDir();
    const envDir = path.join(dir, "via-env");
    process.env.XCLAW_MITM_CONFDIR = envDir;
    try {
      const cfg = { paths: { configDir: dir } };
      assert.equal(mitmConfdir(cfg), envDir);
    } finally {
      delete process.env.XCLAW_MITM_CONFDIR;
    }
  });

  test("XCLAW_STATE_DIR is not honoured", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_STATE_DIR = path.join(dir, "env-state");
    try {
      const cfg = { paths: { configDir: dir } };
      assert.equal(mitmConfdir(cfg), path.join(dir, "mitm"));
    } finally {
      delete process.env.XCLAW_STATE_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no dir and never writes home", async () => {
    assert.equal(mitmConfdir({}), null);
    assert.equal(mitmConfdir(), null);
    assert.notEqual(mitmConfdir({}), HOME_DIR);
    assert.equal(mitmPidPath(), null);
    assert.equal(mitmFlowsPath(), null);

    const homeBefore = fs.existsSync(HOME_DIR);
    const homeListing = homeBefore ? fs.readdirSync(HOME_DIR).sort() : null;
    const cwdMitm = path.join(process.cwd(), "mitm");
    const cwdReady = path.join(process.cwd(), "ready");
    const cwdFlows = path.join(process.cwd(), "flows.jsonl");
    const cwdBefore = fs.existsSync(cwdMitm);
    const cwdReadyBefore = fs.existsSync(cwdReady);
    const cwdFlowsBefore = fs.existsSync(cwdFlows);

    assert.equal(await ensureMitmConfdir({}), null);
    assert.equal(await ensureMitmConfdir(), null);
    assert.deepEqual(await readMitmFlows(), []);
    const cleared = await clearMitmFlows();
    assert.equal(cleared.ok, true);
    assert.equal(cleared.path, null);
    const st = await mitmStatus();
    assert.equal(st.confdir, null);
    assert.equal(st.flowCount, 0);

    process.env.XCLAW_MITM = "true";
    try {
      const started = await startMitm({});
      assert.equal(started.ok, false);
      assert.equal(started.code, "MITM_NO_CONFDIR");
      const stopped = await stopMitm({});
      assert.equal(stopped.ok, true);
      assert.equal(stopped.stopped, false);
    } finally {
      delete process.env.XCLAW_MITM;
    }

    const homeAfter = fs.existsSync(HOME_DIR);
    assert.equal(homeAfter, homeBefore, "no-configDir wrote the home mitm dir");
    if (homeBefore) {
      assert.deepEqual(fs.readdirSync(HOME_DIR).sort(), homeListing, "no-configDir mutated the home mitm dir");
    }
    assert.equal(fs.existsSync(cwdMitm), cwdBefore, "no-configDir wrote cwd/mitm");
    assert.equal(fs.existsSync(cwdReady), cwdReadyBefore, "no-configDir wrote cwd/ready");
    assert.equal(fs.existsSync(cwdFlows), cwdFlowsBefore, "no-configDir wrote cwd/flows.jsonl");
  });

  test("supervisor stamps configDir and tick threads cfg", () => {
    const sup = fs.readFileSync(new URL("../scripts/gateway-supervisor.mjs", import.meta.url), "utf8");
    assert.match(sup, /if \(!raw\.paths\.configDir\) raw\.paths\.configDir = configDir/);
    assert.match(sup, /return \{ paths: \{ configDir \} \}/);
    assert.match(sup, /const cfg = loadMitmCfg\(\);/);
    assert.match(sup, /isMitmEnabled\(cfg\)/);
    assert.match(sup, /mitmStatus\(cfg\)/);
    assert.match(sup, /stopMitm\(cfg/);
    assert.match(sup, /mitmConfdir\(cfg\)/);
    assert.match(sup, /if \(confdir\) \{/);

    const src = fs.readFileSync(new URL("../src/browser/mitm.mjs", import.meta.url), "utf8");
    const resolver = src.slice(
      src.indexOf("export function mitmConfdir"),
      src.indexOf("export function mitmPidPath"),
    );
    assert.doesNotMatch(resolver, /XCLAW_STATE_DIR/);
    assert.doesNotMatch(resolver, /os\.homedir\(\)/);
    assert.match(resolver, /XCLAW_MITM_CONFDIR/);

    const maint = fs.readFileSync(new URL("../src/ops/maintenance.mjs", import.meta.url), "utf8");
    assert.match(maint, /const confdir = mitmConfdir\(cfg\);/);
    assert.match(maint, /if \(confdir\) \{/);
  });
});

/**
 * web-session.json must live in the config dir that owns the instance.
 *
 * `paths()` resolved `~/.xclaw/web-session.json` from `os.homedir()`
 * while production writers (`importWebSession(cfg)` via `runAuthCli(cfg)`
 * at bin/xclaw.mjs:49-53 after `loadConfig()`) already had cfg in
 * scope. Two consequences, same class as v3.297.0 alert-state.json /
 * v3.550.0 cron/jobs.sqlite:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single web-session.json, so instance B restored instance
 *     A's Grok web cookies.
 *  2. The suite wrote into the operator's real `~/.xclaw`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `importWebSession` still returns
 * without persisting (do not `mkdir(null)`). `loadWebSession` returns
 * null. `clearWebSession` no-ops. Honour existing `XCLAW_CONFIG_DIR`.
 * Keep `cfg.auth?.web?.sessionPath`. No new env.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  importWebSession,
  loadWebSession,
  clearWebSession,
} from "../src/auth/web-login.mjs";

const HOME_WEB = path.join(os.homedir(), ".xclaw", "web-session.json");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-web-cfg-"));
}

function homeWebListing() {
  try {
    return fs.readFileSync(HOME_WEB, "utf8");
  } catch {
    return null;
  }
}

function restoreEnv(key, saved) {
  if (saved === undefined) delete process.env[key];
  else process.env[key] = saved;
}

function resolverSlice() {
  const src = fs.readFileSync(
    new URL("../src/auth/web-login.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("function paths");
  const end = src.indexOf("export function redactSecret");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

function pinCfg(dir, extra = {}) {
  return {
    paths: { configDir: dir },
    auth: { web: { sessionSecret: "test-secret-at-least-16-chars", ...extra } },
  };
}

describe("web session follows paths.configDir", () => {
  after(() => {
    restoreEnv("XCLAW_CONFIG_DIR", SAVED_CONFIG_DIR);
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = pinCfg(dir);
    const imp = await importWebSession(cfg, { cookie: "session=pin-resolve" });
    assert.equal(imp.ok, true);
    assert.equal(imp.path, path.join(dir, "web-session.json"));
    assert.notEqual(imp.path, HOME_WEB);
  });

  test("a write lands in the config dir and never touches the home web-session file", async () => {
    const dir = await tmpDir();
    const homeBefore = homeWebListing();

    const cfg = pinCfg(dir);
    const imp = await importWebSession(cfg, { cookie: "session=pin-job" });
    assert.equal(imp.ok, true);
    const fp = path.join(dir, "web-session.json");
    assert.equal(imp.path, fp);
    assert.ok(fs.existsSync(fp), "web session did not persist into paths.configDir");
    const body = fs.readFileSync(fp, "utf8");
    assert.ok(!body.includes("pin-job"), "session cookie stored in plaintext");
    assert.match(body, /aes-256-gcm/);
    const loaded = await loadWebSession(cfg);
    assert.equal(loaded.cookie, "session=pin-job");

    assert.equal(homeWebListing(), homeBefore, "web-login wrote the home web-session file");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      const cfg = { auth: { web: { sessionSecret: "test-secret-at-least-16-chars" } } };
      const imp = await importWebSession(cfg, { cookie: "session=pin-env" });
      assert.equal(imp.ok, true);
      assert.equal(imp.path, path.join(dir, "web-session.json"));
      assert.ok(fs.existsSync(path.join(dir, "web-session.json")));
      const loaded = await loadWebSession(cfg);
      assert.equal(loaded.cookie, "session=pin-env");
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no dir and never writes home", async () => {
    const homeBefore = homeWebListing();
    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    const imp = await importWebSession({}, { cookie: "session=no-home" });
    assert.equal(imp.ok, false);
    assert.equal(await loadWebSession({}), null);
    assert.equal(await loadWebSession(), null);
    const cleared = await clearWebSession({});
    assert.equal(cleared.ok, true);

    assert.equal(homeWebListing(), homeBefore, "no-configDir web-login wrote home");
    assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir web-login mkdir cwd/null");
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
    assert.match(slice, /sessionPath/);
  });
});

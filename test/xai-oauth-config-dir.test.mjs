/**
 * auth.json (xAI OAuth token vault) must live in the config dir that owns
 * the instance.
 *
 * `authPaths()` resolved `~/.xclaw/auth.json` from `os.homedir()` while
 * production writers (`loginXai(cfg)` at auth-cli.mjs:279 and
 * `logoutXai(cfg)` at auth-cli.mjs:96 inside `runAuthCli(cfg)` at
 * bin/xclaw.mjs:49-53 after `loadConfig()`; also `refreshXaiToken(own, cfg)`
 * from `loadXaiAuth(cfg)`) already had cfg in scope. Two consequences,
 * same class as v3.297.0 alert-state.json / v3.537.0 credentials.json /
 * v3.558.0 idempotency.json:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single auth.json, so instance B overwrote instance A's
 *     OAuth tokens.
 *  2. The suite wrote into the operator's real `~/.xclaw`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `writeTokens` still no-ops without
 * persisting (do not `mkdir` dirname of null). `logoutXai` no-ops without
 * unlink(null). Honour existing `XCLAW_CONFIG_DIR`. Keep
 * `cfg.auth?.xai?.tokenPath`. Keep grokCliAuth at `~/.grok/auth.json`
 * (Grok CLI cache — not this store). Keep `XCLAW_XAI_CLIENT_ID` as OAuth
 * client id (not path). No new env.
 *
 * Do not call `importGrokCliAuth({})` from this pin — that depends on
 * the operator's `~/.grok/auth.json`. Writer is `refreshXaiToken` with
 * stubbed fetch (same as xai-oauth-file-mode.test.mjs).
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { refreshXaiToken, logoutXai } from "../src/auth/xai-oauth.mjs";

const HOME_AUTH = path.join(os.homedir(), ".xclaw", "auth.json");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

const FAKE_AT = "at-test-000000000000000000000000fake";
const FAKE_RT = "rt-test-000000000000000000000000fake";
const REFRESH_BODY = {
  access_token: FAKE_AT,
  refresh_token: FAKE_RT + "2",
  token_type: "Bearer",
  expires_in: 3600,
};

async function withStubbedRefresh(body, fn) {
  const realFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  try {
    return await fn();
  } finally {
    global.fetch = realFetch;
  }
}

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-xaioauth-cfg-"));
}

function homeListing() {
  try {
    return fs.readFileSync(HOME_AUTH, "utf8");
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
    new URL("../src/auth/xai-oauth.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("function authPaths");
  const end = src.indexOf("function xaiCfg");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

function pinCfg(dir) {
  return { paths: { configDir: dir } };
}

describe("xai oauth token vault follows paths.configDir", () => {
  after(() => {
    restoreEnv("XCLAW_CONFIG_DIR", SAVED_CONFIG_DIR);
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = pinCfg(dir);
    const next = await withStubbedRefresh(REFRESH_BODY, () =>
      refreshXaiToken({ refresh_token: FAKE_RT }, cfg)
    );
    assert.equal(next.access_token, FAKE_AT);
    const fp = path.join(dir, "auth.json");
    assert.ok(fs.existsSync(fp), "auth.json did not land in paths.configDir");
    assert.notEqual(fp, HOME_AUTH);
  });

  test("a write lands in the config dir and never touches the home vault", async () => {
    const dir = await tmpDir();
    const homeBefore = homeListing();

    const cfg = pinCfg(dir);
    const next = await withStubbedRefresh(REFRESH_BODY, () =>
      refreshXaiToken({ refresh_token: FAKE_RT }, cfg)
    );
    assert.equal(next.access_token, FAKE_AT);

    const stateFp = path.join(dir, "auth.json");
    assert.ok(
      fs.existsSync(stateFp),
      "auth.json did not persist into paths.configDir"
    );
    const body = fs.readFileSync(stateFp, "utf8");
    assert.match(body, /"access_token":/);
    assert.match(body, /"refresh_token":/);

    assert.equal(homeListing(), homeBefore, "xai-oauth wrote a home store");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      const next = await withStubbedRefresh(REFRESH_BODY, () =>
        refreshXaiToken({ refresh_token: FAKE_RT }, {})
      );
      assert.equal(next.access_token, FAKE_AT);
      assert.ok(fs.existsSync(path.join(dir, "auth.json")));
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no dir and never writes home", async () => {
    const homeBefore = homeListing();
    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    // refresh still returns next after writeTokens no-ops; a second
    // call cannot observe a persisted vault.
    const next = await withStubbedRefresh(REFRESH_BODY, () =>
      refreshXaiToken({ refresh_token: FAKE_RT }, {})
    );
    assert.ok(next);
    assert.equal(next.access_token, FAKE_AT);
    assert.equal(fs.existsSync(HOME_AUTH) ? homeListing() : homeBefore, homeBefore);

    const cleared = await logoutXai({});
    assert.equal(cleared.ok, true);

    assert.equal(homeListing(), homeBefore, "no-configDir xai-oauth wrote home");
    assert.equal(
      fs.existsSync(cwdNull),
      cwdBefore,
      "no-configDir xai-oauth mkdir cwd/null"
    );
  });

  test("resolver body does not home this store and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    // grokCliAuth legitimately uses os.homedir() for ~/.grok/auth.json —
    // assert only that this store does not fall back to ~/.xclaw.
    assert.doesNotMatch(slice, /path\.join\(os\.homedir\(\),\s*["']\.xclaw["']\)/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
    assert.match(slice, /tokenPath/);
  });
});

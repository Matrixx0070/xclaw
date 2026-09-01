/**
 * connected-tokens.json must live in the config dir that owns the instance.
 *
 * `storePath()` resolved `~/.xclaw/connected-tokens.json` from
 * `os.homedir()` while production writers (`setAppToken(cfg)` at
 * oauth-callback / oauth-login) already had cfg in scope. Two
 * consequences, same class as v3.297.0 alert-state.json /
 * v3.522.0 mcp-oauth.json:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single connected-tokens.json, so instance B's connected
 *     apps used instance A's tokens.
 *  2. The suite wrote into the operator's real `~/.xclaw/connected-tokens.json`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `saveTokens` no-ops a null path
 * (do not `mkdir(null)`). Honour existing `XCLAW_CONFIG_DIR`. No new env.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  storePath,
  loadTokens,
  saveTokens,
  setAppToken,
  getAppToken,
} from "../src/connected/token-store.mjs";

const HOME_STORE = path.join(os.homedir(), ".xclaw", "connected-tokens.json");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-tok-cfg-"));
}

function resolverSlice() {
  const src = fs.readFileSync(
    new URL("../src/connected/token-store.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("export function storePath");
  const end = src.indexOf("export async function loadTokens");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

describe("connected token store follows paths.configDir", () => {
  after(() => {
    if (SAVED_CONFIG_DIR === undefined) delete process.env.XCLAW_CONFIG_DIR;
    else process.env.XCLAW_CONFIG_DIR = SAVED_CONFIG_DIR;
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(storePath(cfg), path.join(dir, "connected-tokens.json"));
    assert.notEqual(storePath(cfg), HOME_STORE);
  });

  test("a write lands in the config dir and never touches the home file", async () => {
    const dir = await tmpDir();
    const homeBefore = fs.existsSync(HOME_STORE)
      ? fs.readFileSync(HOME_STORE)
      : null;

    const cfg = { paths: { configDir: dir } };
    await setAppToken(cfg, "github", { accessToken: "at-1", source: "pin" });
    const raw = fs.readFileSync(path.join(dir, "connected-tokens.json"), "utf8");
    assert.ok(raw.includes("at-1"), "token-store did not persist into paths.configDir");
    const got = await getAppToken(cfg, "github");
    assert.equal(got.accessToken, "at-1");
    const st = fs.statSync(path.join(dir, "connected-tokens.json"));
    assert.equal(st.mode & 0o777, 0o600);

    const homeAfter = fs.existsSync(HOME_STORE)
      ? fs.readFileSync(HOME_STORE)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "token-store wrote the home connected-tokens.json");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      assert.equal(storePath({}), path.join(dir, "connected-tokens.json"));
      await setAppToken({}, "github", { accessToken: "at-env", source: "pin" });
      const raw = fs.readFileSync(path.join(dir, "connected-tokens.json"), "utf8");
      assert.ok(raw.includes("at-env"));
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no file and never writes home", async () => {
    assert.equal(storePath({}), null);
    assert.equal(storePath(), null);
    assert.notEqual(storePath({}), HOME_STORE);

    const homeBefore = fs.existsSync(HOME_STORE)
      ? fs.readFileSync(HOME_STORE)
      : null;

    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    const saved = await saveTokens({}, { version: 1, apps: { github: { accessToken: "nope" } } });
    assert.equal(saved, null);
    await setAppToken({}, "github", { accessToken: "nope" });
    const loaded = await loadTokens({});
    assert.deepEqual(loaded, { version: 1, apps: {} });

    const homeAfter = fs.existsSync(HOME_STORE)
      ? fs.readFileSync(HOME_STORE)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "no-configDir token-store wrote the home file");
    assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir token-store mkdir cwd/null");
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
  });
});

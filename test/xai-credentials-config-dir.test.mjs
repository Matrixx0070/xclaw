/**
 * credentials.json must live in the config dir that owns the instance.
 *
 * `credPath()` resolved `~/.xclaw/credentials.json` from
 * `os.homedir()` while production writers (`saveCredentials(cfg)` via
 * `loginWithApiKey(cfg)` at auth/profiles.mjs and cli/auth-legacy-cli.mjs;
 * `loginWithOAuth(cfg)` at cli/auth-legacy-cli.mjs and cli/providers-cli.mjs;
 * `refreshOAuthToken(cfg)` from resolveXaiToken) already had cfg in scope.
 * Two consequences, same class as v3.297.0 alert-state.json /
 * v3.536.0 missions/:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single credentials.json, so instance B overwrote instance A's
 *     xAI key.
 *  2. The suite wrote into the operator's real `~/.xclaw/credentials.json`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `saveCredentials` still returns
 * `null` without persisting (do not `mkdir(null)`). Honour existing
 * `XCLAW_CONFIG_DIR`. No new env. Keep reading the Grok CLI cache at
 * `~/.grok/auth.json` (that is not this store).
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  credentialsPath,
  saveCredentials,
  loadCredentials,
  logout,
} from "../src/auth/xai.mjs";

const HOME_CRED = path.join(os.homedir(), ".xclaw", "credentials.json");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-xai-cfg-"));
}

function resolverSlice() {
  const src = fs.readFileSync(
    new URL("../src/auth/xai.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("export function credentialsPath");
  const end = src.indexOf("export function settleAfterCredsRefresh");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

describe("xai credentials follow paths.configDir", () => {
  after(() => {
    if (SAVED_CONFIG_DIR === undefined) delete process.env.XCLAW_CONFIG_DIR;
    else process.env.XCLAW_CONFIG_DIR = SAVED_CONFIG_DIR;
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(credentialsPath(cfg), path.join(dir, "credentials.json"));
    assert.notEqual(credentialsPath(cfg), HOME_CRED);
  });

  test("a write lands in the config dir and never touches the home credentials file", async () => {
    const dir = await tmpDir();
    const homeBefore = fs.existsSync(HOME_CRED);

    const cfg = { paths: { configDir: dir } };
    const fp = await saveCredentials(cfg, { xaiApiKey: "xai-pin-configDir" });
    assert.equal(fp, path.join(dir, "credentials.json"));
    assert.ok(fs.existsSync(fp), "credentials did not persist into paths.configDir");
    const loaded = await loadCredentials(cfg);
    assert.equal(loaded.xaiApiKey, "xai-pin-configDir");

    assert.equal(fs.existsSync(HOME_CRED), homeBefore, "credentials wrote the home credentials.json");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      assert.equal(credentialsPath({}), path.join(dir, "credentials.json"));
      const fp = await saveCredentials({}, { xaiApiKey: "xai-pin-env" });
      assert.equal(fp, path.join(dir, "credentials.json"));
      assert.ok(fs.existsSync(fp));
      assert.equal((await loadCredentials({})).xaiApiKey, "xai-pin-env");
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no file and never writes home", async () => {
    assert.equal(credentialsPath({}), null);
    assert.equal(credentialsPath(), null);
    assert.notEqual(credentialsPath({}), HOME_CRED);

    const homeBefore = fs.existsSync(HOME_CRED);
    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    const fp = await saveCredentials({}, { xaiApiKey: "xai-nope" });
    assert.equal(fp, null);
    assert.deepEqual(await loadCredentials({}), {});
    const lo = await logout({});
    assert.equal(lo.ok, true);

    assert.equal(fs.existsSync(HOME_CRED), homeBefore, "no-configDir credentials wrote home credentials.json");
    assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir credentials mkdir cwd/null");
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
  });
});

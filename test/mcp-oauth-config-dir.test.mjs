/**
 * mcp-oauth.json must live in the config dir that owns the instance.
 *
 * `storePath()` resolved `~/.xclaw/mcp-oauth.json` from
 * `os.homedir()` while production writers (`storeMcpGrant(cfg)` /
 * `dropMcpGrant(cfg)` at gateway/routes/mcp.mjs completeOAuthFlow /
 * DELETE /mcp/oauth) already had cfg in scope. Two consequences, same
 * class as v3.297.0 alert-state.json / v3.521.0 last-drain.json:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single mcp-oauth.json, so instance B's MCP servers used
 *     instance A's tokens.
 *  2. The suite wrote into the operator's real `~/.xclaw/mcp-oauth.json`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `saveMcpOAuthStore` no-ops a null
 * path (do not `mkdir(null)`). Honour existing `XCLAW_CONFIG_DIR`. No
 * new env.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  storePath,
  loadMcpOAuthStore,
  saveMcpOAuthStore,
  storeMcpGrant,
  dropMcpGrant,
} from "../src/mcp/oauth.mjs";

const HOME_STORE = path.join(os.homedir(), ".xclaw", "mcp-oauth.json");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-mcp-oauth-cfg-"));
}

function resolverSlice() {
  const src = fs.readFileSync(
    new URL("../src/mcp/oauth.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("export function storePath");
  const end = src.indexOf("export function loadMcpOAuthStore");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

const GRANT = {
  discovery: { tokenEndpoint: "http://as.example/token" },
  clientId: "c1",
  tokens: { accessToken: "at-1", refreshToken: "rt-1" },
};

describe("mcp oauth follows paths.configDir", () => {
  after(() => {
    if (SAVED_CONFIG_DIR === undefined) delete process.env.XCLAW_CONFIG_DIR;
    else process.env.XCLAW_CONFIG_DIR = SAVED_CONFIG_DIR;
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(storePath(cfg), path.join(dir, "mcp-oauth.json"));
    assert.notEqual(storePath(cfg), HOME_STORE);
  });

  test("a write lands in the config dir and never touches the home file", async () => {
    const dir = await tmpDir();
    const homeBefore = fs.existsSync(HOME_STORE)
      ? fs.readFileSync(HOME_STORE)
      : null;

    const cfg = { paths: { configDir: dir } };
    storeMcpGrant(cfg, "alpha", GRANT);
    const raw = fs.readFileSync(path.join(dir, "mcp-oauth.json"), "utf8");
    assert.ok(raw.includes("at-1"), "mcp-oauth did not persist into paths.configDir");
    const got = loadMcpOAuthStore(cfg);
    assert.equal(got.alpha.tokens.accessToken, "at-1");
    const st = fs.statSync(path.join(dir, "mcp-oauth.json"));
    assert.equal(st.mode & 0o777, 0o600);

    const homeAfter = fs.existsSync(HOME_STORE)
      ? fs.readFileSync(HOME_STORE)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "mcp-oauth wrote the home mcp-oauth.json");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      assert.equal(storePath({}), path.join(dir, "mcp-oauth.json"));
      storeMcpGrant({}, "beta", GRANT);
      const raw = fs.readFileSync(path.join(dir, "mcp-oauth.json"), "utf8");
      assert.ok(raw.includes("at-1"));
      dropMcpGrant({}, "beta");
      const after = loadMcpOAuthStore({});
      assert.equal(after.beta, undefined);
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

    saveMcpOAuthStore({}, { alpha: GRANT });
    storeMcpGrant({}, "alpha", GRANT);
    const loaded = loadMcpOAuthStore({});
    assert.deepEqual(loaded, {});

    const homeAfter = fs.existsSync(HOME_STORE)
      ? fs.readFileSync(HOME_STORE)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "no-configDir mcp-oauth wrote the home file");
    assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir mcp-oauth mkdir cwd/null");
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
  });
});

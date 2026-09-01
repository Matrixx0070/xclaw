/**
 * auth-refresh-status.json must live in the config dir that owns the instance.
 *
 * `statusPath()` resolved `~/.xclaw/auth-refresh-status.json` from
 * `os.homedir()` while production writers (`recordAuthRefreshStatus(cfg)`
 * at cost-preflight-auth) already had cfg in scope. Two consequences,
 * same class as v3.297.0 alert-state.json / v3.524.0 vault:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single status file, so instance B's doctor reported
 *     instance A's last refresh.
 *  2. The suite wrote into the operator's real `~/.xclaw/auth-refresh-status.json`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `recordAuthRefreshStatus` no-ops a
 * null path (do not `mkdir(null)`). Honour existing `XCLAW_CONFIG_DIR`.
 * No new env.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  statusPath,
  recordAuthRefreshStatus,
  loadAuthRefreshStatus,
} from "../src/tokens/auth-refresh-status.mjs";

const HOME_STORE = path.join(os.homedir(), ".xclaw", "auth-refresh-status.json");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-ars-cfg-"));
}

function resolverSlice() {
  const src = fs.readFileSync(
    new URL("../src/tokens/auth-refresh-status.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("export function statusPath");
  const end = src.indexOf("export async function recordAuthRefreshStatus");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

describe("auth-refresh status follows paths.configDir", () => {
  after(() => {
    if (SAVED_CONFIG_DIR === undefined) delete process.env.XCLAW_CONFIG_DIR;
    else process.env.XCLAW_CONFIG_DIR = SAVED_CONFIG_DIR;
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(statusPath(cfg), path.join(dir, "auth-refresh-status.json"));
    assert.notEqual(statusPath(cfg), HOME_STORE);
  });

  test("a write lands in the config dir and never touches the home file", async () => {
    const dir = await tmpDir();
    const homeBefore = fs.existsSync(HOME_STORE)
      ? fs.readFileSync(HOME_STORE)
      : null;

    const cfg = { paths: { configDir: dir } };
    await recordAuthRefreshStatus(cfg, {
      ok: true,
      results: [{ appId: "xai", ok: true, refreshed: false, source: "store" }],
    });
    const raw = fs.readFileSync(path.join(dir, "auth-refresh-status.json"), "utf8");
    assert.ok(raw.includes("xai"), "auth-refresh-status did not persist into paths.configDir");
    const st = await loadAuthRefreshStatus(cfg);
    assert.equal(st.ok, true);
    assert.equal(st.results[0].appId, "xai");

    const homeAfter = fs.existsSync(HOME_STORE)
      ? fs.readFileSync(HOME_STORE)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "auth-refresh-status wrote the home file");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      assert.equal(statusPath({}), path.join(dir, "auth-refresh-status.json"));
      await recordAuthRefreshStatus({}, {
        ok: true,
        results: [{ appId: "grok", ok: true, refreshed: true, source: "refresh" }],
      });
      const raw = fs.readFileSync(path.join(dir, "auth-refresh-status.json"), "utf8");
      assert.ok(raw.includes("grok"));
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no file and never writes home", async () => {
    assert.equal(statusPath({}), null);
    assert.equal(statusPath(), null);
    assert.notEqual(statusPath({}), HOME_STORE);

    const homeBefore = fs.existsSync(HOME_STORE)
      ? fs.readFileSync(HOME_STORE)
      : null;

    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    const saved = await recordAuthRefreshStatus({}, {
      ok: true,
      results: [{ appId: "xai", ok: true }],
    });
    assert.equal(saved.ok, true);
    const loaded = await loadAuthRefreshStatus({});
    assert.equal(loaded, null);

    const homeAfter = fs.existsSync(HOME_STORE)
      ? fs.readFileSync(HOME_STORE)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "no-configDir auth-refresh-status wrote the home file");
    assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir auth-refresh-status mkdir cwd/null");
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
  });
});

/**
 * jwks-cache.json must live in the config dir that owns the instance.
 *
 * `paths()` resolved `~/.xclaw/jwks-cache.json` from `os.homedir()`
 * while production writers (`getJwksCached(cfg)` / `exportJwks(cfg)` at
 * gateway/routes/jwks.mjs:21-25 via `tryHandleJwksRoute({ cfg })`) already
 * had cfg in scope. Two consequences, same class as v3.297.0
 * alert-state.json / v3.555.0 key-rotation.json:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single jwks-cache.json, so instance B served instance A's
 *     public keys / etag / generation.
 *  2. The suite wrote into the operator's real `~/.xclaw`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `writeCache` still no-ops without
 * persisting (do not call durableAtomicWriteJson on null). `readCache`
 * returns null (same as missing file). Honour existing `XCLAW_CONFIG_DIR`.
 * Keep `cfg.auth?.jwks?.cachePath`. Keep `XCLAW_JWKS_CACHE` as strategy
 * env (not path). No new env.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ensureKeyStore } from "../src/auth/key-rotation.mjs";
import {
  getJwksCached,
  invalidateJwksCache,
} from "../src/auth/jwks.mjs";

const HOME_JWKS = path.join(os.homedir(), ".xclaw", "jwks-cache.json");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-jwks-cfg-"));
}

function homeListing() {
  try {
    return fs.readFileSync(HOME_JWKS, "utf8");
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
    new URL("../src/auth/jwks.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("function paths");
  const end = src.indexOf("function jwksPolicy");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

function pinCfg(dir, extra = {}) {
  return {
    paths: { configDir: dir },
    auth: {
      keys: {
        secret: "pin-key-secret-16chars",
        rotationStrategy: "dual_slot",
        dualWindowMs: 60_000,
        autoRotate: false,
      },
      jwks: {
        cacheStrategy: "hybrid",
        cacheTtlMs: 60_000,
        maxStaleMs: 30_000,
        ...extra,
      },
    },
  };
}

describe("jwks cache follows paths.configDir", () => {
  after(() => {
    restoreEnv("XCLAW_CONFIG_DIR", SAVED_CONFIG_DIR);
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = pinCfg(dir);
    await ensureKeyStore(cfg);
    await invalidateJwksCache(cfg);
    const a = await getJwksCached(cfg);
    assert.equal(a.ok, true);
    const fp = path.join(dir, "jwks-cache.json");
    assert.ok(fs.existsSync(fp), "jwks cache did not land in paths.configDir");
    assert.notEqual(fp, HOME_JWKS);
  });

  test("a write lands in the config dir and never touches the home jwks-cache file", async () => {
    const dir = await tmpDir();
    const homeBefore = homeListing();

    const cfg = pinCfg(dir);
    await ensureKeyStore(cfg);
    await invalidateJwksCache(cfg);
    const a = await getJwksCached(cfg);
    assert.equal(a.ok, true);
    const b = await getJwksCached(cfg);
    assert.equal(b.cache, "hit");

    const stateFp = path.join(dir, "jwks-cache.json");
    assert.ok(fs.existsSync(stateFp), "jwks-cache.json did not persist into paths.configDir");
    const body = fs.readFileSync(stateFp, "utf8");
    assert.match(body, /"jwks":/);
    assert.match(body, /"keys":/);

    assert.equal(homeListing(), homeBefore, "jwks cache wrote a home store");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      const cfg = {
        auth: {
          keys: {
            secret: "pin-key-secret-16chars",
            rotationStrategy: "dual_slot",
            autoRotate: false,
          },
          jwks: {
            cacheStrategy: "hybrid",
          },
        },
      };
      await ensureKeyStore(cfg);
      await invalidateJwksCache(cfg);
      const a = await getJwksCached(cfg);
      assert.equal(a.ok, true);
      assert.ok(fs.existsSync(path.join(dir, "jwks-cache.json")));
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no dir and never writes home", async () => {
    const homeBefore = homeListing();
    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    // getJwksCached still rebuilds from the in-memory key store, but
    // writeCache no-ops so a second call cannot hit a persisted cache.
    const a = await getJwksCached({});
    assert.equal(a.ok, true);
    const inv = await invalidateJwksCache({});
    assert.equal(inv.ok, true);
    const b = await getJwksCached({});
    assert.equal(b.ok, true);
    assert.notEqual(b.cache, "hit");

    assert.equal(homeListing(), homeBefore, "no-configDir jwks cache wrote home");
    assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir jwks cache mkdir cwd/null");
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
    assert.match(slice, /cachePath/);
  });
});

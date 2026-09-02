/**
 * key-rotation.json must live in the config dir that owns the instance.
 *
 * `paths()` resolved `~/.xclaw/key-rotation.json` from `os.homedir()`
 * while production writers (`ensureKeyStore(cfg)` at jwks.mjs:96 from
 * `getJwksCached(cfg)` / `exportJwks(cfg)` at gateway/routes/jwks.mjs:21-25
 * via `tryHandleJwksRoute({ cfg })`) already had cfg in scope. Two
 * consequences, same class as v3.297.0 alert-state.json / v3.554.0
 * webauthn-credentials.json:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single key-rotation.json, so instance B restored
 *     instance A's signing keys / generation.
 *  2. The suite wrote into the operator's real `~/.xclaw`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `writeStore` still no-ops without
 * persisting (do not call durableAtomicWriteJson on null). `readStore`
 * returns null (same as missing file). Honour existing `XCLAW_CONFIG_DIR`.
 * Keep `cfg.auth?.keys?.storePath`. Keep `XCLAW_KEY_ROTATION` as strategy
 * env (not path). Keep `XCLAW_KEY_SECRET` / `XCLAW_SESSION_SECRET` as
 * encryption secrets (not path). No new env.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  ensureKeyStore,
  rotateKeys,
  keyRotationStatus,
} from "../src/auth/key-rotation.mjs";

const HOME_KR = path.join(os.homedir(), ".xclaw", "key-rotation.json");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-kr-cfg-"));
}

function homeListing() {
  try {
    return fs.readFileSync(HOME_KR, "utf8");
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
    new URL("../src/auth/key-rotation.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("function paths");
  const end = src.indexOf("function policy");
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
        ...extra,
      },
    },
  };
}

describe("key rotation follows paths.configDir", () => {
  after(() => {
    restoreEnv("XCLAW_CONFIG_DIR", SAVED_CONFIG_DIR);
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = pinCfg(dir);
    const st = await ensureKeyStore(cfg);
    assert.equal(st.generation, 1);
    const fp = path.join(dir, "key-rotation.json");
    assert.ok(fs.existsSync(fp), "key store did not land in paths.configDir");
    assert.notEqual(fp, HOME_KR);
  });

  test("a write lands in the config dir and never touches the home key-rotation file", async () => {
    const dir = await tmpDir();
    const homeBefore = homeListing();

    const cfg = pinCfg(dir);
    await ensureKeyStore(cfg);
    const r = await rotateKeys(cfg, { reason: "pin" });
    assert.equal(r.ok, true);
    assert.equal(r.action, "rotated");

    const stateFp = path.join(dir, "key-rotation.json");
    assert.ok(fs.existsSync(stateFp), "key-rotation.json did not persist into paths.configDir");
    const body = fs.readFileSync(stateFp, "utf8");
    assert.match(body, /"generation":/);
    assert.match(body, /"kid":/);

    assert.equal(homeListing(), homeBefore, "key-rotation wrote a home store");
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
        },
      };
      const st = await ensureKeyStore(cfg);
      assert.equal(st.generation, 1);
      assert.ok(fs.existsSync(path.join(dir, "key-rotation.json")));
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no dir and never writes home", async () => {
    const homeBefore = homeListing();
    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    // ensureKeyStore still returns in-memory generation 1, but writeStore
    // no-ops so keyRotationStatus cannot find a persisted store.
    const st = await ensureKeyStore({});
    assert.equal(st.generation, 1);
    const status = await keyRotationStatus({});
    assert.equal(status.initialized, false);

    const r = await rotateKeys({}, { reason: "pin-null" });
    assert.equal(r.ok, true);
    assert.equal(r.action, "rotated");

    assert.equal(homeListing(), homeBefore, "no-configDir key-rotation wrote home");
    assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir key-rotation mkdir cwd/null");
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
    assert.match(slice, /storePath/);
  });
});

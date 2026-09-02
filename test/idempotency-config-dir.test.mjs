/**
 * idempotency.json must live in the config dir that owns the instance.
 *
 * `paths()` resolved `~/.xclaw/idempotency.json` from `os.homedir()`
 * while the production writer (`withIdempotency(cfg)` at
 * jwks-invalidation.mjs:260 from `applyRemoteInvalidation(cfg)`, itself
 * called from `handleInvalidationHttp(cfg)` at gateway/routes/jwks.mjs:57)
 * already had cfg in scope. Two consequences, same class as v3.297.0
 * alert-state.json / v3.557.0 jwks-invalidation-epoch.json:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single idempotency.json, so instance B replayed instance A's
 *     JWKS invalidation as already-applied.
 *  2. The suite wrote into the operator's real `~/.xclaw`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `writeStore` still no-ops without
 * persisting (do not call durableAtomicWriteJson on null). `readStore`
 * returns the empty default (same as missing file). Honour existing
 * `XCLAW_CONFIG_DIR`. Keep `cfg.auth?.idempotency?.storePath`. Keep
 * `XCLAW_IDEMPOTENCY_ON_IN_PROGRESS` as strategy env (not path). No new env.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  withIdempotency,
  clearIdempotencyStore,
} from "../src/auth/idempotency.mjs";

const HOME_STORE = path.join(os.homedir(), ".xclaw", "idempotency.json");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-idem-cfg-"));
}

function homeListing() {
  try {
    return fs.readFileSync(HOME_STORE, "utf8");
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
    new URL("../src/auth/idempotency.mjs", import.meta.url),
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
      idempotency: {
        ttlMs: 60_000,
        onInProgress: "reject",
        ...extra,
      },
    },
  };
}

describe("idempotency store follows paths.configDir", () => {
  after(() => {
    restoreEnv("XCLAW_CONFIG_DIR", SAVED_CONFIG_DIR);
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = pinCfg(dir);
    const a = await withIdempotency(cfg, "pin-1", async () => ({ ok: true, n: 1 }));
    assert.equal(a.ok, true);
    const fp = path.join(dir, "idempotency.json");
    assert.ok(fs.existsSync(fp), "idempotency store did not land in paths.configDir");
    assert.notEqual(fp, HOME_STORE);
  });

  test("a write lands in the config dir and never touches the home store", async () => {
    const dir = await tmpDir();
    const homeBefore = homeListing();

    const cfg = pinCfg(dir);
    let n = 0;
    const a = await withIdempotency(cfg, "pin-write", async () => {
      n++;
      return { ok: true, n };
    });
    const b = await withIdempotency(cfg, "pin-write", async () => {
      n++;
      return { ok: true, n };
    });
    assert.equal(n, 1);
    assert.equal(a.n, 1);
    assert.equal(b.n, 1);
    assert.equal(b._replay, true);

    const stateFp = path.join(dir, "idempotency.json");
    assert.ok(
      fs.existsSync(stateFp),
      "idempotency.json did not persist into paths.configDir"
    );
    const body = fs.readFileSync(stateFp, "utf8");
    assert.match(body, /"records":/);
    assert.match(body, /pin-write/);

    assert.equal(homeListing(), homeBefore, "idempotency wrote a home store");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      const cfg = {
        auth: {
          idempotency: {
            ttlMs: 60_000,
          },
        },
      };
      const a = await withIdempotency(cfg, "env-1", async () => ({ ok: true }));
      assert.equal(a.ok, true);
      assert.ok(fs.existsSync(path.join(dir, "idempotency.json")));
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no dir and never writes home", async () => {
    const homeBefore = homeListing();
    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    // withIdempotency still runs the fn (in-memory claim), but writeStore
    // no-ops so a second call cannot replay.
    let n = 0;
    const a = await withIdempotency({}, "null-path", async () => {
      n++;
      return { ok: true, n };
    });
    assert.equal(a.ok, true);
    assert.equal(a.n, 1);
    const b = await withIdempotency({}, "null-path", async () => {
      n++;
      return { ok: true, n };
    });
    assert.equal(b.ok, true);
    assert.equal(n, 2);
    assert.notEqual(b._replay, true);

    const cleared = await clearIdempotencyStore({});
    assert.equal(cleared.ok, true);

    assert.equal(homeListing(), homeBefore, "no-configDir idempotency wrote home");
    assert.equal(
      fs.existsSync(cwdNull),
      cwdBefore,
      "no-configDir idempotency mkdir cwd/null"
    );
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

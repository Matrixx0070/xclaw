/**
 * jwks-invalidation-epoch.json must live in the config dir that owns the instance.
 *
 * `paths()` resolved `~/.xclaw/jwks-invalidation-epoch.json` from `os.homedir()`
 * while production writers (`publishJwksInvalidation(cfg)` at jwks.mjs:360 from
 * `refreshJwksAfterRotation(cfg)` AND `handleInvalidationHttp(cfg)` at
 * gateway/routes/jwks.mjs:57) already had cfg in scope. Two consequences,
 * same class as v3.297.0 alert-state.json / v3.556.0 jwks-cache.json:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single jwks-invalidation-epoch.json, so instance B treated
 *     instance A's rotation as its own epoch advance.
 *  2. The suite wrote into the operator's real `~/.xclaw`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `writeEpoch` still no-ops without
 * persisting (do not call durableAtomicWriteJson on null). `readEpoch`
 * returns the empty default (same as missing file). Honour existing
 * `XCLAW_CONFIG_DIR`. Keep `cfg.auth?.jwks?.invalidationEpochPath`. Keep
 * `XCLAW_JWKS_INVALIDATION_WEBHOOKS` as webhook URLs (not path). No new env.
 *
 * Do not call `applyRemoteInvalidation({})` from the null-path test —
 * that uses withIdempotency from idempotency.mjs which still homes.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  publishJwksInvalidation,
  getInvalidationEpoch,
} from "../src/auth/jwks-invalidation.mjs";

const HOME_EPOCH = path.join(
  os.homedir(),
  ".xclaw",
  "jwks-invalidation-epoch.json"
);
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-jinv-cfg-"));
}

function homeListing() {
  try {
    return fs.readFileSync(HOME_EPOCH, "utf8");
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
    new URL("../src/auth/jwks-invalidation.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("function paths");
  const end = src.indexOf("function invPolicy");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

function pinCfg(dir, extra = {}) {
  return {
    paths: { configDir: dir },
    auth: {
      jwks: {
        distributedInvalidation: true,
        ...extra,
      },
    },
  };
}

describe("jwks invalidation epoch follows paths.configDir", () => {
  after(() => {
    restoreEnv("XCLAW_CONFIG_DIR", SAVED_CONFIG_DIR);
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = pinCfg(dir);
    const a = await publishJwksInvalidation(cfg, { reason: "pin" });
    assert.equal(a.ok, true);
    assert.equal(a.epoch, 1);
    const fp = path.join(dir, "jwks-invalidation-epoch.json");
    assert.ok(fs.existsSync(fp), "epoch did not land in paths.configDir");
    assert.notEqual(fp, HOME_EPOCH);
  });

  test("a write lands in the config dir and never touches the home epoch file", async () => {
    const dir = await tmpDir();
    const homeBefore = homeListing();

    const cfg = pinCfg(dir);
    const a = await publishJwksInvalidation(cfg, { reason: "pin-write" });
    assert.equal(a.ok, true);
    const b = await publishJwksInvalidation(cfg, { reason: "pin-write-2" });
    assert.equal(b.epoch, 2);

    const stateFp = path.join(dir, "jwks-invalidation-epoch.json");
    assert.ok(
      fs.existsSync(stateFp),
      "jwks-invalidation-epoch.json did not persist into paths.configDir"
    );
    const body = fs.readFileSync(stateFp, "utf8");
    assert.match(body, /"epoch":/);
    assert.match(body, /"reason":/);

    const epoch = await getInvalidationEpoch(cfg);
    assert.equal(epoch.epoch, 2);

    assert.equal(homeListing(), homeBefore, "jwks invalidation wrote a home store");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      const cfg = {
        auth: {
          jwks: {
            distributedInvalidation: true,
          },
        },
      };
      const a = await publishJwksInvalidation(cfg, { reason: "env" });
      assert.equal(a.ok, true);
      assert.ok(fs.existsSync(path.join(dir, "jwks-invalidation-epoch.json")));
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no dir and never writes home", async () => {
    const homeBefore = homeListing();
    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    // publish still increments in-memory from emptyEpoch, but writeEpoch
    // no-ops so getInvalidationEpoch cannot observe the new epoch.
    const a = await publishJwksInvalidation({}, { reason: "null-path" });
    assert.equal(a.ok, true);
    assert.equal(a.epoch, 1);
    const epoch = await getInvalidationEpoch({});
    assert.equal(epoch.epoch, 0);

    assert.equal(
      homeListing(),
      homeBefore,
      "no-configDir jwks invalidation wrote home"
    );
    assert.equal(
      fs.existsSync(cwdNull),
      cwdBefore,
      "no-configDir jwks invalidation mkdir cwd/null"
    );
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
    assert.match(slice, /epochPath/);
  });
});

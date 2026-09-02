/**
 * fingerprint-rotation.json must live in the config dir that owns the instance.
 *
 * `fpPaths()` resolved `~/.xclaw/fingerprint-rotation.json` from
 * `os.homedir()` while production writers (`rotateFingerprint(cfg)` via
 * `runAuthCli(cfg)` at bin/xclaw.mjs:49-53 after `loadConfig()`,
 * auth-cli.mjs:162) already had cfg in scope. Two consequences, same
 * class as v3.297.0 alert-state.json / v3.552.0 cookie-rotation.json:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single fingerprint-rotation.json, so instance B restored
 *     instance A's binding salt / generation.
 *  2. The suite wrote into the operator's real `~/.xclaw`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `writeFpState` still no-ops without
 * persisting (do not `mkdir(null)`). `readFpState` returns the empty
 * default. Honour existing `XCLAW_CONFIG_DIR`. Keep
 * `cfg.auth?.web?.fingerprintStatePath`. No new env.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { importWebSession } from "../src/auth/web-login.mjs";
import {
  ensureFingerprintBinding,
  rotateFingerprint,
} from "../src/auth/fingerprint-rotation.mjs";

const HOME_FP = path.join(os.homedir(), ".xclaw", "fingerprint-rotation.json");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-fp-cfg-"));
}

function homeListing() {
  try {
    return fs.readFileSync(HOME_FP, "utf8");
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
    new URL("../src/auth/fingerprint-rotation.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("function fpPaths");
  const end = src.indexOf("function emptyFpState");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

function pinCfg(dir, extra = {}) {
  return {
    paths: { configDir: dir },
    auth: {
      web: {
        sessionSecret: "fp-test-secret-16chars",
        ...extra,
      },
    },
  };
}

describe("fingerprint rotation follows paths.configDir", () => {
  after(() => {
    restoreEnv("XCLAW_CONFIG_DIR", SAVED_CONFIG_DIR);
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = pinCfg(dir);
    await importWebSession(cfg, { cookie: "session=pin-resolve" });
    const b = await ensureFingerprintBinding(cfg);
    assert.equal(b.ok, true);
    const fp = path.join(dir, "fingerprint-rotation.json");
    assert.ok(fs.existsSync(fp), "fingerprint state did not land in paths.configDir");
    assert.notEqual(fp, HOME_FP);
  });

  test("a write lands in the config dir and never touches the home fingerprint file", async () => {
    const dir = await tmpDir();
    const homeBefore = homeListing();

    const cfg = pinCfg(dir);
    await importWebSession(cfg, { cookie: "session=pin-job" });
    await ensureFingerprintBinding(cfg);
    const r = await rotateFingerprint(cfg, { mode: "salt" });
    assert.equal(r.ok, true);

    const stateFp = path.join(dir, "fingerprint-rotation.json");
    assert.ok(fs.existsSync(stateFp), "fingerprint-rotation.json did not persist into paths.configDir");
    const body = fs.readFileSync(stateFp, "utf8");
    assert.match(body, /"generation":/);
    assert.match(body, /"salt":/);

    assert.equal(homeListing(), homeBefore, "fingerprint-rotation wrote a home store");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      const cfg = {
        auth: {
          web: {
            sessionSecret: "fp-test-secret-16chars",
          },
        },
      };
      await importWebSession(cfg, { cookie: "session=pin-env" });
      const b = await ensureFingerprintBinding(cfg);
      assert.equal(b.ok, true);
      assert.ok(fs.existsSync(path.join(dir, "fingerprint-rotation.json")));
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no dir and never writes home", async () => {
    const homeBefore = homeListing();
    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    const r = await rotateFingerprint({}, { mode: "salt" });
    assert.equal(r.ok, true);
    const b = await ensureFingerprintBinding({});
    assert.equal(b.ok, false);

    assert.equal(homeListing(), homeBefore, "no-configDir fingerprint-rotation wrote home");
    assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir fingerprint-rotation mkdir cwd/null");
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
    assert.match(slice, /fingerprintStatePath/);
  });
});

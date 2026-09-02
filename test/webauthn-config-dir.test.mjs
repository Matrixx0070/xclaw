/**
 * webauthn-credentials.json must live in the config dir that owns the instance.
 *
 * `waPaths()` resolved `~/.xclaw/webauthn-credentials.json` from
 * `os.homedir()` while production writers (`completeRegistration(cfg)` /
 * `completeAssertion(cfg)` / `markWebAuthnRequiredAfterRotate(cfg)` via
 * `runAuthCli(cfg)` at bin/xclaw.mjs:49-53 after `loadConfig()`,
 * auth-cli.mjs:191/201/164) already had cfg in scope. Two consequences,
 * same class as v3.297.0 alert-state.json / v3.553.0 fingerprint-rotation.json:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single webauthn-credentials.json, so instance B restored
 *     instance A's credentials / lastAssertAt.
 *  2. The suite wrote into the operator's real `~/.xclaw`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `writeStore` still no-ops without
 * persisting (do not `mkdir(null)`). `readStore` returns the empty
 * default. Honour existing `XCLAW_CONFIG_DIR`. Keep
 * `cfg.auth?.webauthn?.storePath`. Keep `XCLAW_WEBAUTHN_RP_ID` /
 * `XCLAW_WEBAUTHN_ORIGIN` as RP/origin config (not path). No new env.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createRegistrationOptions,
  completeRegistration,
} from "../src/auth/webauthn.mjs";

const HOME_WA = path.join(os.homedir(), ".xclaw", "webauthn-credentials.json");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-wa-cfg-"));
}

function homeListing() {
  try {
    return fs.readFileSync(HOME_WA, "utf8");
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
    new URL("../src/auth/webauthn.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("function waPaths");
  const end = src.indexOf("function waCfg");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

function pinCfg(dir, extra = {}) {
  return {
    paths: { configDir: dir },
    auth: {
      webauthn: {
        rpId: "localhost",
        origin: "https://localhost",
        ...extra,
      },
    },
  };
}

async function registerOnce(cfg, id) {
  const reg = await createRegistrationOptions(cfg);
  return completeRegistration(cfg, {
    id,
    clientDataJSON: Buffer.from(
      JSON.stringify({
        type: "webauthn.create",
        challenge: reg.publicKey.challenge,
        origin: "https://localhost",
      })
    ).toString("base64url"),
  });
}

describe("webauthn follows paths.configDir", () => {
  after(() => {
    restoreEnv("XCLAW_CONFIG_DIR", SAVED_CONFIG_DIR);
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = pinCfg(dir);
    const r = await registerOnce(cfg, "cred-pin-resolve");
    assert.equal(r.ok, true, r.error);
    const fp = path.join(dir, "webauthn-credentials.json");
    assert.ok(fs.existsSync(fp), "webauthn store did not land in paths.configDir");
    assert.notEqual(fp, HOME_WA);
  });

  test("a write lands in the config dir and never touches the home webauthn file", async () => {
    const dir = await tmpDir();
    const homeBefore = homeListing();

    const cfg = pinCfg(dir);
    const r = await registerOnce(cfg, "cred-pin-job");
    assert.equal(r.ok, true, r.error);

    const stateFp = path.join(dir, "webauthn-credentials.json");
    assert.ok(fs.existsSync(stateFp), "webauthn-credentials.json did not persist into paths.configDir");
    const body = fs.readFileSync(stateFp, "utf8");
    assert.match(body, /"credentials":/);
    assert.match(body, /cred-pin-job/);

    assert.equal(homeListing(), homeBefore, "webauthn wrote a home store");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      const cfg = {
        auth: {
          webauthn: {
            rpId: "localhost",
            origin: "https://localhost",
          },
        },
      };
      const r = await registerOnce(cfg, "cred-pin-env");
      assert.equal(r.ok, true, r.error);
      assert.ok(fs.existsSync(path.join(dir, "webauthn-credentials.json")));
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no dir and never writes home", async () => {
    const homeBefore = homeListing();
    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    // createRegistrationOptions still returns a challenge, but writeStore
    // no-ops so completeRegistration cannot find pendingRegistration.
    const r = await registerOnce({}, "cred-pin-null");
    assert.equal(r.ok, false);
    assert.match(String(r.error), /no pending registration/);

    assert.equal(homeListing(), homeBefore, "no-configDir webauthn wrote home");
    assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir webauthn mkdir cwd/null");
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

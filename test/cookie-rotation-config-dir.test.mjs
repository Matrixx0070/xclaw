/**
 * cookie-rotation.json must live in the config dir that owns the instance.
 *
 * `rotationPaths()` resolved `~/.xclaw/cookie-rotation.json` from
 * `os.homedir()` while production writers (`rotateWebSession(cfg)` via
 * `runAuthCli(cfg)` at bin/xclaw.mjs:49-53 after `loadConfig()`,
 * auth-cli.mjs:123) already had cfg in scope. Two consequences, same
 * class as v3.297.0 alert-state.json / v3.551.0 web-session.json:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single cookie-rotation.json, so instance B restored
 *     instance A's rotation generation / use-count.
 *  2. The suite wrote into the operator's real `~/.xclaw`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `writeState` still no-ops without
 * persisting (do not `mkdir(null)`). `readState` returns the empty
 * default. Honour existing `XCLAW_CONFIG_DIR`. Keep
 * `cfg.auth?.web?.rotationStatePath` / `previousSessionPath`. Keep
 * `XCLAW_COOKIE_ROTATION` as the strategy env (not a path). No new env.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { importWebSession } from "../src/auth/web-login.mjs";
import {
  bindAfterImport,
  rotateWebSession,
} from "../src/auth/cookie-rotation.mjs";

const HOME_STATE = path.join(os.homedir(), ".xclaw", "cookie-rotation.json");
const HOME_PREV = path.join(os.homedir(), ".xclaw", "web-session.prev.json");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-cookie-rot-cfg-"));
}

function homeListing() {
  return {
    state: (() => {
      try {
        return fs.readFileSync(HOME_STATE, "utf8");
      } catch {
        return null;
      }
    })(),
    prev: fs.existsSync(HOME_PREV),
  };
}

function restoreEnv(key, saved) {
  if (saved === undefined) delete process.env[key];
  else process.env[key] = saved;
}

function resolverSlice() {
  const src = fs.readFileSync(
    new URL("../src/auth/cookie-rotation.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("function rotationPaths");
  const end = src.indexOf("function rotationCfg");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

function pinCfg(dir, extra = {}) {
  return {
    paths: { configDir: dir },
    auth: {
      web: {
        sessionSecret: "rotation-test-secret-16+",
        rotationStrategy: "dual_slot",
        ...extra,
      },
    },
  };
}

describe("cookie rotation follows paths.configDir", () => {
  after(() => {
    restoreEnv("XCLAW_CONFIG_DIR", SAVED_CONFIG_DIR);
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = pinCfg(dir);
    await importWebSession(cfg, { cookie: "session=pin-resolve" });
    await bindAfterImport(cfg);
    const fp = path.join(dir, "cookie-rotation.json");
    assert.ok(fs.existsSync(fp), "rotation state did not land in paths.configDir");
    assert.notEqual(fp, HOME_STATE);
  });

  test("a write lands in the config dir and never touches the home rotation files", async () => {
    const dir = await tmpDir();
    const homeBefore = homeListing();

    const cfg = pinCfg(dir);
    await importWebSession(cfg, { cookie: "session=pin-job" });
    await bindAfterImport(cfg);
    const r = await rotateWebSession(cfg, { keepPrevious: true });
    assert.equal(r.ok, true);
    assert.equal(r.generation, 1);

    const stateFp = path.join(dir, "cookie-rotation.json");
    assert.ok(fs.existsSync(stateFp), "cookie-rotation.json did not persist into paths.configDir");
    const body = fs.readFileSync(stateFp, "utf8");
    assert.match(body, /"generation": 1/);
    const prevFp = path.join(dir, "web-session.prev.json");
    assert.ok(fs.existsSync(prevFp), "web-session.prev.json did not persist into paths.configDir");

    assert.deepEqual(homeListing(), homeBefore, "cookie-rotation wrote a home store");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      const cfg = {
        auth: {
          web: {
            sessionSecret: "rotation-test-secret-16+",
            rotationStrategy: "budget",
          },
        },
      };
      await importWebSession(cfg, { cookie: "session=pin-env" });
      await bindAfterImport(cfg);
      assert.ok(fs.existsSync(path.join(dir, "cookie-rotation.json")));
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no dir and never writes home", async () => {
    const homeBefore = homeListing();
    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    const r = await rotateWebSession({}, { keepPrevious: true });
    assert.equal(r.ok, true);
    await bindAfterImport({});

    assert.deepEqual(homeListing(), homeBefore, "no-configDir cookie-rotation wrote home");
    assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir cookie-rotation mkdir cwd/null");
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
    assert.match(slice, /rotationStatePath/);
  });
});

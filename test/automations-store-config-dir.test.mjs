/**
 * automations.json must live in the config dir that owns the instance.
 *
 * `automationsPath()` resolved `~/.xclaw/automations.json` from
 * `os.homedir()` while production `hydrateAutomations(cfg)` at gateway
 * boot already had cfg in scope. `loadConfig()` stamps `paths.configDir`
 * unconditionally and does not stamp `automationsFile`, so the resolver
 * still homed. Two consequences, same class as v3.297.0 alert-state.json:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single automations.json, so instance B's definitions and
 *     results mixed with instance A's.
 *  2. The suite wrote into the operator's real `~/.xclaw/automations.json`.
 *
 * Home fallback is refused. A cfg without configDir is never a real
 * caller. Such a store stays in memory and names no path. Honour
 * `XCLAW_AUTOMATIONS_FILE` (it exists). Production already threads cfg
 * so live still persists under configDir.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  automationsPath,
  loadStore,
  saveStore,
  withStoreLock,
} from "../src/automations/store.mjs";

const HOME_FILE = path.join(os.homedir(), ".xclaw", "automations.json");
const SAVED_AUTOMATIONS_FILE = process.env.XCLAW_AUTOMATIONS_FILE;
delete process.env.XCLAW_AUTOMATIONS_FILE;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-auto-cfg-"));
}

describe("automations store follows paths.configDir", () => {
  after(() => {
    if (SAVED_AUTOMATIONS_FILE === undefined) delete process.env.XCLAW_AUTOMATIONS_FILE;
    else process.env.XCLAW_AUTOMATIONS_FILE = SAVED_AUTOMATIONS_FILE;
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(automationsPath(cfg), path.join(dir, "automations.json"));
    assert.notEqual(automationsPath(cfg), HOME_FILE);
  });

  test("a write lands in the config dir and never touches the home file", async () => {
    const dir = await tmpDir();
    const homeBefore = fs.existsSync(HOME_FILE)
      ? fs.readFileSync(HOME_FILE)
      : null;

    const cfg = { paths: { configDir: dir } };
    const store = loadStore(cfg);
    store.automations.push({ id: "a1", name: "pin" });
    const written = saveStore(cfg, store);
    assert.equal(written, path.join(dir, "automations.json"));
    const onDisk = JSON.parse(fs.readFileSync(written, "utf8"));
    assert.equal(onDisk.automations[0].id, "a1");

    const homeAfter = fs.existsSync(HOME_FILE)
      ? fs.readFileSync(HOME_FILE)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "store wrote the home automations.json");
  });

  test("an explicit paths.automationsFile still wins over the config dir", async () => {
    const dir = await tmpDir();
    const explicit = path.join(dir, "custom-automations.json");
    const cfg = {
      paths: { configDir: dir, automationsFile: explicit },
    };
    assert.equal(automationsPath(cfg), explicit);
  });

  test("XCLAW_AUTOMATIONS_FILE wins over configDir", async () => {
    const dir = await tmpDir();
    const envFile = path.join(dir, "via-env.json");
    process.env.XCLAW_AUTOMATIONS_FILE = envFile;
    try {
      const cfg = { paths: { configDir: dir } };
      assert.equal(automationsPath(cfg), envFile);
    } finally {
      delete process.env.XCLAW_AUTOMATIONS_FILE;
    }
  });

  test("with no configDir there is NO home fallback — it names no file and never writes home", async () => {
    assert.equal(automationsPath({}), null);
    assert.equal(automationsPath(), null);
    assert.notEqual(automationsPath({}), HOME_FILE);

    const homeBefore = fs.existsSync(HOME_FILE)
      ? fs.readFileSync(HOME_FILE)
      : null;
    const cwdFile = path.join(process.cwd(), "automations.json");
    const cwdBefore = fs.existsSync(cwdFile);

    const store = loadStore({});
    assert.deepEqual(store.automations, []);
    store.automations.push({ id: "ghost" });
    assert.equal(saveStore({}, store), null);

    await withStoreLock({}, (s) => {
      s.automations.push({ id: "locked-ghost" });
    });

    const homeAfter = fs.existsSync(HOME_FILE)
      ? fs.readFileSync(HOME_FILE)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "no-configDir store wrote the home file");
    assert.equal(fs.existsSync(cwdFile), cwdBefore, "no-configDir store wrote cwd");
  });

  test("hydrateAutomations at gateway boot threads cfg", () => {
    const gw = fs.readFileSync(new URL("../src/gateway/index.mjs", import.meta.url), "utf8");
    assert.match(gw, /hydrateAutomations\(cfg\)/);
    const storeSrc = fs.readFileSync(new URL("../src/automations/store.mjs", import.meta.url), "utf8");
    assert.doesNotMatch(storeSrc, /os\.homedir\(\)/);
    assert.doesNotMatch(storeSrc, /defaultPath/);
  });
});

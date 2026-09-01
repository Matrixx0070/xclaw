/**
 * Pairing.json must live in the config dir that owns the instance.
 *
 * `defaultStorePath()` resolved `~/.xclaw/pairing.json` from `os.homedir()`
 * while production `createPairingStore({})` at gateway boot, security
 * pairing routes (recreate per request — the file is the only shared
 * state), doctor, and CLI already had cfg in scope and did not thread it.
 * Two consequences, same class as v3.297.0 alert-state.json:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single pairing.json, so instance B's approve/revoke mixed
 *     with instance A's.
 *  2. The suite wrote into the operator's real `~/.xclaw/pairing.json`.
 *     `test/pairing-routes.test.mjs` HOME-overrode because of this —
 *     that override is evidence of the leak, not a fix.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a store stays in memory and reports `storePath: null`.
 * Same shape as `defaultStatePath` in alerts.mjs. `pairingJsonFile` is
 * the same resolver so doctor-fix absorb cannot miss the live file.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createPairingStore,
  resolvePairingStorePath,
} from "../src/pairing/pairing-store.mjs";
import { pairingJsonFile } from "../src/state/control-plane.mjs";

const HOME_PAIRING = path.join(os.homedir(), ".xclaw", "pairing.json");
const SAVED_PAIRING_FILE = process.env.XCLAW_PAIRING_FILE;
delete process.env.XCLAW_PAIRING_FILE;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-pairing-cfg-"));
}

describe("pairing store follows paths.configDir", () => {
  after(() => {
    if (SAVED_PAIRING_FILE === undefined) delete process.env.XCLAW_PAIRING_FILE;
    else process.env.XCLAW_PAIRING_FILE = SAVED_PAIRING_FILE;
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(resolvePairingStorePath(cfg), path.join(dir, "pairing.json"));
    assert.equal(pairingJsonFile(cfg), path.join(dir, "pairing.json"));
    assert.equal(createPairingStore({ cfg }).storePath, path.join(dir, "pairing.json"));
    assert.notEqual(resolvePairingStorePath(cfg), HOME_PAIRING);
  });

  test("a write lands in the config dir and never touches the home file", async () => {
    const dir = await tmpDir();
    const homeBefore = fs.existsSync(HOME_PAIRING)
      ? fs.readFileSync(HOME_PAIRING)
      : null;

    const store = createPairingStore({ cfg: { paths: { configDir: dir } } });
    const req = store.upsertPairingRequest({ channel: "telegram", id: "555", meta: {} });
    assert.ok(req.code);

    const written = JSON.parse(
      fs.readFileSync(path.join(dir, "pairing.json"), "utf8")
    );
    assert.equal(
      written.channels.telegram.pending[0].id,
      "555",
      "store did not persist into paths.configDir"
    );

    const homeAfter = fs.existsSync(HOME_PAIRING)
      ? fs.readFileSync(HOME_PAIRING)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "store wrote the home pairing.json");
  });

  test("an explicit paths.pairingFile still wins over the config dir", async () => {
    const dir = await tmpDir();
    const explicit = path.join(dir, "custom-pairing.json");
    const cfg = {
      paths: { configDir: dir, pairingFile: explicit },
    };
    assert.equal(resolvePairingStorePath(cfg), explicit);
    assert.equal(pairingJsonFile(cfg), explicit);
    assert.equal(createPairingStore({ cfg }).storePath, explicit);
  });

  test("opts.storePath still wins over pairingFile and configDir", async () => {
    const dir = await tmpDir();
    const explicit = path.join(dir, "via-opts.json");
    const store = createPairingStore({
      storePath: explicit,
      cfg: { paths: { configDir: dir, pairingFile: path.join(dir, "ignored.json") } },
    });
    assert.equal(store.storePath, explicit);
  });

  test("with no configDir there is NO home fallback — it names no file and never writes home", async () => {
    assert.equal(resolvePairingStorePath({}), null);
    assert.equal(resolvePairingStorePath(), null);
    assert.equal(pairingJsonFile({}), null);
    assert.equal(createPairingStore({}).storePath, null);
    assert.notEqual(createPairingStore({}).storePath, HOME_PAIRING);

    const homeBefore = fs.existsSync(HOME_PAIRING)
      ? fs.readFileSync(HOME_PAIRING)
      : null;
    const store = createPairingStore({});
    const req = store.upsertPairingRequest({ channel: "telegram", id: "555", meta: {} });
    assert.ok(req.code, "in-memory store still issues a code");
    assert.equal(store.listPending("telegram").length, 1);
    const homeAfter = fs.existsSync(HOME_PAIRING)
      ? fs.readFileSync(HOME_PAIRING)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "no-configDir store wrote the home file");
  });
});

/**
 * accounts/ must live in the config dir that owns the instance.
 *
 * `accountsDir()` resolved `~/.xclaw/accounts` from `os.homedir()` while
 * production channel commands (`createPairingCode(cfg)` /
 * `consumePairingCode(cfg)` / `unlinkIdentity(cfg)`), auth-legacy CLI,
 * and doctor already had cfg in scope. Two consequences, same class as
 * v3.297.0 alert-state.json / v3.517.0 cost-governor.json:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared one links.json / pairing.json, so instance B's /link mixed
 *     with instance A's.
 *  2. The suite wrote into the operator's real `~/.xclaw/accounts`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `saveAccountStore` / `savePairing`
 * no-op a null path (do not `mkdir(null)`). Explicit `paths.accountsDir`
 * still wins. No new env.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  accountsDir,
  createAccount,
  loadAccountStore,
  createPairingCode,
  consumePairingCode,
} from "../src/connected/account-links.mjs";

const HOME_ACCOUNTS = path.join(os.homedir(), ".xclaw", "accounts");

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-acc-cfg-"));
}

function resolverSlice() {
  const src = fs.readFileSync(
    new URL("../src/connected/account-links.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("export function accountsDir");
  const end = src.indexOf("function linksPath");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

describe("account-links store follows paths.configDir", () => {
  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(accountsDir(cfg), path.join(dir, "accounts"));
    assert.notEqual(accountsDir(cfg), HOME_ACCOUNTS);
  });

  test("a write lands in the config dir and never touches the home file", async () => {
    const dir = await tmpDir();
    const homeBefore = fs.existsSync(HOME_ACCOUNTS)
      ? fs.readdirSync(HOME_ACCOUNTS)
      : null;

    const cfg = { paths: { configDir: dir } };
    const created = await createAccount(cfg, {
      primaryIdentity: "slack:U01PIN518",
      label: "pin-518",
    });
    assert.equal(created.ok, true);
    const store = await loadAccountStore(cfg);
    assert.ok(store.links["slack:U01PIN518"]);

    const raw = fs.readFileSync(path.join(dir, "accounts", "links.json"), "utf8");
    assert.ok(
      raw.includes("slack:U01PIN518"),
      "account-links did not persist into paths.configDir"
    );

    const homeAfter = fs.existsSync(HOME_ACCOUNTS)
      ? fs.readdirSync(HOME_ACCOUNTS)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "account-links wrote the home accounts dir");
  });

  test("an explicit paths.accountsDir still wins over the config dir", async () => {
    const dir = await tmpDir();
    const explicit = path.join(dir, "custom-accounts");
    const cfg = {
      paths: { configDir: dir, accountsDir: explicit },
    };
    assert.equal(accountsDir(cfg), explicit);
    const created = await createAccount(cfg, {
      primaryIdentity: "telegram:518explicit",
    });
    assert.equal(created.ok, true);
    assert.equal(fs.existsSync(path.join(dir, "accounts")), false);
    const raw = fs.readFileSync(path.join(explicit, "links.json"), "utf8");
    assert.ok(raw.includes("telegram:518explicit"));
  });

  test("with no configDir there is NO home fallback — it names no dir and never writes home", async () => {
    assert.equal(accountsDir({}), null);
    assert.equal(accountsDir(), null);
    assert.notEqual(accountsDir({}), HOME_ACCOUNTS);

    const homeBefore = fs.existsSync(HOME_ACCOUNTS)
      ? fs.readdirSync(HOME_ACCOUNTS)
      : null;

    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    const created = await createAccount({}, { primaryIdentity: "slack:U01MEM" });
    assert.equal(created.ok, true);
    const store = await loadAccountStore({});
    assert.equal(store.links["slack:U01MEM"], undefined, "null-path create must not persist");

    const issued = await createPairingCode({}, { channel: "slack", userId: "U01MEM" });
    assert.equal(issued.ok, true);
    const consumed = await consumePairingCode(
      {},
      issued.code,
      { channel: "telegram", userId: "999518" }
    );
    // pairingMem still holds the code in-process; consume may succeed in
    // memory. Disk must stay untouched either way.
    void consumed;

    const homeAfter = fs.existsSync(HOME_ACCOUNTS)
      ? fs.readdirSync(HOME_ACCOUNTS)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "no-configDir account-links wrote the home dir");
    assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir account-links mkdir cwd/null");
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /paths\?\.accountsDir/);
  });
});

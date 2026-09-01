/**
 * vault/<userId>/connected-tokens.json must live in the config dir that
 * owns the instance.
 *
 * `vaultRoot()` resolved `~/.xclaw/vault` from `os.homedir()` while
 * production writers (`vaultMergeIntoAccount(cfg)` at account-links /
 * `vaultDeleteApp(cfg)` at auth-legacy-cli) already had cfg in scope.
 * Two consequences, same class as v3.297.0 alert-state.json /
 * v3.523.0 connected-tokens.json:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single vault, so instance B's linked accounts used
 *     instance A's tokens.
 *  2. The suite wrote into the operator's real `~/.xclaw/vault/`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `vaultSave` no-ops a null path
 * (do not `mkdir(null)`). Honour existing `XCLAW_CONFIG_DIR`. No new env.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  vaultRoot,
  vaultLoad,
  vaultSave,
  vaultSetApp,
  vaultGetApp,
  vaultListUsers,
} from "../src/connected/vault.mjs";

const HOME_VAULT = path.join(os.homedir(), ".xclaw", "vault");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-vault-cfg-"));
}

function resolverSlice() {
  const src = fs.readFileSync(
    new URL("../src/connected/vault.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("export function vaultRoot");
  const end = src.indexOf("function userDir");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

describe("connected vault follows paths.configDir", () => {
  after(() => {
    if (SAVED_CONFIG_DIR === undefined) delete process.env.XCLAW_CONFIG_DIR;
    else process.env.XCLAW_CONFIG_DIR = SAVED_CONFIG_DIR;
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(vaultRoot(cfg), path.join(dir, "vault"));
    assert.notEqual(vaultRoot(cfg), HOME_VAULT);
  });

  test("a write lands in the config dir and never touches the home vault", async () => {
    const dir = await tmpDir();
    const homeBefore = fs.existsSync(HOME_VAULT)
      ? fs.readdirSync(HOME_VAULT)
      : null;

    const cfg = { paths: { configDir: dir } };
    await vaultSetApp(cfg, "alice", "github", { accessToken: "at-1", source: "pin" });
    const fp = path.join(dir, "vault", "alice", "connected-tokens.json");
    const raw = fs.readFileSync(fp, "utf8");
    assert.ok(raw.includes("at-1"), "vault did not persist into paths.configDir");
    const got = await vaultGetApp(cfg, "alice", "github");
    assert.equal(got.accessToken, "at-1");
    const st = fs.statSync(fp);
    assert.equal(st.mode & 0o777, 0o600);
    const users = await vaultListUsers(cfg);
    assert.ok(users.includes("alice"));

    const homeAfter = fs.existsSync(HOME_VAULT)
      ? fs.readdirSync(HOME_VAULT)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "vault wrote the home vault dir");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      assert.equal(vaultRoot({}), path.join(dir, "vault"));
      await vaultSetApp({}, "bob", "github", { accessToken: "at-env", source: "pin" });
      const raw = fs.readFileSync(
        path.join(dir, "vault", "bob", "connected-tokens.json"),
        "utf8"
      );
      assert.ok(raw.includes("at-env"));
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no file and never writes home", async () => {
    assert.equal(vaultRoot({}), null);
    assert.equal(vaultRoot(), null);
    assert.notEqual(vaultRoot({}), HOME_VAULT);

    const homeBefore = fs.existsSync(HOME_VAULT)
      ? fs.readdirSync(HOME_VAULT)
      : null;

    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    const saved = await vaultSave({}, "alice", { version: 1, apps: { github: { accessToken: "nope" } } });
    assert.equal(saved, null);
    await vaultSetApp({}, "alice", "github", { accessToken: "nope" });
    const loaded = await vaultLoad({}, "alice");
    assert.deepEqual(loaded, { version: 1, apps: {}, userId: "alice" });
    const users = await vaultListUsers({});
    assert.deepEqual(users, []);

    const homeAfter = fs.existsSync(HOME_VAULT)
      ? fs.readdirSync(HOME_VAULT)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "no-configDir vault wrote the home vault");
    assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir vault mkdir cwd/null");
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
  });
});

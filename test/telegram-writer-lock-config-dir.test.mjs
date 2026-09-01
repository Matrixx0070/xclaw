/**
 * telegram-writer.lock must live in the config dir that owns the instance.
 *
 * `acquireTelegramWriterLock()` resolved
 * `~/.xclaw/locks/telegram-writer.lock` from `os.homedir()` while
 * production `createTelegramChannel` already had cfg in scope and
 * passed `conf.writerLockPath` — when unset (normal), they homed.
 * Doctor independently homed the same path. `singleWriter !== false`
 * is default-ON. Two consequences, same class as v3.297.0
 * alert-state.json / v3.507.0 pairing.json / v3.508.0 sessions.json /
 * v3.509.0 cost-ledger.jsonl / v3.510.0 compact-offload:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single lock, so instance B could not start Telegram
 *     because A held it.
 *  2. The suite wrote into the operator's real
 *     `~/.xclaw/locks/telegram-writer.lock`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never
 * a real caller. Such a path is `null`. acquire no-ops a null path
 * (do not mkdir(null)). No lock-path env exists — do not invent one.
 * Production and doctor thread cfg so live still locks under configDir.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  defaultTelegramWriterLockPath,
  acquireTelegramWriterLock,
} from "../src/channels/telegram/webhook.mjs";

const HOME_LOCK = path.join(os.homedir(), ".xclaw", "locks", "telegram-writer.lock");

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-tg-lock-cfg-"));
}

function homeLockExists() {
  return fs.existsSync(HOME_LOCK);
}

describe("telegram writer lock follows paths.configDir", () => {
  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    const expected = path.join(dir, "locks", "telegram-writer.lock");
    assert.equal(defaultTelegramWriterLockPath({ cfg }), expected);
    assert.notEqual(defaultTelegramWriterLockPath({ cfg }), HOME_LOCK);
  });

  test("acquire with cfg writes the config dir and never touches the home dir", async () => {
    const dir = await tmpDir();
    const homeBefore = homeLockExists();
    const cfg = { paths: { configDir: dir } };
    const expected = path.join(dir, "locks", "telegram-writer.lock");

    const r = acquireTelegramWriterLock({ cfg });
    assert.equal(r.ok, true);
    assert.equal(r.lockPath, expected);
    assert.equal(r.skipped, undefined);
    assert.equal(fs.existsSync(expected), true);
    const body = JSON.parse(fs.readFileSync(expected, "utf8"));
    assert.equal(body.pid, process.pid);

    assert.equal(homeLockExists(), homeBefore, "acquire wrote the home telegram-writer.lock");
    r.release();
  });

  test("an explicit opts.lockPath still wins over the config dir", async () => {
    const dir = await tmpDir();
    const explicit = path.join(dir, "custom-writer.lock");
    const cfg = {
      paths: { configDir: dir },
      channels: { telegram: { writerLockPath: path.join(dir, "nested-writer.lock") } },
    };
    assert.equal(defaultTelegramWriterLockPath({ lockPath: explicit, cfg }), explicit);
  });

  test("nested channels.telegram.writerLockPath wins over configDir", async () => {
    const dir = await tmpDir();
    const nested = path.join(dir, "nested-writer.lock");
    const cfg = {
      paths: { configDir: dir },
      channels: { telegram: { writerLockPath: nested } },
    };
    assert.equal(defaultTelegramWriterLockPath({ cfg }), nested);
  });

  test("with no configDir there is NO home fallback — it names no file and never writes home", async () => {
    assert.equal(defaultTelegramWriterLockPath({}), null);
    assert.equal(defaultTelegramWriterLockPath(), null);
    assert.notEqual(defaultTelegramWriterLockPath({}), HOME_LOCK);

    const homeBefore = homeLockExists();
    const r = acquireTelegramWriterLock({});
    assert.equal(r.ok, true);
    assert.equal(r.lockPath, null);
    assert.equal(r.skipped, true);
    r.touch();
    r.release();

    assert.equal(homeLockExists(), homeBefore, "no-configDir acquire wrote the home lock");
  });
});

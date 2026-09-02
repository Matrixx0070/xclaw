/**
 * cron/jobs.sqlite and cron-jobs.json must live in the config dir that
 * owns the instance.
 *
 * `cronStoreRoot()` resolved `~/.xclaw` from `os.homedir()` while
 * production writers (`openCronLedger(cfg)` via `startCron(cfg)` at
 * bin/xclaw.mjs:209/255/2133 and gateway/index.mjs:1164, and
 * doctor-fix `openCronLedger(cfg)`) already had cfg in scope. Two
 * consequences, same class as v3.297.0 alert-state.json /
 * v3.549.0 tui-session.json:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single cron ledger, so instance B restored instance A's
 *     payload jobs.
 *  2. The suite wrote into the operator's real `~/.xclaw`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `openCronLedger` still returns
 * `null` without persisting (do not `mkdir(null)`). Honour existing
 * `XCLAW_CONFIG_DIR`. Keep extra env `XCLAW_CRON_LEDGER_FILE` /
 * `XCLAW_CRON_JOBS_FILE`. No new env.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  cronLedgerFile,
  legacyCronJsonFile,
  openCronLedger,
} from "../src/cron/durable-jobs.mjs";

const HOME_LEDGER = path.join(os.homedir(), ".xclaw", "cron", "jobs.sqlite");
const HOME_JSON = path.join(os.homedir(), ".xclaw", "cron-jobs.json");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-cron-ledger-cfg-"));
}

function homeListing() {
  return {
    ledger: fs.existsSync(HOME_LEDGER),
    json: fs.existsSync(HOME_JSON),
  };
}

function restoreEnv(key, saved) {
  if (saved === undefined) delete process.env[key];
  else process.env[key] = saved;
}

async function withoutCronEnv(fn) {
  const saved = {
    config: process.env.XCLAW_CONFIG_DIR,
    ledger: process.env.XCLAW_CRON_LEDGER_FILE,
    jobs: process.env.XCLAW_CRON_JOBS_FILE,
  };
  delete process.env.XCLAW_CONFIG_DIR;
  delete process.env.XCLAW_CRON_LEDGER_FILE;
  delete process.env.XCLAW_CRON_JOBS_FILE;
  try {
    return await fn();
  } finally {
    restoreEnv("XCLAW_CONFIG_DIR", saved.config);
    restoreEnv("XCLAW_CRON_LEDGER_FILE", saved.ledger);
    restoreEnv("XCLAW_CRON_JOBS_FILE", saved.jobs);
  }
}

function resolverSlice() {
  const src = fs.readFileSync(
    new URL("../src/cron/durable-jobs.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("function cronStoreRoot");
  const end = src.indexOf("export function openCronLedger");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

describe("cron ledger follows paths.configDir", () => {
  after(() => {
    restoreEnv("XCLAW_CONFIG_DIR", SAVED_CONFIG_DIR);
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    await withoutCronEnv(() => {
      const cfg = { paths: { configDir: dir } };
      assert.equal(cronLedgerFile(cfg), path.join(dir, "cron", "jobs.sqlite"));
      assert.equal(legacyCronJsonFile(cfg), path.join(dir, "cron-jobs.json"));
      assert.notEqual(cronLedgerFile(cfg), HOME_LEDGER);
      assert.notEqual(legacyCronJsonFile(cfg), HOME_JSON);
    });
  });

  test("a write lands in the config dir and never touches the home ledger", async () => {
    const dir = await tmpDir();
    await withoutCronEnv(async () => {
      const homeBefore = homeListing();

      const cfg = { paths: { configDir: dir } };
      const ledger = openCronLedger(cfg);
      assert.ok(ledger, "openCronLedger returned null with configDir set");
      try {
        ledger.put({ id: "pin-job", name: "pin", kind: "pin" });
        const listed = ledger.list();
        assert.equal(listed[0].id, "pin-job");
        assert.equal(listed[0].kind, "pin");
      } finally {
        ledger.close();
      }
      const fp = cronLedgerFile(cfg);
      assert.equal(fp, path.join(dir, "cron", "jobs.sqlite"));
      assert.ok(fs.existsSync(fp), "cron ledger did not persist into paths.configDir");

      assert.deepEqual(homeListing(), homeBefore, "cron ledger wrote a home store");
    });
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    await withoutCronEnv(async () => {
      process.env.XCLAW_CONFIG_DIR = dir;
      assert.equal(cronLedgerFile({}), path.join(dir, "cron", "jobs.sqlite"));
      assert.equal(legacyCronJsonFile({}), path.join(dir, "cron-jobs.json"));
      const ledger = openCronLedger({});
      assert.ok(ledger);
      try {
        ledger.put({ id: "pin-env", name: "pin-env" });
      } finally {
        ledger.close();
      }
      assert.ok(fs.existsSync(path.join(dir, "cron", "jobs.sqlite")));
    });
  });

  test("with no configDir there is NO home fallback — it names no dir and never writes home", async () => {
    await withoutCronEnv(async () => {
      assert.equal(cronLedgerFile({}), null);
      assert.equal(cronLedgerFile(), null);
      assert.equal(legacyCronJsonFile({}), null);
      assert.equal(legacyCronJsonFile(), null);
      assert.notEqual(cronLedgerFile({}), HOME_LEDGER);

      const homeBefore = homeListing();
      const cwdNull = path.join(process.cwd(), "null");
      const cwdBefore = fs.existsSync(cwdNull);

      assert.equal(openCronLedger({}), null);
      assert.equal(openCronLedger(undefined), null);

      assert.deepEqual(homeListing(), homeBefore, "no-configDir cron ledger wrote home");
      assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir cron ledger mkdir cwd/null");
    });
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
  });
});

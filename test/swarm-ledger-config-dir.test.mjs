/**
 * swarm-cost-ledger.json must live in the config dir that owns the instance.
 *
 * `ledgerPath()` resolved `~/.xclaw/swarm-cost-ledger.json` from
 * `os.homedir()` while production jobs (`reserveUsd(cfg)` /
 * `settleUsd(cfg)`), doctor, stop-health, and eval smoke already had
 * cfg in scope. Two consequences, same class as v3.297.0
 * alert-state.json / v3.518.0 accounts/:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single daily swarm cap, so instance B's children mixed
 *     with instance A's budget.
 *  2. The suite wrote into the operator's real `~/.xclaw/swarm-cost-ledger.json`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `save` no-ops a null path (do not
 * `mkdir(null)`). Honour existing `XCLAW_CONFIG_DIR`. No new env.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  ledgerPath,
  reserveUsd,
  settleUsd,
  ledgerSnapshot,
} from "../src/tokens/swarm-ledger.mjs";

const HOME_LEDGER = path.join(os.homedir(), ".xclaw", "swarm-cost-ledger.json");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-swarm-led-cfg-"));
}

function resolverSlice() {
  const src = fs.readFileSync(
    new URL("../src/tokens/swarm-ledger.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("export function ledgerPath");
  const end = src.indexOf("function load");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

describe("swarm-ledger follows paths.configDir", () => {
  after(() => {
    if (SAVED_CONFIG_DIR === undefined) delete process.env.XCLAW_CONFIG_DIR;
    else process.env.XCLAW_CONFIG_DIR = SAVED_CONFIG_DIR;
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(ledgerPath(cfg), path.join(dir, "swarm-cost-ledger.json"));
    assert.notEqual(ledgerPath(cfg), HOME_LEDGER);
  });

  test("a write lands in the config dir and never touches the home file", async () => {
    const dir = await tmpDir();
    const homeBefore = fs.existsSync(HOME_LEDGER)
      ? fs.readFileSync(HOME_LEDGER)
      : null;

    const cfg = { paths: { configDir: dir } };
    const res = reserveUsd(cfg, { swarmId: "s-pin-519", childId: "c1", usd: 1 });
    assert.equal(res.ok, true);
    const snap = ledgerSnapshot(cfg);
    assert.ok(snap.reservedUsd >= 1);
    settleUsd(cfg, { swarmId: "s-pin-519", childId: "c1", usd: 0.4 });
    const snap2 = ledgerSnapshot(cfg);
    assert.ok(snap2.spentUsd >= 0.4);

    const raw = fs.readFileSync(path.join(dir, "swarm-cost-ledger.json"), "utf8");
    assert.ok(
      raw.includes("s-pin-519"),
      "swarm-ledger did not persist into paths.configDir"
    );

    const homeAfter = fs.existsSync(HOME_LEDGER)
      ? fs.readFileSync(HOME_LEDGER)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "swarm-ledger wrote the home swarm-cost-ledger.json");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      assert.equal(ledgerPath({}), path.join(dir, "swarm-cost-ledger.json"));
      const res = reserveUsd({}, { swarmId: "s-pin-519-env", childId: "c1", usd: 0.2 });
      assert.equal(res.ok, true);
      const raw = fs.readFileSync(path.join(dir, "swarm-cost-ledger.json"), "utf8");
      assert.ok(raw.includes("s-pin-519-env"));
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no file and never writes home", async () => {
    assert.equal(ledgerPath({}), null);
    assert.equal(ledgerPath(), null);
    assert.notEqual(ledgerPath({}), HOME_LEDGER);

    const homeBefore = fs.existsSync(HOME_LEDGER)
      ? fs.readFileSync(HOME_LEDGER)
      : null;

    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    const snap = ledgerSnapshot({});
    assert.equal(snap.reservedUsd, 0);
    assert.equal(snap.spentUsd, 0);
    const res = reserveUsd({}, { swarmId: "s-pin-519-mem", childId: "c1", usd: 1 });
    assert.equal(res.ok, true);
    const snap2 = ledgerSnapshot({});
    assert.equal(snap2.reservedUsd, 0, "null-path reserve must not persist");
    settleUsd({}, { swarmId: "s-pin-519-mem", childId: "c1", usd: 0.5 });
    const snap3 = ledgerSnapshot({});
    assert.equal(snap3.spentUsd, 0, "null-path settle must not persist");

    const homeAfter = fs.existsSync(HOME_LEDGER)
      ? fs.readFileSync(HOME_LEDGER)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "no-configDir swarm-ledger wrote the home file");
    assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir swarm-ledger mkdir cwd/null");
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
  });
});

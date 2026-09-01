/**
 * cost-governor.json must live in the config dir that owns the instance.
 *
 * `ledgerPath()` resolved `~/.xclaw/cost-governor.json` from `os.homedir()`
 * while production loop / queue / doctor / tokens routes / role-router
 * already had cfg in scope. Two consequences, same class as v3.297.0
 * alert-state.json / v3.509.0 cost-ledger.jsonl:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single daily spend/pause latch, so instance B's jobs mixed
 *     with instance A's cap.
 *  2. The suite wrote into the operator's real `~/.xclaw/cost-governor.json`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `saveLedger` / `withLedgerLock`
 * no-op a null path (do not `mkdir(null)`). Explicit `cost.governorPath`
 * still wins. No new env.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  governorLedgerPath,
  recordJobCost,
  getCostGovernorStatus,
  setCostGovernorPaused,
} from "../src/tokens/cost-governor.mjs";

const HOME_LEDGER = path.join(os.homedir(), ".xclaw", "cost-governor.json");

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-gov-cfg-"));
}

function resolverSlice() {
  const src = fs.readFileSync(
    new URL("../src/tokens/cost-governor.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("export function governorLedgerPath");
  const end = src.indexOf("async function loadLedger");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

describe("cost-governor ledger follows paths.configDir", () => {
  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(governorLedgerPath(cfg), path.join(dir, "cost-governor.json"));
    assert.notEqual(governorLedgerPath(cfg), HOME_LEDGER);
  });

  test("a write lands in the config dir and never touches the home file", async () => {
    const dir = await tmpDir();
    const homeBefore = fs.existsSync(HOME_LEDGER)
      ? fs.readFileSync(HOME_LEDGER)
      : null;

    const cfg = { paths: { configDir: dir }, cost: { dailyHardUsd: 50 } };
    await recordJobCost(cfg, { usd: 1.25, jobId: "pin-517-write" });
    const st = await getCostGovernorStatus(cfg);
    assert.equal(st.spentUsd, 1.25);
    assert.equal(st.jobs, 1);

    const raw = fs.readFileSync(path.join(dir, "cost-governor.json"), "utf8");
    assert.ok(
      raw.includes("pin-517-write"),
      "governor did not persist into paths.configDir"
    );

    const homeAfter = fs.existsSync(HOME_LEDGER)
      ? fs.readFileSync(HOME_LEDGER)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "governor wrote the home cost-governor.json");
  });

  test("an explicit cost.governorPath still wins over the config dir", async () => {
    const dir = await tmpDir();
    const explicit = path.join(dir, "custom-governor.json");
    const cfg = {
      paths: { configDir: dir },
      cost: { governorPath: explicit, dailyHardUsd: 50 },
    };
    assert.equal(governorLedgerPath(cfg), explicit);
    await recordJobCost(cfg, { usd: 0.5, jobId: "pin-517-explicit" });
    assert.equal(fs.existsSync(path.join(dir, "cost-governor.json")), false);
    const raw = fs.readFileSync(explicit, "utf8");
    assert.ok(raw.includes("pin-517-explicit"));
  });

  test("with no configDir there is NO home fallback — it names no file and never writes home", async () => {
    assert.equal(governorLedgerPath({}), null);
    assert.equal(governorLedgerPath(), null);
    assert.notEqual(governorLedgerPath({}), HOME_LEDGER);

    const homeBefore = fs.existsSync(HOME_LEDGER)
      ? fs.readFileSync(HOME_LEDGER)
      : null;

    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    const st = await getCostGovernorStatus({});
    assert.equal(st.spentUsd, 0);
    await recordJobCost({}, { usd: 9.99, jobId: "pin-517-mem" });
    const st2 = await getCostGovernorStatus({});
    assert.equal(st2.spentUsd, 0, "null-path spend must not persist");
    await setCostGovernorPaused({}, true);
    const st3 = await getCostGovernorStatus({});
    assert.equal(st3.paused, false, "null-path pause must not persist");

    const homeAfter = fs.existsSync(HOME_LEDGER)
      ? fs.readFileSync(HOME_LEDGER)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "no-configDir governor wrote the home file");
    assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir governor mkdir cwd/null");
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /cost\?\.governorPath/);
  });
});

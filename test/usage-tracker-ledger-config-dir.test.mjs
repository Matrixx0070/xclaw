/**
 * cost-ledger.jsonl must live in the config dir that owns the instance.
 *
 * `defaultLedgerPath()` resolved `~/.xclaw/cost-ledger.jsonl` from
 * `os.homedir()` while production loop / maintenance / analytics /
 * tokens route / CLI already had cfg in scope and did
 * `cfg.tokens?.ledgerPath || defaultLedgerPath()` — when ledgerPath
 * unset (normal), they homed. Two consequences, same class as
 * v3.297.0 alert-state.json / v3.507.0 pairing.json / v3.508.0
 * sessions.json:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single cost-ledger.jsonl, so instance B's cost mixed
 *     with instance A's.
 *  2. The suite wrote into the operator's real `~/.xclaw/cost-ledger.jsonl`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never
 * a real caller. Such a path is `null`. persistLedger already no-ops
 * `!ledgerPath`. readCostLedger treats a falsy path like ENOENT.
 * No XCLAW_LEDGER_FILE — callers use `tokens.ledgerPath` only.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  defaultLedgerPath,
  createUsageTracker,
  readCostLedger,
} from "../src/tokens/usage-tracker.mjs";

const HOME_LEDGER = path.join(os.homedir(), ".xclaw", "cost-ledger.jsonl");

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-ledger-cfg-"));
}

describe("usage-tracker ledger follows paths.configDir", () => {
  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(defaultLedgerPath(cfg), path.join(dir, "cost-ledger.jsonl"));
    assert.notEqual(defaultLedgerPath(cfg), HOME_LEDGER);
  });

  test("a write lands in the config dir and never touches the home file", async () => {
    const dir = await tmpDir();
    const homeBefore = fs.existsSync(HOME_LEDGER)
      ? fs.readFileSync(HOME_LEDGER)
      : null;

    const ledgerPath = defaultLedgerPath({ paths: { configDir: dir } });
    const t = createUsageTracker({
      enabled: true,
      model: "pin-509",
      ledgerPath,
    });
    t.recordTurn({
      turn: 1,
      usage: { prompt_tokens: 10, completion_tokens: 4 },
    });
    const writtenPath = await t.persistLedger({ runId: "pin-509-write" });
    assert.equal(writtenPath, path.join(dir, "cost-ledger.jsonl"));

    const raw = fs.readFileSync(path.join(dir, "cost-ledger.jsonl"), "utf8");
    assert.ok(
      raw.includes("pin-509-write"),
      "tracker did not persist into paths.configDir"
    );

    const homeAfter = fs.existsSync(HOME_LEDGER)
      ? fs.readFileSync(HOME_LEDGER)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "tracker wrote the home cost-ledger.jsonl");
  });

  test("an explicit tokens.ledgerPath still wins over the config dir", async () => {
    const dir = await tmpDir();
    const explicit = path.join(dir, "custom-cost-ledger.jsonl");
    const cfg = {
      paths: { configDir: dir },
      tokens: { ledgerPath: explicit },
    };
    assert.equal(defaultLedgerPath(cfg), explicit);
  });

  test("with no configDir there is NO home fallback — it names no file and never writes home", async () => {
    assert.equal(defaultLedgerPath({}), null);
    assert.equal(defaultLedgerPath(), null);
    assert.notEqual(defaultLedgerPath({}), HOME_LEDGER);

    const homeBefore = fs.existsSync(HOME_LEDGER)
      ? fs.readFileSync(HOME_LEDGER)
      : null;

    const t = createUsageTracker({
      enabled: true,
      model: "pin-509-mem",
      ledgerPath: defaultLedgerPath({}),
    });
    t.recordTurn({
      turn: 1,
      usage: { prompt_tokens: 3, completion_tokens: 1 },
    });
    assert.equal(await t.persistLedger({ runId: "pin-509-mem" }), null);

    const empty = await readCostLedger(null);
    assert.equal(empty.runs, 0);
    assert.equal(empty.path, null);
    assert.deepEqual(empty.rows, []);

    const homeAfter = fs.existsSync(HOME_LEDGER)
      ? fs.readFileSync(HOME_LEDGER)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "no-configDir tracker wrote the home file");
  });
});

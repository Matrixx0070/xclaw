/**
 * eval-history.jsonl must live in the config dir that owns the instance.
 *
 * `historyPath()` resolved `~/.xclaw/eval-history.jsonl` from
 * `os.homedir()` while production writers (`appendEvalHistory(cfg)` at
 * eval/runner.mjs) already had cfg in scope.
 * Two consequences, same class as v3.297.0 alert-state.json /
 * v3.530.0 preferences.md:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single eval-history.jsonl, so instance B listed instance A's runs.
 *  2. The suite wrote into the operator's real `~/.xclaw/eval-history.jsonl`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `appendEvalHistory` still returns
 * the in-memory line without persisting (do not `mkdir(null)`).
 * Honour existing `XCLAW_CONFIG_DIR`. No new env.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  evalHistoryPath,
  appendEvalHistory,
  listEvalHistory,
} from "../src/eval/history.mjs";

const HOME_HIST = path.join(os.homedir(), ".xclaw", "eval-history.jsonl");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-eh-cfg-"));
}

function sampleReport(runId) {
  return {
    runId,
    passRate: 1,
    passed: 1,
    failed: 0,
    total: 1,
    meanTurns: 1,
    meanWallMs: 100,
    tokens: { total: 10 },
    cost: { usd: 0.01 },
    results: [{ model: "grok-4.3" }],
  };
}

function resolverSlice() {
  const src = fs.readFileSync(
    new URL("../src/eval/history.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("export function evalHistoryPath");
  const end = src.indexOf("export async function appendEvalHistory");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

describe("eval history follows paths.configDir", () => {
  after(() => {
    if (SAVED_CONFIG_DIR === undefined) delete process.env.XCLAW_CONFIG_DIR;
    else process.env.XCLAW_CONFIG_DIR = SAVED_CONFIG_DIR;
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(evalHistoryPath(cfg), path.join(dir, "eval-history.jsonl"));
    assert.notEqual(evalHistoryPath(cfg), HOME_HIST);
  });

  test("a write lands in the config dir and never touches the home history file", async () => {
    const dir = await tmpDir();
    const homeBefore = fs.existsSync(HOME_HIST);

    const cfg = { paths: { configDir: dir } };
    const rec = await appendEvalHistory(cfg, sampleReport("pin-configDir"));
    assert.equal(rec.runId, "pin-configDir");
    const fp = evalHistoryPath(cfg);
    const raw = fs.readFileSync(fp, "utf8");
    assert.ok(raw.includes("pin-configDir"), "eval history did not persist into paths.configDir");
    const listed = await listEvalHistory(cfg);
    assert.ok(listed.some((e) => e.runId === "pin-configDir"));

    assert.equal(fs.existsSync(HOME_HIST), homeBefore, "eval history wrote the home eval-history.jsonl");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      assert.equal(evalHistoryPath({}), path.join(dir, "eval-history.jsonl"));
      await appendEvalHistory({}, sampleReport("pin-env"));
      const raw = fs.readFileSync(evalHistoryPath({}), "utf8");
      assert.ok(raw.includes("pin-env"));
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no file and never writes home", async () => {
    assert.equal(evalHistoryPath({}), null);
    assert.equal(evalHistoryPath(), null);
    assert.notEqual(evalHistoryPath({}), HOME_HIST);

    const homeBefore = fs.existsSync(HOME_HIST);
    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    const rec = await appendEvalHistory({}, sampleReport("nope"));
    assert.equal(rec.runId, "nope");
    const listed = await listEvalHistory({});
    assert.deepEqual(listed, []);

    assert.equal(fs.existsSync(HOME_HIST), homeBefore, "no-configDir eval history wrote home eval-history.jsonl");
    assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir eval history mkdir cwd/null");
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
  });
});

/**
 * eval-quarantine.json must live in the config dir that owns the instance.
 *
 * `qPath()` resolved `~/.xclaw/eval-quarantine.json` from
 * `os.homedir()` while production writers (`recordCaseOutcome(cfg)` at
 * eval/runner.mjs) already had cfg in scope.
 * Two consequences, same class as v3.297.0 alert-state.json /
 * v3.532.0 skill-stats.json:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single eval-quarantine.json, so instance B listed instance A's flakes.
 *  2. The suite wrote into the operator's real `~/.xclaw/eval-quarantine.json`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `recordCaseOutcome` still returns
 * the in-memory case without persisting (do not `mkdir(null)`).
 * Honour existing `XCLAW_CONFIG_DIR`. No new env.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  evalQuarantinePath,
  recordCaseOutcome,
  listQuarantined,
  isQuarantined,
} from "../src/eval/quarantine.mjs";

const HOME_Q = path.join(os.homedir(), ".xclaw", "eval-quarantine.json");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-q-cfg-"));
}

function resolverSlice() {
  const src = fs.readFileSync(
    new URL("../src/eval/quarantine.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("export function evalQuarantinePath");
  const end = src.indexOf("export async function recordCaseOutcome");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

describe("eval quarantine follows paths.configDir", () => {
  after(() => {
    if (SAVED_CONFIG_DIR === undefined) delete process.env.XCLAW_CONFIG_DIR;
    else process.env.XCLAW_CONFIG_DIR = SAVED_CONFIG_DIR;
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(evalQuarantinePath(cfg), path.join(dir, "eval-quarantine.json"));
    assert.notEqual(evalQuarantinePath(cfg), HOME_Q);
  });

  test("a write lands in the config dir and never touches the home quarantine file", async () => {
    const dir = await tmpDir();
    const homeBefore = fs.existsSync(HOME_Q);

    const cfg = { paths: { configDir: dir }, eval: { quarantineFailThreshold: 2 } };
    const rec = await recordCaseOutcome(cfg, "pin-configDir", false);
    assert.equal(rec.fails, 1);
    const fp = evalQuarantinePath(cfg);
    const raw = fs.readFileSync(fp, "utf8");
    assert.ok(raw.includes("pin-configDir"), "eval quarantine did not persist into paths.configDir");
    assert.equal(await isQuarantined(cfg, "pin-configDir"), false);

    assert.equal(fs.existsSync(HOME_Q), homeBefore, "eval quarantine wrote the home eval-quarantine.json");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      assert.equal(evalQuarantinePath({}), path.join(dir, "eval-quarantine.json"));
      await recordCaseOutcome({}, "pin-env", true);
      const raw = fs.readFileSync(evalQuarantinePath({}), "utf8");
      assert.ok(raw.includes("pin-env"));
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no file and never writes home", async () => {
    assert.equal(evalQuarantinePath({}), null);
    assert.equal(evalQuarantinePath(), null);
    assert.notEqual(evalQuarantinePath({}), HOME_Q);

    const homeBefore = fs.existsSync(HOME_Q);
    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    const rec = await recordCaseOutcome({}, "nope", true);
    assert.equal(rec.passes, 1);
    const listed = await listQuarantined({});
    assert.deepEqual(listed, []);
    assert.equal(await isQuarantined({}, "nope"), false);

    assert.equal(fs.existsSync(HOME_Q), homeBefore, "no-configDir eval quarantine wrote home eval-quarantine.json");
    assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir eval quarantine mkdir cwd/null");
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
  });
});

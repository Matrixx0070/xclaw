/**
 * tui-session.json must live in the config dir that owns the instance.
 *
 * `tuiStatePath()` resolved `~/.xclaw/tui-session.json` from
 * `os.homedir()` while the production writer (`saveTuiState(cfg)` via
 * `runTui(cfg)` at bin/xclaw.mjs:2045 after `loadConfig()`) already had
 * cfg in scope. Two consequences, same class as v3.297.0 alert-state.json /
 * v3.548.0 skill-loop-metrics.jsonl:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single tui-session.json, so instance B restored instance A's
 *     TUI session.
 *  2. The suite wrote into the operator's real `~/.xclaw`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `saveTuiState` still no-ops without
 * persisting (do not `mkdir(null)`). `loadTuiState` returns `{}`.
 * Honour existing `XCLAW_CONFIG_DIR`. No new env.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  tuiStatePath,
  loadTuiState,
  saveTuiState,
} from "../src/cli/tui.mjs";

const HOME_TUI = path.join(os.homedir(), ".xclaw", "tui-session.json");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-tui-cfg-"));
}

function homeTuiListing() {
  try {
    return fs.readFileSync(HOME_TUI, "utf8");
  } catch {
    return null;
  }
}

function resolverSlice() {
  const src = fs.readFileSync(
    new URL("../src/cli/tui.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("export function tuiStatePath");
  const end = src.indexOf("export async function loadTuiState");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

describe("TUI session follows paths.configDir", () => {
  after(() => {
    if (SAVED_CONFIG_DIR === undefined) delete process.env.XCLAW_CONFIG_DIR;
    else process.env.XCLAW_CONFIG_DIR = SAVED_CONFIG_DIR;
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(tuiStatePath(cfg), path.join(dir, "tui-session.json"));
    assert.notEqual(tuiStatePath(cfg), HOME_TUI);
  });

  test("a write lands in the config dir and never touches the home tui-session file", async () => {
    const dir = await tmpDir();
    const homeBefore = homeTuiListing();

    const cfg = { paths: { configDir: dir } };
    await saveTuiState(cfg, { kind: "pin", sessionId: "pin-job" });
    const fp = tuiStatePath(cfg);
    assert.equal(fp, path.join(dir, "tui-session.json"));
    assert.ok(fs.existsSync(fp), "tui session did not persist into paths.configDir");
    const body = fs.readFileSync(fp, "utf8");
    assert.match(body, /"kind": "pin"/);
    assert.match(body, /"sessionId": "pin-job"/);
    const loaded = await loadTuiState(cfg);
    assert.equal(loaded.kind, "pin");
    assert.equal(loaded.sessionId, "pin-job");

    assert.equal(homeTuiListing(), homeBefore, "tui wrote the home tui-session file");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      assert.equal(tuiStatePath({}), path.join(dir, "tui-session.json"));
      await saveTuiState({}, { kind: "pin-env" });
      const fp = tuiStatePath({});
      assert.equal(fp, path.join(dir, "tui-session.json"));
      assert.ok(fs.existsSync(fp));
      const loaded = await loadTuiState({});
      assert.equal(loaded.kind, "pin-env");
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no dir and never writes home", async () => {
    assert.equal(tuiStatePath({}), null);
    assert.equal(tuiStatePath(), null);
    assert.notEqual(tuiStatePath({}), HOME_TUI);

    const homeBefore = homeTuiListing();
    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    assert.equal(await saveTuiState({}, { kind: "nope" }), undefined);
    assert.equal(await saveTuiState(undefined, { kind: "nope" }), undefined);
    assert.deepEqual(await loadTuiState({}), {});
    assert.deepEqual(await loadTuiState(), {});

    assert.equal(homeTuiListing(), homeBefore, "no-configDir tui wrote home tui-session");
    assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir tui mkdir cwd/null");
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
  });
});

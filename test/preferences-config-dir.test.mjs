/**
 * memory/preferences.md must live in the config dir that owns the instance.
 *
 * `memoryPath()` resolved `~/.xclaw/memory/preferences.md` from
 * `os.homedir()` while production writers (`writePreferences(cfg)` at
 * jobs/job.mjs and agent/objective.mjs) already had cfg in scope.
 * Two consequences, same class as v3.297.0 alert-state.json /
 * v3.529.0 memory/:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single preferences.md, so instance B loaded instance A's notes.
 *  2. The suite wrote into the operator's real `~/.xclaw/memory/preferences.md`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `writePreferences` still returns
 * `{ ok: true, written: 0 }` without persisting (do not `mkdir(null)`).
 * Honour existing `XCLAW_CONFIG_DIR`. No new env.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  preferencesPath,
  writePreferences,
  loadPreferences,
} from "../src/memory/preferences.mjs";

const HOME_MEM = path.join(os.homedir(), ".xclaw", "memory");
const HOME_PREF = path.join(HOME_MEM, "preferences.md");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-pref-cfg-"));
}

function resolverSlice() {
  const src = fs.readFileSync(
    new URL("../src/memory/preferences.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("export function preferencesPath");
  const end = src.indexOf("export function extractPreferenceHints");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

describe("memory preferences follow paths.configDir", () => {
  after(() => {
    if (SAVED_CONFIG_DIR === undefined) delete process.env.XCLAW_CONFIG_DIR;
    else process.env.XCLAW_CONFIG_DIR = SAVED_CONFIG_DIR;
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(preferencesPath(cfg), path.join(dir, "memory", "preferences.md"));
    assert.notEqual(preferencesPath(cfg), HOME_PREF);
  });

  test("a write lands in the config dir and never touches the home memory dir", async () => {
    const dir = await tmpDir();
    const homeBefore = fs.existsSync(HOME_MEM)
      ? fs.readdirSync(HOME_MEM)
      : null;
    const prefBefore = fs.existsSync(HOME_PREF);

    const cfg = { paths: { configDir: dir } };
    const rec = await writePreferences(cfg, ["Always pin-configDir notes"], {
      source: "pin",
    });
    assert.equal(rec.ok, true);
    assert.equal(rec.written, 1);
    assert.equal(rec.path, path.join(dir, "memory", "preferences.md"));
    const raw = fs.readFileSync(rec.path, "utf8");
    assert.ok(raw.includes("Always pin-configDir notes"), "preferences did not persist into paths.configDir");
    const loaded = await loadPreferences(cfg);
    assert.ok(loaded.includes("Always pin-configDir notes"));

    const homeAfter = fs.existsSync(HOME_MEM)
      ? fs.readdirSync(HOME_MEM)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "preferences wrote the home memory dir");
    assert.equal(fs.existsSync(HOME_PREF), prefBefore, "preferences wrote home preferences.md");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      assert.equal(preferencesPath({}), path.join(dir, "memory", "preferences.md"));
      await writePreferences({}, ["Always pin-env notes"], { source: "pin-env" });
      const raw = fs.readFileSync(preferencesPath({}), "utf8");
      assert.ok(raw.includes("Always pin-env notes"));
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no file and never writes home", async () => {
    assert.equal(preferencesPath({}), null);
    assert.equal(preferencesPath(), null);
    assert.notEqual(preferencesPath({}), HOME_PREF);

    const homeBefore = fs.existsSync(HOME_MEM)
      ? fs.readdirSync(HOME_MEM)
      : null;
    const prefBefore = fs.existsSync(HOME_PREF);

    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    const rec = await writePreferences({}, ["Always nope notes"], { source: "nope" });
    assert.equal(rec.ok, true);
    assert.equal(rec.written, 0);
    assert.equal(rec.path, undefined);
    const loaded = await loadPreferences({});
    assert.equal(loaded, "");

    const homeAfter = fs.existsSync(HOME_MEM)
      ? fs.readdirSync(HOME_MEM)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "no-configDir preferences wrote the home memory dir");
    assert.equal(fs.existsSync(HOME_PREF), prefBefore, "no-configDir preferences wrote home preferences.md");
    assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir preferences mkdir cwd/null");
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
  });
});

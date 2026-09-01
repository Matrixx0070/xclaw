/**
 * missions/ must live in the config dir that owns the instance.
 *
 * `missionsDir()` resolved `~/.xclaw/missions` from
 * `os.homedir()` while production writers (`saveMission(cfg)` at
 * missions/engine.mjs and self/deploy.mjs:169) already had cfg
 * in scope.
 * Two consequences, same class as v3.297.0 alert-state.json /
 * v3.535.0 skill-proposals/:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single missions/ directory, so instance B listed
 *     instance A's missions.
 *  2. The suite wrote into the operator's real `~/.xclaw/missions`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `saveMission` still returns the
 * in-memory mission without persisting (do not `mkdir(null)`).
 * Honour existing `XCLAW_CONFIG_DIR`. No new env.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  missionsStoreDir,
  saveMission,
  loadMission,
  listMissions,
  newMission,
} from "../src/missions/store.mjs";

const HOME_MSN = path.join(os.homedir(), ".xclaw", "missions");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-msn-cfg-"));
}

function homeMsnListing() {
  try {
    return fs.readdirSync(HOME_MSN).sort();
  } catch {
    return null;
  }
}

function resolverSlice() {
  const src = fs.readFileSync(
    new URL("../src/missions/store.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("export function missionsStoreDir");
  const end = src.indexOf("export async function saveMission");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

describe("missions follow paths.configDir", () => {
  after(() => {
    if (SAVED_CONFIG_DIR === undefined) delete process.env.XCLAW_CONFIG_DIR;
    else process.env.XCLAW_CONFIG_DIR = SAVED_CONFIG_DIR;
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(missionsStoreDir(cfg), path.join(dir, "missions"));
    assert.notEqual(missionsStoreDir(cfg), HOME_MSN);
  });

  test("a write lands in the config dir and never touches the home missions dir", async () => {
    const dir = await tmpDir();
    const homeBefore = homeMsnListing();

    const cfg = { paths: { configDir: dir } };
    const m = newMission({ goal: "pin-configDir", repoDir: dir });
    const rec = await saveMission(cfg, m);
    assert.equal(rec.goal, "pin-configDir");
    const loaded = await loadMission(cfg, rec.id);
    assert.equal(loaded.goal, "pin-configDir");
    const listed = await listMissions(cfg);
    assert.ok(listed.some((x) => x.id === rec.id));
    assert.ok(
      fs.existsSync(path.join(dir, "missions", `${rec.id}.json`)),
      "mission did not persist into paths.configDir"
    );

    assert.deepEqual(homeMsnListing(), homeBefore, "missions wrote the home missions dir");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      assert.equal(missionsStoreDir({}), path.join(dir, "missions"));
      const m = newMission({ goal: "pin-env", repoDir: dir });
      const rec = await saveMission({}, m);
      assert.equal(rec.goal, "pin-env");
      assert.ok(fs.existsSync(path.join(dir, "missions", `${rec.id}.json`)));
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no dir and never writes home", async () => {
    assert.equal(missionsStoreDir({}), null);
    assert.equal(missionsStoreDir(), null);
    assert.notEqual(missionsStoreDir({}), HOME_MSN);

    const homeBefore = homeMsnListing();
    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    const m = newMission({ goal: "nope", repoDir: "/tmp" });
    const rec = await saveMission({}, m);
    assert.equal(rec.goal, "nope");
    assert.equal(await loadMission({}, rec.id), null);
    assert.deepEqual(await listMissions({}), []);

    assert.deepEqual(homeMsnListing(), homeBefore, "no-configDir missions wrote home missions dir");
    assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir missions mkdir cwd/null");
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
  });
});

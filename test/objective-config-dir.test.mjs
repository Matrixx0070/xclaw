/**
 * objectives/ must live in the config dir that owns the instance.
 *
 * `objectivesDir()` resolved `~/.xclaw/objectives` from
 * `os.homedir()` while production writers (`saveObjective(cfg)` at
 * agent/objective.mjs, agent/run-resume.mjs, channels/runtime.mjs,
 * gateway/routes/objectives.mjs) already had cfg in scope.
 * Two consequences, same class as v3.297.0 alert-state.json /
 * v3.538.0 computer.pid:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single objectives/ directory, so instance B listed
 *     instance A's missions.
 *  2. The suite wrote into the operator's real `~/.xclaw/objectives`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `saveObjective` still returns the
 * in-memory objective without persisting (do not `mkdir(null)`).
 * Honour existing `XCLAW_CONFIG_DIR`. Keep `cfg.objectives?.dir`.
 * No new env.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  objectivesDir,
  saveObjective,
  loadObjective,
  listObjectives,
  newObjective,
} from "../src/agent/objective-store.mjs";

const HOME_OBJ = path.join(os.homedir(), ".xclaw", "objectives");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-obj-cfg-"));
}

function homeObjListing() {
  try {
    return fs.readdirSync(HOME_OBJ).sort();
  } catch {
    return null;
  }
}

function resolverSlice() {
  const src = fs.readFileSync(
    new URL("../src/agent/objective-store.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("export function objectivesDir");
  const end = src.indexOf("export function normalizeDeadline");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

describe("objectives follow paths.configDir", () => {
  after(() => {
    if (SAVED_CONFIG_DIR === undefined) delete process.env.XCLAW_CONFIG_DIR;
    else process.env.XCLAW_CONFIG_DIR = SAVED_CONFIG_DIR;
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(objectivesDir(cfg), path.join(dir, "objectives"));
    assert.notEqual(objectivesDir(cfg), HOME_OBJ);
    const override = path.join(dir, "custom-obj");
    assert.equal(objectivesDir({ objectives: { dir: override } }), override);
  });

  test("a write lands in the config dir and never touches the home objectives dir", async () => {
    const dir = await tmpDir();
    const homeBefore = homeObjListing();

    const cfg = { paths: { configDir: dir } };
    const obj = newObjective({ objective: "pin-configDir" });
    const rec = await saveObjective(cfg, obj);
    assert.equal(rec.objective, "pin-configDir");
    const loaded = await loadObjective(cfg, rec.id);
    assert.equal(loaded.objective, "pin-configDir");
    const listed = await listObjectives(cfg);
    assert.ok(listed.some((x) => x.id === rec.id));
    assert.ok(
      fs.existsSync(path.join(dir, "objectives", `${rec.id}.json`)),
      "objective did not persist into paths.configDir"
    );

    assert.deepEqual(homeObjListing(), homeBefore, "objectives wrote the home objectives dir");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      assert.equal(objectivesDir({}), path.join(dir, "objectives"));
      const obj = newObjective({ objective: "pin-env" });
      const rec = await saveObjective({}, obj);
      assert.equal(rec.objective, "pin-env");
      assert.ok(fs.existsSync(path.join(dir, "objectives", `${rec.id}.json`)));
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no dir and never writes home", async () => {
    assert.equal(objectivesDir({}), null);
    assert.equal(objectivesDir(), null);
    assert.notEqual(objectivesDir({}), HOME_OBJ);

    const homeBefore = homeObjListing();
    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    const obj = newObjective({ objective: "nope" });
    const rec = await saveObjective({}, obj);
    assert.equal(rec.objective, "nope");
    assert.equal(await loadObjective({}, rec.id), null);
    assert.deepEqual(await listObjectives({}), []);

    assert.deepEqual(homeObjListing(), homeBefore, "no-configDir objectives wrote home objectives dir");
    assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir objectives mkdir cwd/null");
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
  });
});

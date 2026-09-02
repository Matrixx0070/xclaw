/**
 * swarms/ must live in the config dir that owns the instance.
 *
 * `rootDir()` resolved `~/.xclaw/swarms` from
 * `os.homedir()` while production writers (`createSwarmRun(cfg)` at
 * agents/swarm-run.mjs, `saveSubagentSnapshot` via
 * `configureSubagentPersistence(cfg)` at gateway/index.mjs:1071)
 * already had cfg in scope.
 * Two consequences, same class as v3.297.0 alert-state.json /
 * v3.540.0 transcripts/:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single swarms/ directory, so instance B listed
 *     instance A's runs.
 *  2. The suite wrote into the operator's real `~/.xclaw/swarms`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `createSwarmRun` still returns the
 * in-memory run without persisting (do not `mkdir(null)`).
 * Honour existing `XCLAW_CONFIG_DIR`. No new env.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  swarmStoreRoot,
  swarmStorePaths,
  createSwarmRun,
  getSwarmRun,
  listSwarmRuns,
  saveSubagentSnapshot,
  loadSubagentSnapshot,
  listPersistedSubagents,
} from "../src/agents/swarm-store.mjs";

const HOME_SW = path.join(os.homedir(), ".xclaw", "swarms");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-sw-cfg-"));
}

function homeSwListing() {
  try {
    return fs.readdirSync(HOME_SW).sort();
  } catch {
    return null;
  }
}

function resolverSlice() {
  const src = fs.readFileSync(
    new URL("../src/agents/swarm-store.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("export function swarmStoreRoot");
  const end = src.indexOf("export async function saveSubagentSnapshot");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

describe("swarm store follows paths.configDir", () => {
  after(() => {
    if (SAVED_CONFIG_DIR === undefined) delete process.env.XCLAW_CONFIG_DIR;
    else process.env.XCLAW_CONFIG_DIR = SAVED_CONFIG_DIR;
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(swarmStoreRoot(cfg), path.join(dir, "swarms"));
    assert.notEqual(swarmStoreRoot(cfg), HOME_SW);
    const paths = swarmStorePaths(cfg);
    assert.equal(paths.root, path.join(dir, "swarms"));
    assert.equal(paths.runs, path.join(dir, "swarms", "runs"));
    assert.equal(paths.agents, path.join(dir, "swarms", "agents"));
  });

  test("a write lands in the config dir and never touches the home swarms dir", async () => {
    const dir = await tmpDir();
    const homeBefore = homeSwListing();

    const cfg = { paths: { configDir: dir } };
    const run = await createSwarmRun(cfg, { goal: "pin-configDir" });
    assert.equal(run.goal, "pin-configDir");
    const loaded = await getSwarmRun(cfg, run.id);
    assert.equal(loaded.goal, "pin-configDir");
    const listed = await listSwarmRuns(cfg);
    assert.ok(listed.some((x) => x.id === run.id));
    assert.ok(
      fs.existsSync(path.join(dir, "swarms", "runs", `${run.id}.json`)),
      "swarm run did not persist into paths.configDir"
    );

    const snap = await saveSubagentSnapshot(cfg, {
      id: "pin-agent",
      task: "pin",
      status: "done",
      createdAt: new Date().toISOString(),
    });
    assert.equal(typeof snap, "string");
    const agent = await loadSubagentSnapshot(cfg, "pin-agent");
    assert.equal(agent.id, "pin-agent");
    const agents = await listPersistedSubagents(cfg);
    assert.ok(agents.some((x) => x.id === "pin-agent"));

    assert.deepEqual(homeSwListing(), homeBefore, "swarm store wrote the home swarms dir");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      assert.equal(swarmStoreRoot({}), path.join(dir, "swarms"));
      const run = await createSwarmRun({}, { goal: "pin-env" });
      assert.ok(fs.existsSync(path.join(dir, "swarms", "runs", `${run.id}.json`)));
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no dir and never writes home", async () => {
    assert.equal(swarmStoreRoot({}), null);
    assert.equal(swarmStoreRoot(), null);
    assert.equal(swarmStorePaths({}).root, null);
    assert.notEqual(swarmStoreRoot({}), HOME_SW);

    const homeBefore = homeSwListing();
    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    const run = await createSwarmRun({}, { goal: "nope" });
    assert.equal(run.goal, "nope");
    assert.equal(await getSwarmRun({}, run.id), null);
    assert.deepEqual(await listSwarmRuns({}), []);

    const slim = await saveSubagentSnapshot({}, {
      id: "nope-agent",
      task: "nope",
      status: "done",
      createdAt: new Date().toISOString(),
    });
    assert.equal(slim.id, "nope-agent");
    assert.equal(await loadSubagentSnapshot({}, "nope-agent"), null);
    assert.deepEqual(await listPersistedSubagents({}), []);

    assert.deepEqual(homeSwListing(), homeBefore, "no-configDir swarm store wrote home swarms dir");
    assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir swarm store mkdir cwd/null");
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
  });
});

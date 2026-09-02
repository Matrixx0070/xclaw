/**
 * swarms/runs/<id>.journal must live in the config dir that owns the instance.
 *
 * `journalPath()` resolved `~/.xclaw/swarms/runs/<id>.journal` from
 * `os.homedir()` while production writers (`createRunJournal(cfg, run.id)`
 * at agents/swarm-run.mjs:1075) already had cfg in scope.
 * Two consequences, same class as v3.297.0 alert-state.json /
 * v3.542.0 blackboard:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single journal, so instance B resumed instance A's run.
 *  2. The suite wrote into the operator's real `~/.xclaw/swarms`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `createRunJournal` still returns an
 * in-memory journal whose `append` no-ops (do not `mkdir(null)`).
 * Honour existing `XCLAW_CONFIG_DIR`. No new env.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  journalRoot,
  journalPath,
  createRunJournal,
  readJournal,
} from "../src/agents/swarm-journal.mjs";

const HOME_SW = path.join(os.homedir(), ".xclaw", "swarms");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-journal-cfg-"));
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
    new URL("../src/agents/swarm-journal.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("export function journalRoot");
  const end = src.indexOf("export function computeGraphHash");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

describe("swarm journal follows paths.configDir", () => {
  after(() => {
    if (SAVED_CONFIG_DIR === undefined) delete process.env.XCLAW_CONFIG_DIR;
    else process.env.XCLAW_CONFIG_DIR = SAVED_CONFIG_DIR;
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(journalRoot(cfg), path.join(dir, "swarms", "runs"));
    assert.notEqual(journalRoot(cfg), path.join(HOME_SW, "runs"));
    assert.equal(
      journalPath(cfg, "run1"),
      path.join(dir, "swarms", "runs", "run1.journal")
    );
  });

  test("a write lands in the config dir and never touches the home swarms dir", async () => {
    const dir = await tmpDir();
    const homeBefore = homeSwListing();

    const cfg = { paths: { configDir: dir } };
    const j = createRunJournal(cfg, "pin-run");
    assert.equal(j.path, path.join(dir, "swarms", "runs", "pin-run.journal"));
    await j.append({ type: "run_start", goal: "pin-configDir" });
    await j.flush();
    const listed = await readJournal(cfg, "pin-run");
    assert.ok(listed && listed.length === 1);
    assert.equal(listed[0].type, "run_start");
    assert.equal(listed[0].goal, "pin-configDir");
    assert.ok(
      fs.existsSync(path.join(dir, "swarms", "runs", "pin-run.journal")),
      "journal did not persist into paths.configDir"
    );

    assert.deepEqual(homeSwListing(), homeBefore, "journal wrote the home swarms dir");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      assert.equal(journalRoot({}), path.join(dir, "swarms", "runs"));
      const j = createRunJournal({}, "pin-env");
      await j.append({ type: "run_start", goal: "pin-env" });
      await j.flush();
      assert.ok(
        fs.existsSync(path.join(dir, "swarms", "runs", "pin-env.journal"))
      );
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no dir and never writes home", async () => {
    assert.equal(journalRoot({}), null);
    assert.equal(journalRoot(), null);
    assert.equal(journalPath({}, "nope"), null);
    assert.notEqual(journalRoot({}), path.join(HOME_SW, "runs"));

    const homeBefore = homeSwListing();
    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    const j = createRunJournal({}, "nope");
    assert.equal(j.path, null);
    await j.append({ type: "run_start", goal: "nope" });
    await j.flush();
    assert.equal(await readJournal({}, "nope"), null);

    assert.deepEqual(homeSwListing(), homeBefore, "no-configDir journal wrote home swarms dir");
    assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir journal mkdir cwd/null");
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
  });
});

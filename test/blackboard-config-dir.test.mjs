/**
 * swarms/runs/<id>/blackboard.jsonl must live in the config dir that owns
 * the instance.
 *
 * `blackboardPath()` resolved `~/.xclaw/swarms/runs/<id>/blackboard.jsonl`
 * from `os.homedir()` while production writers (`appendEntry(cfg)` via
 * `createBlackboardTool({ cfg })` at agents/swarm-run.mjs:540) already had
 * cfg in scope.
 * Two consequences, same class as v3.297.0 alert-state.json /
 * v3.541.0 swarms/:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single blackboard, so instance B read instance A's findings.
 *  2. The suite wrote into the operator's real `~/.xclaw/swarms`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `appendEntry` still returns the
 * in-memory entry without persisting (do not `mkdir(null)`).
 * Honour existing `XCLAW_CONFIG_DIR`. No new env.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  blackboardRoot,
  blackboardPath,
  appendEntry,
  readEntries,
  tailDigest,
} from "../src/agents/blackboard.mjs";

const HOME_SW = path.join(os.homedir(), ".xclaw", "swarms");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-bb-cfg-"));
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
    new URL("../src/agents/blackboard.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("export function blackboardRoot");
  const end = src.indexOf("export async function appendEntry");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

describe("blackboard follows paths.configDir", () => {
  after(() => {
    if (SAVED_CONFIG_DIR === undefined) delete process.env.XCLAW_CONFIG_DIR;
    else process.env.XCLAW_CONFIG_DIR = SAVED_CONFIG_DIR;
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(blackboardRoot(cfg), path.join(dir, "swarms", "runs"));
    assert.notEqual(blackboardRoot(cfg), path.join(HOME_SW, "runs"));
    assert.equal(
      blackboardPath(cfg, "run1"),
      path.join(dir, "swarms", "runs", "run1", "blackboard.jsonl")
    );
  });

  test("a write lands in the config dir and never touches the home swarms dir", async () => {
    const dir = await tmpDir();
    const homeBefore = homeSwListing();

    const cfg = { paths: { configDir: dir } };
    const entry = await appendEntry(cfg, "pin-run", {
      nodeId: "a",
      role: "research",
      kind: "finding",
      text: "pin-configDir",
    });
    assert.equal(entry.text, "pin-configDir");
    const listed = await readEntries(cfg, "pin-run");
    assert.equal(listed.length, 1);
    assert.equal(listed[0].text, "pin-configDir");
    const digest = await tailDigest(cfg, "pin-run");
    assert.ok(digest.includes("pin-configDir"));
    assert.ok(
      fs.existsSync(
        path.join(dir, "swarms", "runs", "pin-run", "blackboard.jsonl")
      ),
      "blackboard did not persist into paths.configDir"
    );

    assert.deepEqual(homeSwListing(), homeBefore, "blackboard wrote the home swarms dir");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      assert.equal(blackboardRoot({}), path.join(dir, "swarms", "runs"));
      await appendEntry({}, "pin-env", {
        nodeId: "a",
        role: "research",
        kind: "finding",
        text: "pin-env",
      });
      assert.ok(
        fs.existsSync(
          path.join(dir, "swarms", "runs", "pin-env", "blackboard.jsonl")
        )
      );
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no dir and never writes home", async () => {
    assert.equal(blackboardRoot({}), null);
    assert.equal(blackboardRoot(), null);
    assert.equal(blackboardPath({}, "nope"), null);
    assert.notEqual(blackboardRoot({}), path.join(HOME_SW, "runs"));

    const homeBefore = homeSwListing();
    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    const entry = await appendEntry({}, "nope", {
      nodeId: "a",
      role: "research",
      kind: "finding",
      text: "nope",
    });
    assert.equal(entry.text, "nope");
    assert.deepEqual(await readEntries({}, "nope"), []);
    assert.equal(await tailDigest({}, "nope"), null);

    assert.deepEqual(homeSwListing(), homeBefore, "no-configDir blackboard wrote home swarms dir");
    assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir blackboard mkdir cwd/null");
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
  });
});

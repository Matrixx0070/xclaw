/**
 * swarms/merge-proposals must live in the config dir that owns the instance.
 *
 * `proposalsDir()` resolved `~/.xclaw/swarms/merge-proposals` from
 * `os.homedir()` while production writers (`saveMergeProposal(cfg)` via
 * `planAndMaybeMerge(cfg)` at agents/swarm-run.mjs:1460, plus
 * `approveMergeProposal`/`rejectMergeProposal` at gateway/routes/swarm.mjs
 * and cli/swarm-cli.mjs) already had cfg in scope.
 * Two consequences, same class as v3.297.0 alert-state.json /
 * v3.544.0 receipts:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single merge-proposals tree, so instance B approved
 *     instance A's pending merge.
 *  2. The suite wrote into the operator's real `~/.xclaw/swarms`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `saveMergeProposal` still returns
 * the in-memory proposal without persisting (do not `mkdir(null)`).
 * Honour existing `XCLAW_CONFIG_DIR`. No new env.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  mergeProposalsRoot,
  saveMergeProposal,
  getMergeProposal,
  listMergeProposals,
} from "../src/agents/swarm-merge.mjs";

const HOME_SW = path.join(os.homedir(), ".xclaw", "swarms");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-merge-cfg-"));
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
    new URL("../src/agents/swarm-merge.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("export function mergeProposalsRoot");
  const end = src.indexOf("export function resolveMergePolicy");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

describe("swarm merge proposals follow paths.configDir", () => {
  after(() => {
    if (SAVED_CONFIG_DIR === undefined) delete process.env.XCLAW_CONFIG_DIR;
    else process.env.XCLAW_CONFIG_DIR = SAVED_CONFIG_DIR;
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(
      mergeProposalsRoot(cfg),
      path.join(dir, "swarms", "merge-proposals")
    );
    assert.notEqual(
      mergeProposalsRoot(cfg),
      path.join(HOME_SW, "merge-proposals")
    );
  });

  test("a write lands in the config dir and never touches the home swarms dir", async () => {
    const dir = await tmpDir();
    const homeBefore = homeSwListing();

    const cfg = { paths: { configDir: dir } };
    const rec = await saveMergeProposal(cfg, {
      swarmId: "pin-run",
      repoDir: dir,
      items: [],
    });
    assert.equal(rec.status, "pending");
    assert.ok(rec.id);
    const loaded = await getMergeProposal(cfg, rec.id);
    assert.equal(loaded.id, rec.id);
    const listed = await listMergeProposals(cfg);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, rec.id);
    assert.ok(
      fs.existsSync(
        path.join(dir, "swarms", "merge-proposals", `${rec.id}.json`)
      ),
      "proposal did not persist into paths.configDir"
    );

    assert.deepEqual(homeSwListing(), homeBefore, "merge wrote the home swarms dir");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      assert.equal(
        mergeProposalsRoot({}),
        path.join(dir, "swarms", "merge-proposals")
      );
      const rec = await saveMergeProposal({}, {
        swarmId: "pin-env",
        repoDir: dir,
        items: [],
      });
      assert.ok(
        fs.existsSync(
          path.join(dir, "swarms", "merge-proposals", `${rec.id}.json`)
        )
      );
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no dir and never writes home", async () => {
    assert.equal(mergeProposalsRoot({}), null);
    assert.equal(mergeProposalsRoot(), null);
    assert.notEqual(mergeProposalsRoot({}), path.join(HOME_SW, "merge-proposals"));

    const homeBefore = homeSwListing();
    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    const rec = await saveMergeProposal({}, {
      swarmId: "nope",
      repoDir: "/tmp",
      items: [],
    });
    assert.equal(rec.status, "pending");
    assert.ok(rec.id);
    assert.equal(await getMergeProposal({}, rec.id), null);
    assert.deepEqual(await listMergeProposals({}), []);

    assert.deepEqual(homeSwListing(), homeBefore, "no-configDir merge wrote home swarms dir");
    assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir merge mkdir cwd/null");
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
  });
});

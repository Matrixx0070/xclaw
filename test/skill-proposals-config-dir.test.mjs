/**
 * skill-proposals/ must live in the config dir that owns the instance.
 *
 * `proposalsDir()` resolved `~/.xclaw/skill-proposals` from
 * `os.homedir()` while production writers (`proposeSkillFromFailure(cfg)`
 * at eval/runner.mjs:154 and jobs/job.mjs:433;
 * `proposeSkillFromSuccess(cfg)` at jobs/job.mjs:461) already had cfg
 * in scope.
 * Two consequences, same class as v3.297.0 alert-state.json /
 * v3.534.0 soak/:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single skill-proposals/ directory, so instance B listed
 *     instance A's drafts.
 *  2. The suite wrote into the operator's real `~/.xclaw/skill-proposals`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `proposeSkillFromFailure` still
 * returns the in-memory draft without persisting (do not `mkdir(null)`).
 * Honour existing `XCLAW_CONFIG_DIR`. No new env.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  skillProposalsDir,
  proposeSkillFromFailure,
  listProposals,
} from "../src/skills/propose.mjs";

const HOME_PROP = path.join(os.homedir(), ".xclaw", "skill-proposals");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-prop-cfg-"));
}

function homePropListing() {
  try {
    return fs.readdirSync(HOME_PROP).sort();
  } catch {
    return null;
  }
}

function resolverSlice() {
  const src = fs.readFileSync(
    new URL("../src/skills/propose.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("export function skillProposalsDir");
  const end = src.indexOf("export async function proposeSkillFromFailure");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

describe("skill proposals follow paths.configDir", () => {
  after(() => {
    if (SAVED_CONFIG_DIR === undefined) delete process.env.XCLAW_CONFIG_DIR;
    else process.env.XCLAW_CONFIG_DIR = SAVED_CONFIG_DIR;
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(skillProposalsDir(cfg), path.join(dir, "skill-proposals"));
    assert.notEqual(skillProposalsDir(cfg), HOME_PROP);
  });

  test("a write lands in the config dir and never touches the home proposals dir", async () => {
    const dir = await tmpDir();
    const homeBefore = homePropListing();

    const cfg = { paths: { configDir: dir } };
    const rec = await proposeSkillFromFailure(cfg, {
      caseId: "pin-configDir",
      goal: "pin",
      failures: ["verify"],
    });
    assert.ok(rec.path.includes(dir), "proposal path not under configDir");
    assert.ok(fs.existsSync(rec.path), "proposal did not persist into paths.configDir");
    const listed = await listProposals(cfg);
    assert.ok(listed.some((p) => p.path === rec.path));

    assert.deepEqual(homePropListing(), homeBefore, "skill proposals wrote the home skill-proposals dir");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      assert.equal(skillProposalsDir({}), path.join(dir, "skill-proposals"));
      const rec = await proposeSkillFromFailure({}, {
        caseId: "pin-env",
        goal: "pin",
      });
      assert.ok(rec.path.includes(dir));
      assert.ok(fs.existsSync(rec.path));
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no dir and never writes home", async () => {
    assert.equal(skillProposalsDir({}), null);
    assert.equal(skillProposalsDir(), null);
    assert.notEqual(skillProposalsDir({}), HOME_PROP);

    const homeBefore = homePropListing();
    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    const rec = await proposeSkillFromFailure({}, {
      caseId: "nope",
      goal: "nope",
    });
    assert.equal(rec.id.startsWith("nope_"), true);
    assert.equal(rec.path, null);
    const listed = await listProposals({});
    assert.deepEqual(listed, []);

    assert.deepEqual(homePropListing(), homeBefore, "no-configDir skill proposals wrote home skill-proposals dir");
    assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir skill proposals mkdir cwd/null");
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
  });
});

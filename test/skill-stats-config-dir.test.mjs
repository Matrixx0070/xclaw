/**
 * skill-stats.json must live in the config dir that owns the instance.
 *
 * `statsPath()` resolved `~/.xclaw/skill-stats.json` from
 * `os.homedir()` while production writers (`recordSkillOutcome(cfg)` at
 * eval/runner.mjs) already had cfg in scope.
 * Two consequences, same class as v3.297.0 alert-state.json /
 * v3.531.0 eval-history.jsonl:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single skill-stats.json, so instance B listed instance A's rates.
 *  2. The suite wrote into the operator's real `~/.xclaw/skill-stats.json`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `recordSkillOutcome` still returns
 * the in-memory stats without persisting (do not `mkdir(null)`).
 * Honour existing `XCLAW_CONFIG_DIR`. No new env.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  skillStatsPath,
  recordSkillOutcome,
  loadSkillStats,
} from "../src/skills/registry.mjs";

const HOME_STATS = path.join(os.homedir(), ".xclaw", "skill-stats.json");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-sk-cfg-"));
}

function resolverSlice() {
  const src = fs.readFileSync(
    new URL("../src/skills/registry.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("export function skillStatsPath");
  const end = src.indexOf("export async function loadSkillStats");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

describe("skill stats follow paths.configDir", () => {
  after(() => {
    if (SAVED_CONFIG_DIR === undefined) delete process.env.XCLAW_CONFIG_DIR;
    else process.env.XCLAW_CONFIG_DIR = SAVED_CONFIG_DIR;
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(skillStatsPath(cfg), path.join(dir, "skill-stats.json"));
    assert.notEqual(skillStatsPath(cfg), HOME_STATS);
  });

  test("a write lands in the config dir and never touches the home stats file", async () => {
    const dir = await tmpDir();
    const homeBefore = fs.existsSync(HOME_STATS);

    const cfg = { paths: { configDir: dir } };
    const rec = await recordSkillOutcome(cfg, ["pin-configDir"], true, 2);
    assert.equal(rec.skills["pin-configDir"].runs, 1);
    const fp = skillStatsPath(cfg);
    const raw = fs.readFileSync(fp, "utf8");
    assert.ok(raw.includes("pin-configDir"), "skill stats did not persist into paths.configDir");
    const listed = await loadSkillStats(cfg);
    assert.equal(listed.skills["pin-configDir"].runs, 1);

    assert.equal(fs.existsSync(HOME_STATS), homeBefore, "skill stats wrote the home skill-stats.json");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      assert.equal(skillStatsPath({}), path.join(dir, "skill-stats.json"));
      await recordSkillOutcome({}, ["pin-env"], true, 1);
      const raw = fs.readFileSync(skillStatsPath({}), "utf8");
      assert.ok(raw.includes("pin-env"));
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no file and never writes home", async () => {
    assert.equal(skillStatsPath({}), null);
    assert.equal(skillStatsPath(), null);
    assert.notEqual(skillStatsPath({}), HOME_STATS);

    const homeBefore = fs.existsSync(HOME_STATS);
    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    const rec = await recordSkillOutcome({}, ["nope"], true, 1);
    assert.equal(rec.skills["nope"].runs, 1);
    const listed = await loadSkillStats({});
    assert.deepEqual(listed, { version: 1, skills: {} });

    assert.equal(fs.existsSync(HOME_STATS), homeBefore, "no-configDir skill stats wrote home skill-stats.json");
    assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir skill stats mkdir cwd/null");
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
  });
});

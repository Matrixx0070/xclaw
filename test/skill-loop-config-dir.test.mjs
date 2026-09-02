/**
 * skill-loop-metrics.jsonl must live in the config dir that owns the instance.
 *
 * `metricsPath()` resolved `~/.xclaw/skill-loop-metrics.jsonl` from
 * `os.homedir()` while production writers (`recordSkillLoopMetric(cfg)`
 * via `runSkillAB(cfg)` at skills/loop.mjs:107/141 and
 * `bin/xclaw.mjs:2317` after `loadConfig()`) already had cfg in scope.
 * Two consequences, same class as v3.297.0 alert-state.json /
 * v3.547.0 evolution/events.jsonl:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single skill-loop-metrics.jsonl, so instance B stamped
 *     instance A's A/B deltas.
 *  2. The suite wrote into the operator's real `~/.xclaw`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `recordSkillLoopMetric` still
 * returns `null` without persisting (do not `mkdir(null)`).
 * Honour existing `XCLAW_CONFIG_DIR`. No new env.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  metricsPath,
  recordSkillLoopMetric,
  readSkillLoopMetrics,
} from "../src/skills/loop.mjs";

const HOME_METRICS = path.join(os.homedir(), ".xclaw", "skill-loop-metrics.jsonl");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-skill-loop-cfg-"));
}

function homeMetricsListing() {
  try {
    return fs.readFileSync(HOME_METRICS, "utf8");
  } catch {
    return null;
  }
}

function resolverSlice() {
  const src = fs.readFileSync(
    new URL("../src/skills/loop.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("export function metricsPath");
  const end = src.indexOf("export async function recordSkillLoopMetric");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

describe("skill-loop metrics follow paths.configDir", () => {
  after(() => {
    if (SAVED_CONFIG_DIR === undefined) delete process.env.XCLAW_CONFIG_DIR;
    else process.env.XCLAW_CONFIG_DIR = SAVED_CONFIG_DIR;
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(metricsPath(cfg), path.join(dir, "skill-loop-metrics.jsonl"));
    assert.notEqual(metricsPath(cfg), HOME_METRICS);
  });

  test("a write lands in the config dir and never touches the home metrics file", async () => {
    const dir = await tmpDir();
    const homeBefore = homeMetricsListing();

    const cfg = { paths: { configDir: dir } };
    const fp = await recordSkillLoopMetric(cfg, { kind: "pin", caseId: "pin-job" });
    assert.equal(fp, path.join(dir, "skill-loop-metrics.jsonl"));
    assert.ok(fs.existsSync(fp), "skill-loop metrics did not persist into paths.configDir");
    const body = fs.readFileSync(fp, "utf8");
    assert.match(body, /"kind":"pin"/);
    assert.match(body, /"caseId":"pin-job"/);
    const rows = await readSkillLoopMetrics(cfg);
    assert.equal(rows[0].kind, "pin");
    assert.equal(rows[0].caseId, "pin-job");

    assert.equal(homeMetricsListing(), homeBefore, "skill-loop wrote the home metrics file");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      assert.equal(metricsPath({}), path.join(dir, "skill-loop-metrics.jsonl"));
      const fp = await recordSkillLoopMetric({}, { kind: "pin-env" });
      assert.equal(fp, path.join(dir, "skill-loop-metrics.jsonl"));
      assert.ok(fs.existsSync(fp));
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no dir and never writes home", async () => {
    assert.equal(metricsPath({}), null);
    assert.equal(metricsPath(), null);
    assert.notEqual(metricsPath({}), HOME_METRICS);

    const homeBefore = homeMetricsListing();
    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    assert.equal(await recordSkillLoopMetric({}, { kind: "nope" }), null);
    assert.equal(await recordSkillLoopMetric(undefined, { kind: "nope" }), null);
    assert.deepEqual(await readSkillLoopMetrics({}), []);
    assert.deepEqual(await readSkillLoopMetrics(), []);

    assert.equal(homeMetricsListing(), homeBefore, "no-configDir skill-loop wrote home metrics");
    assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir skill-loop mkdir cwd/null");
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
  });
});

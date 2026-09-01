/**
 * jobs/ must live in the config dir that owns the instance.
 *
 * `jobsDir()` resolved `~/.xclaw/jobs` from `os.homedir()` while
 * production writers (`recordJob(cfg)` at jobs/job.mjs and jobs/queue.mjs)
 * already had cfg in scope. Two consequences, same class as v3.297.0
 * alert-state.json / v3.526.0 job-queue:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single history, so instance B listed instance A's jobs.
 *  2. The suite wrote into the operator's real `~/.xclaw/jobs/`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `ensureJobsDir` no-ops a null path
 * (do not `mkdir(null)`). Honour existing `XCLAW_CONFIG_DIR`. No new env.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  jobsDir,
  recordJob,
  listJobs,
  getJob,
} from "../src/jobs/history.mjs";

const HOME_JOBS = path.join(os.homedir(), ".xclaw", "jobs");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-jobs-cfg-"));
}

function pinJob(id, goal) {
  return {
    id,
    goal,
    status: "succeeded",
    pass: true,
    turns: 1,
    toolCalls: 0,
    toolErrors: 0,
    wallMs: 10,
  };
}

function resolverSlice() {
  const src = fs.readFileSync(
    new URL("../src/jobs/history.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("export function jobsDir");
  const end = src.indexOf("export async function recordJob");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

describe("job history follows paths.configDir", () => {
  after(() => {
    if (SAVED_CONFIG_DIR === undefined) delete process.env.XCLAW_CONFIG_DIR;
    else process.env.XCLAW_CONFIG_DIR = SAVED_CONFIG_DIR;
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(jobsDir(cfg), path.join(dir, "jobs"));
    assert.notEqual(jobsDir(cfg), HOME_JOBS);
  });

  test("a write lands in the config dir and never touches the home jobs dir", async () => {
    const dir = await tmpDir();
    const homeBefore = fs.existsSync(HOME_JOBS)
      ? fs.readdirSync(HOME_JOBS)
      : null;

    const cfg = { paths: { configDir: dir } };
    const { slim } = await recordJob(cfg, pinJob("job_pin_cfg", "pin-configDir"));
    assert.equal(slim.id, "job_pin_cfg");
    const fp = path.join(dir, "jobs", "job_pin_cfg.json");
    const raw = fs.readFileSync(fp, "utf8");
    assert.ok(raw.includes("pin-configDir"), "history did not persist into paths.configDir");
    const listed = await listJobs(cfg);
    assert.ok(listed.some((j) => j.id === "job_pin_cfg"));
    const got = await getJob(cfg, "job_pin_cfg");
    assert.equal(got.goal, "pin-configDir");

    const homeAfter = fs.existsSync(HOME_JOBS)
      ? fs.readdirSync(HOME_JOBS)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "history wrote the home jobs dir");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      assert.equal(jobsDir({}), path.join(dir, "jobs"));
      await recordJob({}, pinJob("job_pin_env", "pin-env"));
      const raw = fs.readFileSync(
        path.join(dir, "jobs", "job_pin_env.json"),
        "utf8"
      );
      assert.ok(raw.includes("pin-env"));
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no dir and never writes home", async () => {
    assert.equal(jobsDir({}), null);
    assert.equal(jobsDir(), null);
    assert.notEqual(jobsDir({}), HOME_JOBS);

    const homeBefore = fs.existsSync(HOME_JOBS)
      ? fs.readdirSync(HOME_JOBS)
      : null;

    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    const rec = await recordJob({}, pinJob("job_nope", "nope"));
    assert.equal(rec.path, null);
    assert.equal(rec.slim.id, "job_nope");
    const listed = await listJobs({});
    assert.deepEqual(listed, []);
    const got = await getJob({}, "job_nope");
    assert.equal(got, null);

    const homeAfter = fs.existsSync(HOME_JOBS)
      ? fs.readdirSync(HOME_JOBS)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "no-configDir history wrote the home jobs dir");
    assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir history mkdir cwd/null");
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
  });
});

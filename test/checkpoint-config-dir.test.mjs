/**
 * checkpoints/ must live in the config dir that owns the instance.
 *
 * `dir()` resolved `~/.xclaw/checkpoints` from `os.homedir()` while
 * production writers (`saveCheckpoint(cfg)` at jobs/job.mjs) already
 * had cfg in scope. Two consequences, same class as v3.297.0
 * alert-state.json / v3.527.0 jobs/:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single checkpoint store, so instance B resumed instance A's jobs.
 *  2. The suite wrote into the operator's real `~/.xclaw/checkpoints/`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `saveCheckpoint` no-ops a null path
 * (do not `mkdir(null)`). Honour existing `XCLAW_CONFIG_DIR`. No new env.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  checkpointDir,
  saveCheckpoint,
  loadCheckpoint,
  listCheckpoints,
  countCheckpoints,
  pruneCheckpoints,
  tryAcquireResumeLock,
  releaseResumeLock,
  RESUME_CODES,
} from "../src/jobs/checkpoint.mjs";

const HOME_CP = path.join(os.homedir(), ".xclaw", "checkpoints");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-cp-cfg-"));
}

function pinJob(id, goal) {
  return {
    id,
    goal,
    status: "succeeded",
    pass: true,
    turns: 1,
    workspace: "/tmp/ws",
  };
}

function resolverSlice() {
  const src = fs.readFileSync(
    new URL("../src/jobs/checkpoint.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("export function checkpointDir");
  const end = src.indexOf("export async function saveCheckpoint");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

describe("job checkpoints follow paths.configDir", () => {
  after(() => {
    if (SAVED_CONFIG_DIR === undefined) delete process.env.XCLAW_CONFIG_DIR;
    else process.env.XCLAW_CONFIG_DIR = SAVED_CONFIG_DIR;
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(checkpointDir(cfg), path.join(dir, "checkpoints"));
    assert.notEqual(checkpointDir(cfg), HOME_CP);
  });

  test("a write lands in the config dir and never touches the home checkpoints dir", async () => {
    const dir = await tmpDir();
    const homeBefore = fs.existsSync(HOME_CP)
      ? fs.readdirSync(HOME_CP)
      : null;

    const cfg = { paths: { configDir: dir } };
    const fp = await saveCheckpoint(cfg, pinJob("job_pin_cfg", "pin-configDir"));
    assert.equal(fp, path.join(dir, "checkpoints", "job_pin_cfg.json"));
    const raw = fs.readFileSync(fp, "utf8");
    assert.ok(raw.includes("pin-configDir"), "checkpoint did not persist into paths.configDir");
    const listed = await listCheckpoints(cfg);
    assert.ok(listed.some((j) => j.id === "job_pin_cfg"));
    const got = await loadCheckpoint(cfg, "job_pin_cfg");
    assert.equal(got.goal, "pin-configDir");
    const counted = await countCheckpoints(cfg);
    assert.equal(counted.total, 1);

    const homeAfter = fs.existsSync(HOME_CP)
      ? fs.readdirSync(HOME_CP)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "checkpoint wrote the home checkpoints dir");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      assert.equal(checkpointDir({}), path.join(dir, "checkpoints"));
      await saveCheckpoint({}, pinJob("job_pin_env", "pin-env"));
      const raw = fs.readFileSync(
        path.join(dir, "checkpoints", "job_pin_env.json"),
        "utf8"
      );
      assert.ok(raw.includes("pin-env"));
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no dir and never writes home", async () => {
    assert.equal(checkpointDir({}), null);
    assert.equal(checkpointDir(), null);
    assert.notEqual(checkpointDir({}), HOME_CP);

    const homeBefore = fs.existsSync(HOME_CP)
      ? fs.readdirSync(HOME_CP)
      : null;

    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    const rec = await saveCheckpoint({}, pinJob("job_nope", "nope"));
    assert.equal(rec, null);
    const listed = await listCheckpoints({});
    assert.deepEqual(listed, []);
    await assert.rejects(
      () => loadCheckpoint({}, "job_nope"),
      (err) => err && err.code === RESUME_CODES.NOT_FOUND
    );
    const counted = await countCheckpoints({});
    assert.deepEqual(counted, { total: 0, byStatus: {} });
    const pruned = await pruneCheckpoints({});
    assert.equal(pruned.removed, 0);
    assert.equal(pruned.kept, 0);
    assert.equal(pruned.reason, "no_dir");
    const locked = await tryAcquireResumeLock("job_nope", {});
    assert.equal(locked, true);
    await releaseResumeLock("job_nope", {});

    const homeAfter = fs.existsSync(HOME_CP)
      ? fs.readdirSync(HOME_CP)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "no-configDir checkpoint wrote the home checkpoints dir");
    assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir checkpoint mkdir cwd/null");
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
  });
});

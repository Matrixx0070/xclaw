/**
 * job-queue/ must live in the config dir that owns the instance.
 *
 * `queueDir()` resolved `~/.xclaw/job-queue` from `os.homedir()` while
 * production writers (`enqueueJob(cfg)` at channels/commands and
 * gateway/routes/eval-queue) already had cfg in scope. Two consequences,
 * same class as v3.297.0 alert-state.json / v3.525.0 auth-refresh-status:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single queue, so instance B drained instance A's jobs.
 *  2. The suite wrote into the operator's real `~/.xclaw/job-queue/`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `ensureDir` no-ops a null path
 * (do not `mkdir(null)`). Honour existing `XCLAW_CONFIG_DIR`. No new env.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  queueDir,
  enqueueJob,
  listQueue,
  getQueueItem,
  pauseQueue,
  clearCompletedQueue,
} from "../src/jobs/queue.mjs";

const HOME_QUEUE = path.join(os.homedir(), ".xclaw", "job-queue");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-queue-cfg-"));
}

function resolverSlice() {
  const src = fs.readFileSync(
    new URL("../src/jobs/queue.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("export function queueDir");
  const end = src.indexOf("function maxConcurrency");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

describe("job queue follows paths.configDir", () => {
  after(() => {
    if (SAVED_CONFIG_DIR === undefined) delete process.env.XCLAW_CONFIG_DIR;
    else process.env.XCLAW_CONFIG_DIR = SAVED_CONFIG_DIR;
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(queueDir(cfg), path.join(dir, "job-queue"));
    assert.notEqual(queueDir(cfg), HOME_QUEUE);
  });

  test("a write lands in the config dir and never touches the home queue", async () => {
    const dir = await tmpDir();
    const homeBefore = fs.existsSync(HOME_QUEUE)
      ? fs.readdirSync(HOME_QUEUE)
      : null;

    pauseQueue();
    const cfg = { paths: { configDir: dir }, queue: { concurrency: 1 } };
    const rec = await enqueueJob(cfg, { goal: "pin-configDir" });
    const fp = path.join(dir, "job-queue", `${rec.id}.json`);
    const raw = fs.readFileSync(fp, "utf8");
    assert.ok(raw.includes("pin-configDir"), "queue did not persist into paths.configDir");
    const listed = await listQueue(cfg);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].goal, "pin-configDir");
    const got = await getQueueItem(cfg, rec.id);
    assert.equal(got.goal, "pin-configDir");

    const homeAfter = fs.existsSync(HOME_QUEUE)
      ? fs.readdirSync(HOME_QUEUE)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "queue wrote the home job-queue dir");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      assert.equal(queueDir({}), path.join(dir, "job-queue"));
      pauseQueue();
      const rec = await enqueueJob({}, { goal: "pin-env" });
      const raw = fs.readFileSync(
        path.join(dir, "job-queue", `${rec.id}.json`),
        "utf8"
      );
      assert.ok(raw.includes("pin-env"));
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no dir and never writes home", async () => {
    assert.equal(queueDir({}), null);
    assert.equal(queueDir(), null);
    assert.notEqual(queueDir({}), HOME_QUEUE);

    const homeBefore = fs.existsSync(HOME_QUEUE)
      ? fs.readdirSync(HOME_QUEUE)
      : null;

    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    pauseQueue();
    const rec = await enqueueJob({}, { goal: "nope" });
    assert.equal(rec.status, "queued");
    assert.ok(rec.id);
    const listed = await listQueue({});
    assert.deepEqual(listed, []);
    const got = await getQueueItem({}, rec.id);
    assert.equal(got, null);
    const cleared = await clearCompletedQueue({});
    assert.equal(cleared.removed, 0);

    const homeAfter = fs.existsSync(HOME_QUEUE)
      ? fs.readdirSync(HOME_QUEUE)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "no-configDir queue wrote the home job-queue");
    assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir queue mkdir cwd/null");
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
  });
});

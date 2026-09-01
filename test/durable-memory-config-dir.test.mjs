/**
 * memory/ must live in the config dir that owns the instance.
 *
 * `baseDir()` resolved `~/.xclaw/memory` from `os.homedir()` while
 * production writers (`rememberJob(cfg)` at jobs/job.mjs,
 * `appendMemory(cfg)` at recall/reflection) already had cfg in scope.
 * Two consequences, same class as v3.297.0 alert-state.json /
 * v3.528.0 checkpoints/:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single memory store, so instance B recalled instance A's notes.
 *  2. The suite wrote into the operator's real `~/.xclaw/memory/`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `appendMemory` still returns the
 * in-memory event without persisting (do not `mkdir(null)`). Honour
 * existing `XCLAW_CONFIG_DIR`. No new env.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  memoryStoreDir,
  memoryPaths,
  appendMemory,
  listMemory,
  loadDurableMemoryFile,
  forgetMemory,
  pruneMemoryWorkspaces,
} from "../src/memory/durable.mjs";

const HOME_MEM = path.join(os.homedir(), ".xclaw", "memory");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-mem-cfg-"));
}

function resolverSlice() {
  const src = fs.readFileSync(
    new URL("../src/memory/durable.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("export function memoryStoreDir");
  const end = src.indexOf("export async function appendMemory");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

describe("durable memory follows paths.configDir", () => {
  after(() => {
    if (SAVED_CONFIG_DIR === undefined) delete process.env.XCLAW_CONFIG_DIR;
    else process.env.XCLAW_CONFIG_DIR = SAVED_CONFIG_DIR;
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(memoryStoreDir(cfg), path.join(dir, "memory"));
    assert.notEqual(memoryStoreDir(cfg), HOME_MEM);
  });

  test("a write lands in the config dir and never touches the home memory dir", async () => {
    const dir = await tmpDir();
    const homeBefore = fs.existsSync(HOME_MEM)
      ? fs.readdirSync(HOME_MEM)
      : null;

    const cfg = { paths: { configDir: dir } };
    const ws = path.join(dir, "ws");
    await fsp.mkdir(ws);
    const rec = await appendMemory(cfg, ws, {
      type: "note",
      summary: "pin-configDir",
    });
    assert.equal(rec.summary, "pin-configDir");
    const p = memoryPaths(cfg, ws);
    const raw = fs.readFileSync(p.jsonl, "utf8");
    assert.ok(raw.includes("pin-configDir"), "memory did not persist into paths.configDir");
    const listed = await listMemory(cfg, ws);
    assert.ok(listed.some((e) => e.summary === "pin-configDir"));
    const loaded = await loadDurableMemoryFile(cfg, ws);
    assert.ok(loaded?.content.includes("pin-configDir"));

    const homeAfter = fs.existsSync(HOME_MEM)
      ? fs.readdirSync(HOME_MEM)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "memory wrote the home memory dir");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      assert.equal(memoryStoreDir({}), path.join(dir, "memory"));
      const ws = path.join(dir, "ws");
      await fsp.mkdir(ws);
      await appendMemory({}, ws, { type: "note", summary: "pin-env" });
      const p = memoryPaths({}, ws);
      const raw = fs.readFileSync(p.jsonl, "utf8");
      assert.ok(raw.includes("pin-env"));
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no dir and never writes home", async () => {
    assert.equal(memoryStoreDir({}), null);
    assert.equal(memoryStoreDir(), null);
    assert.notEqual(memoryStoreDir({}), HOME_MEM);

    const homeBefore = fs.existsSync(HOME_MEM)
      ? fs.readdirSync(HOME_MEM)
      : null;

    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    const ws = path.join(os.tmpdir(), "xclaw-mem-cfg-nope");
    const rec = await appendMemory({}, ws, { type: "note", summary: "nope" });
    assert.equal(rec.summary, "nope");
    const listed = await listMemory({}, ws);
    assert.deepEqual(listed, []);
    const loaded = await loadDurableMemoryFile({}, ws);
    assert.equal(loaded, null);
    const forgotten = await forgetMemory({}, ws, { type: "note" });
    assert.equal(forgotten.removed, 0);
    assert.equal(forgotten.kept, 0);
    const pruned = await pruneMemoryWorkspaces({});
    assert.equal(pruned.reason, "no_dir");
    assert.equal(pruned.dir, null);
    assert.equal(pruned.pruned, 0);
    const p = memoryPaths({}, ws);
    assert.equal(p.dir, null);
    assert.equal(p.jsonl, null);

    const homeAfter = fs.existsSync(HOME_MEM)
      ? fs.readdirSync(HOME_MEM)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "no-configDir memory wrote the home memory dir");
    assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir memory mkdir cwd/null");
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
  });
});

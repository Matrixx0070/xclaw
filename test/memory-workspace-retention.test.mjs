/**
 * The durable memory store is a directory of directories, and nothing bounded it.
 *
 * appendMemory() rotates each workspace's events.jsonl at 1MB, so every FILE in
 * the store is bounded. The store itself is not: memoryPaths() mints one
 * permanent directory per distinct workspace path, keyed by a one-way sha256,
 * and no code ever removes one. src/ops/maintenance.mjs — the module whose
 * stated job is bounding growth — named the memory store in neither its
 * rotation targets nor its "Not handled here" exemptions, the same omission
 * that hid the proof bundles (3.316.0) and the checkpoints (3.317.0).
 *
 * Measured live at 3.317.0: 208 workspace directories, 416 files, 2.5MB,
 * oldest 13.0 days — roughly 16 new directories per day, forever. 206 of the
 * 208 were throwaway /tmp eval and job workspaces; only /root/xclaw and
 * /root/xclaw/tmp-live were real. 169 pointed at a workspace that no longer
 * existed, and the 39 that still resolved did so only because the daily tmp
 * sweeper had not reached them yet.
 *
 * Deleting by age alone would be wrong: a long-lived workspace's memory is the
 * one thing in this store worth keeping, and it is the most likely to be old.
 * The store already records what makes the distinction safe — rebuildMemoryMd
 * writes the workspace path into MEMORY.md as "Path: `...`" — but nothing had
 * ever read it back. Attribution turns "old" into "provably unreachable":
 * prune only a directory whose recorded workspace is GONE, never one that
 * still resolves and never one whose path cannot be read at all.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  appendMemory,
  rebuildMemoryMd,
  memoryPaths,
  readWorkspacePath,
  pruneMemoryWorkspaces,
} from "../src/memory/durable.mjs";
import { runOpsMaintenance } from "../src/ops/maintenance.mjs";

const dirs = [];
afterEach(async () => {
  while (dirs.length) await fs.rm(dirs.pop(), { recursive: true, force: true });
});

async function tmp(tag) {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), `xclaw-memret-${tag}-`));
  dirs.push(d);
  return d;
}

/** Create a real memory dir for `ws` exactly the way production does. */
async function seed(cfg, ws, ageDays = 0) {
  await appendMemory(cfg, ws, { type: "job_ok", summary: "seeded" });
  await rebuildMemoryMd(cfg, ws);
  const p = memoryPaths(cfg, ws);
  if (ageDays) {
    const t = new Date(Date.now() - ageDays * 86_400_000);
    await fs.utimes(p.dir, t, t);
  }
  return p.dir;
}

describe("durable memory store retention", () => {
  it("reads back the workspace path MEMORY.md records", async () => {
    const cfgDir = await tmp("read");
    const ws = await tmp("ws");
    const cfg = { paths: { configDir: cfgDir } };
    const dir = await seed(cfg, ws);
    assert.equal(await readWorkspacePath(dir), path.resolve(ws));
  });

  it("keeps a workspace that still exists, however old", async () => {
    const cfgDir = await tmp("keep");
    const ws = await tmp("ws");
    const cfg = { paths: { configDir: cfgDir } };
    const dir = await seed(cfg, ws, 400);
    const r = await pruneMemoryWorkspaces(cfg, { maxAgeMs: 1 });
    assert.equal(r.pruned, 0, "a live workspace's memory must never be pruned");
    assert.equal(r.keepers, 1);
    assert.ok(await fs.stat(dir));
  });

  it("prunes an orphan past the age bound", async () => {
    const cfgDir = await tmp("orph");
    const ws = await tmp("ws");
    const cfg = { paths: { configDir: cfgDir } };
    const dir = await seed(cfg, ws, 40);
    await fs.rm(ws, { recursive: true, force: true });
    dirs.splice(dirs.indexOf(ws), 1);
    const r = await pruneMemoryWorkspaces(cfg, { maxAgeMs: 30 * 86_400_000 });
    assert.equal(r.orphans, 1);
    assert.equal(r.pruned, 1);
    assert.ok(r.prunedBytes > 0, "bytes reclaimed must be reported");
    await assert.rejects(() => fs.stat(dir));
  });

  it("keeps an orphan inside the age bound", async () => {
    const cfgDir = await tmp("young");
    const ws = await tmp("ws");
    const cfg = { paths: { configDir: cfgDir } };
    const dir = await seed(cfg, ws, 13);
    await fs.rm(ws, { recursive: true, force: true });
    dirs.splice(dirs.indexOf(ws), 1);
    const r = await pruneMemoryWorkspaces(cfg, { maxAgeMs: 30 * 86_400_000 });
    assert.equal(r.orphans, 1);
    assert.equal(r.pruned, 0, "the live store's oldest entry is inside the default grace");
    assert.ok(await fs.stat(dir));
  });

  it("never prunes a directory whose workspace path cannot be read", async () => {
    const cfgDir = await tmp("unattr");
    const ws = await tmp("ws");
    const cfg = { paths: { configDir: cfgDir } };
    const dir = await seed(cfg, ws);
    await fs.rm(path.join(dir, "MEMORY.md"));
    await fs.rm(ws, { recursive: true, force: true });
    dirs.splice(dirs.indexOf(ws), 1);
    // Age the directory AFTER removing MEMORY.md: unlinking a file resets the
    // parent's mtime, so seeding an age first would leave this dir looking
    // fresh and the age bound — not the guard under test — would be what
    // spared it. The fixture must not pin the one input that cannot exhibit
    // the bug.
    const old = new Date(Date.now() - 400 * 86_400_000);
    await fs.utimes(dir, old, old);
    const r = await pruneMemoryWorkspaces(cfg, { maxAgeMs: 1 });
    assert.equal(r.unattributable, 1);
    assert.equal(r.pruned, 0, "report what cannot be attributed; never delete it");
    assert.ok(await fs.stat(dir));
  });

  it("caps orphans by count, newest kept", async () => {
    const cfgDir = await tmp("cap");
    const cfg = { paths: { configDir: cfgDir } };
    const kept = [];
    for (let i = 0; i < 4; i++) {
      const ws = await tmp(`ws${i}`);
      kept.push(await seed(cfg, ws, 4 - i)); // index 0 oldest
      await fs.rm(ws, { recursive: true, force: true });
      dirs.splice(dirs.indexOf(ws), 1);
    }
    const r = await pruneMemoryWorkspaces(cfg, { maxAgeMs: 365 * 86_400_000, keepMax: 2 });
    assert.equal(r.orphans, 4);
    assert.equal(r.pruned, 2, "only the overflow past keepMax goes");
    await assert.rejects(() => fs.stat(kept[0]), "oldest orphan pruned");
    assert.ok(await fs.stat(kept[3]), "newest orphan kept");
  });

  it("reports the census when it prunes nothing", async () => {
    const cfgDir = await tmp("census");
    const ws = await tmp("ws");
    const cfg = { paths: { configDir: cfgDir } };
    await seed(cfg, ws);
    const r = await pruneMemoryWorkspaces(cfg);
    assert.equal(r.workspaces, 1);
    assert.ok(r.bytes > 0, "growth must be visible before a ceiling is reached");
    assert.equal(r.pruned, 0);
  });

  it("returns absent rather than throwing when the store was never created", async () => {
    const cfgDir = await tmp("none");
    const r = await pruneMemoryWorkspaces({ paths: { configDir: cfgDir } });
    assert.equal(r.reason, "absent");
    assert.equal(r.workspaces, 0);
  });

  it("the daily maintenance pass runs the memory sweep", async () => {
    const cfgDir = await tmp("wire");
    const ws = await tmp("ws");
    const cfg = { paths: { configDir: cfgDir } };
    await seed(cfg, ws, 40);
    await fs.rm(ws, { recursive: true, force: true });
    dirs.splice(dirs.indexOf(ws), 1);
    const out = await runOpsMaintenance(cfg);
    assert.ok(out.memory, "runOpsMaintenance must report a memory census");
    assert.equal(out.memory.orphans, 1);
    assert.equal(out.memory.pruned, 1, "a primitive nothing calls is a policy that never runs");
    assert.deepEqual(out.errors, []);
  });
});

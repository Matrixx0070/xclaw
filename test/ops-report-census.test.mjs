/**
 * The daily maintenance census must reach a human.
 *
 * Three consecutive ships added retention to a directory that nothing was
 * bounding — proof bundles (3.316.0), checkpoints (3.317.0), the durable
 * memory store (3.318.0) — and each returned a census "whether or not it
 * changed anything", because a ceiling you only hear about once it is crossed
 * is not observability.
 *
 * All three censuses were then dropped on the floor. runOpsMaintenance has
 * exactly one production caller, the daily ops timer in src/ops/scheduler.mjs,
 * and the only thing that turns its result into words is reportOpsRun — which
 * logged the ledger and the rotations and nothing else. `dirs`, `checkpoints`
 * and `memory` were computed, returned, and never printed anywhere. The result
 * object is not a reader; nothing else in the codebase consumes it.
 *
 * This is the recorded class-11 shape: a marker only the JSON carries is one
 * nobody reads. It bites hardest on the memory sweep, whose whole safety
 * argument is that a directory it cannot attribute is counted `unattributable`
 * and left alone — a promise that is worth nothing if no one is ever told the
 * count.
 *
 * Fourth defect, same shape, found in the module's own doc comment:
 * "Rotation's under-cap result used to be computed and then dropped by
 * `if (r.rotated)` ... so measurements are reported alongside the actions."
 * The code still read `if (r.rotated) out.rotated.push(r)`. The fix the
 * comment described had never been applied, so a file at 99% of its ceiling
 * was still indistinguishable from a file that did not exist. Measurements now
 * land in `sizes` (every target, every pass) and actions stay in `rotated`.
 *
 * Silence is reserved for stores that were never created: a host that has no
 * proofs directory, no checkpoints and no memory store should get no lines at
 * all, so that a line always means a measurement was actually taken.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runOpsMaintenance } from "../src/ops/maintenance.mjs";
import { reportOpsRun } from "../src/ops/scheduler.mjs";

const dirs = [];
afterEach(async () => {
  while (dirs.length) await fs.rm(dirs.pop(), { recursive: true, force: true });
});

/** Collect what an ops run would say to the operator. */
function capture(result) {
  const logs = [];
  const warns = [];
  reportOpsRun(result, (...a) => logs.push(a.join(" ")), (...a) => warns.push(a.join(" ")));
  return { logs, warns, all: logs.concat(warns).join("\n") };
}

describe("daily ops census reaches the operator", () => {
  it("reports the directory retention census even when it pruned nothing", () => {
    const out = capture({
      ran: true,
      maintenance: {
        dirs: [{ dir: "/x/proofs", files: 1214, bytes: 9_700_000, pruned: 0, prunedBytes: 0, reason: "ok" }],
      },
    });
    assert.match(out.all, /\/x\/proofs/);
    assert.match(out.all, /1214/);
  });

  it("reports the checkpoint census", () => {
    const out = capture({
      ran: true,
      maintenance: { checkpoints: { removed: 104, kept: 101, protected: 1, maxCount: 100 } },
    });
    assert.match(out.all, /checkpoint/i);
    assert.match(out.all, /104/);
    assert.match(out.all, /101/);
  });

  it("reports the memory census, naming the directories it refused to judge", () => {
    const out = capture({
      ran: true,
      maintenance: {
        memory: {
          dir: "/x/memory",
          workspaces: 208,
          keepers: 39,
          orphans: 169,
          unattributable: 7,
          bytes: 2_500_000,
          pruned: 0,
          prunedBytes: 0,
          reason: "ok",
        },
      },
    });
    assert.match(out.all, /208/);
    assert.match(out.all, /169/);
    assert.match(out.all, /unattributable/i, "the count nothing prints is a promise nothing keeps");
    assert.match(out.all, /7/);
  });

  it("says nothing about stores that were never created", () => {
    const out = capture({
      ran: true,
      maintenance: {
        dirs: [{ dir: "/x/proofs", files: 0, bytes: 0, pruned: 0, reason: "absent" }],
        checkpoints: { removed: 0, kept: 0, reason: "no_dir" },
        memory: { dir: "/x/memory", workspaces: 0, pruned: 0, reason: "absent" },
        sizes: [{ path: "/x/router-events.jsonl", rotated: false, reason: "absent" }],
      },
    });
    assert.equal(out.all, "", `a line must mean a measurement was taken; got: ${out.all}`);
  });

  it("reports a file measured under its rotation ceiling", () => {
    const out = capture({
      ran: true,
      maintenance: {
        sizes: [{ path: "/x/cost-ledger.jsonl", rotated: false, reason: "under_cap", bytes: 7_900_000 }],
      },
    });
    assert.match(out.all, /cost-ledger\.jsonl/);
    assert.match(out.all, /7900000|7_900_000/);
  });

  it("stays silent for a run that did not happen", () => {
    assert.equal(capture({ ran: false, maintenance: { memory: { workspaces: 9, reason: "ok" } } }).all, "");
  });

  it("the maintenance pass records a size measurement for a file under the cap", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-census-"));
    dirs.push(root);
    const ledger = path.join(root, "cost-ledger.jsonl");
    await fs.writeFile(ledger, "{}\n".repeat(10));
    const cfg = { paths: { configDir: root }, tokens: { ledgerPath: ledger } };
    const r = await runOpsMaintenance(cfg);
    const row = (r.sizes || []).find((s) => s.path === ledger);
    assert.ok(row, "an under-cap file must still be measured, not silently skipped");
    assert.equal(row.rotated, false);
    assert.equal(row.bytes, 30);
  });

  it("an end-to-end pass says something about every store it looked at", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-census2-"));
    dirs.push(root);
    await fs.mkdir(path.join(root, "checkpoints"), { recursive: true });
    await fs.writeFile(
      path.join(root, "checkpoints", "cp1.json"),
      JSON.stringify({ id: "cp1", status: "done", at: new Date().toISOString() })
    );
    const cfg = { paths: { configDir: root } };
    const out = capture({ ran: true, maintenance: await runOpsMaintenance(cfg) });
    assert.match(out.all, /checkpoint/i);
  });
});

/**
 * Daily ops maintenance — closes the mandate-2 audit's accepted finding
 * "unbounded append-only files (rotation deferred)".
 *
 * Two jobs, both idempotent and best-effort:
 *  1. Ledger compaction — compactLedger() already existed but was CLI-only;
 *     nothing ever ran it, so the ops ledger grew forever. Now the gateway's
 *     daily ops timer calls it (retention: cfg.ledger.retentionDays, 90d).
 *  2. Size-gated rotation of the host-global unbounded JSONL appenders
 *     (router-events, cost-ledger, cron events/doctor logs). When a file
 *     exceeds maxBytes, the head is archived to `<file>.1` (one generation,
 *     overwritten) and the newest line-aligned keepBytes tail stays in place —
 *     so live readers (usage analytics, model-stats, cron monitor) keep their
 *     recent window without interruption.
 *
 *  3. Retention on directories of discrete artifacts. Rotation is a
 *     single-file, line-aligned primitive; a directory that gains one whole
 *     file per operation is the same unboundedness in a different shape and
 *     needs a different tool. First target: the proof bundles from
 *     exportProofBundle, which appeared in NEITHER the list above nor the
 *     exemptions below — 1214 files / 9.7MB measured live at 3.315.0, with no
 *     reader anywhere in the codebase and no doctor probe watching them.
 *
 *  4. Checkpoint eviction. pruneCheckpoints() has had a policy (maxCount 100 /
 *     14d), tests and a doctor row since the store was added, but its only
 *     production caller was runEvolutionTick, reached only from the heartbeat
 *     cron job. A host with no heartbeat job never evicts a checkpoint —
 *     measured live at 3.316.0: cron.jobs = 0 and 204 of 205 checkpoints
 *     evictable against a maxCount of 100, a ceiling that had plainly never
 *     been applied. Checkpoints appeared in neither the list above nor the
 *     exemptions below, the same omission the proof bundles were found in.
 *     The heartbeat path additionally sits behind quiet-hours and budget early
 *     returns, so it skips disk housekeeping when the LLM budget is spent;
 *     running eviction from the daily pass makes it independent of both and
 *     leaves that call a harmless idempotent extra.
 *
 *  5. Durable memory store retention. Each workspace's events.jsonl is
 *     rotated by appendMemory itself, so every FILE there is bounded — but the
 *     store is a directory of directories, one minted per distinct workspace
 *     path and never removed, and that count was bounded by nothing. Measured
 *     live at 3.317.0: 208 directories growing ~16/day, of which 206 were
 *     throwaway /tmp eval and job workspaces. Like the proofs and the
 *     checkpoints before it, the memory store appeared in neither the list
 *     above nor the exemptions below. Only provable orphans are eligible (see
 *     pruneMemoryWorkspaces) — the decision lives in the memory module, which
 *     owns the store's layout.
 *
 * Every pass returns a census whether or not it changed anything. Rotation's
 * under-cap result was computed and then dropped by `if (r.rotated)`, which
 * made a file at 99% of its ceiling indistinguishable from a file that did not
 * exist. A ceiling you only hear about once it is crossed is not
 * observability, so measurements now land in `sizes` (every target, every
 * pass) alongside the actions in `rotated`. This paragraph described that fix
 * from 3.316.0 onward while the `if (r.rotated)` line was still there — a
 * comment is not a test, and it graded itself passing for two releases.
 *
 * A census is only observability once something says it out loud:
 * reportOpsRun (src/ops/scheduler.mjs) is the single path from this result to
 * a human, and every field added here must be printed there or it is a
 * measurement nobody reads.
 *
 * Not handled here: per-run / per-session files (blackboard, swarm journals,
 * transcripts) — bounded by their own lifecycle; and the ledger day segments,
 * which compaction owns (whole-day deletes only, never partial loss).
 * Screenshots (computer-act-tool, browser-cdp) are knowingly deferred, not
 * forgotten: 21 files / 692K live, and XCLAW_SCREENSHOT_DIR is undocumented.
 * Three times now a directory of discrete artifacts has been unbounded because
 * it was named in neither list, so absence from both is no longer allowed to
 * mean anything — anything not swept is named above as a deliberate choice.
 *
 * Concurrency note: appenders are fire-and-forget fs.appendFile; an append
 * landing between our read and rename is lost. The window is milliseconds
 * once a day on operational telemetry — accepted, documented.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { compactLedger } from "./ledger.mjs";
import { routerEventsPath } from "../providers/model-stats.mjs";
import { cronEventsLogPath, doctorLogPath } from "../cron/logs.mjs";
import { defaultLedgerPath } from "../tokens/usage-tracker.mjs";
import { mitmConfdir } from "../browser/mitm.mjs";
import { pruneCheckpoints } from "../jobs/checkpoint.mjs";
import { pruneMemoryWorkspaces } from "../memory/durable.mjs";

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024; // 8MB trigger
const DEFAULT_KEEP_BYTES = 4 * 1024 * 1024; // tail kept in place

// Proof bundles are audit evidence: worth a month, not worth forever. The
// count ceiling is the bound that actually holds — age alone lets a burst
// blow the directory up inside the window. Both are sized above the live
// population (1214 files over 15 days) so enabling retention does not
// retroactively destroy evidence already on disk.
const DEFAULT_PROOF_MAX_AGE_DAYS = 30;
const DEFAULT_PROOF_KEEP_MAX = 2000;
const PROOF_BUNDLE_RE = /^proof_\d+\.json$/;

// same resolution as the loop's persistLedger (loop.mjs ~L678)
function costLedgerPath(cfg = {}) {
  return defaultLedgerPath(cfg);
}

/**
 * Rotate one JSONL file if it exceeds maxBytes: head → `<p>.1` (overwrite),
 * newest line-aligned tail (≤ keepBytes) stays at `p` via tmp+rename.
 * Returns { rotated, bytes, keptBytes } (rotated:false when under cap/absent).
 */
export async function rotateJsonlIfOversize(p, opts = {}) {
  const maxBytes = Number(opts.maxBytes) > 0 ? Number(opts.maxBytes) : DEFAULT_MAX_BYTES;
  const keepBytes = Number(opts.keepBytes) > 0 ? Number(opts.keepBytes) : DEFAULT_KEEP_BYTES;
  let st;
  try {
    st = await fs.stat(p);
  } catch {
    return { rotated: false, reason: "absent", path: p };
  }
  if (!st.isFile() || st.size <= maxBytes) {
    return { rotated: false, reason: "under_cap", bytes: st.size, path: p };
  }
  const buf = await fs.readFile(p);
  // line-align the split: tail starts at the first newline boundary within
  // the final keepBytes window (never a partial JSON line)
  let cut = Math.max(0, buf.length - keepBytes);
  const nl = buf.indexOf(0x0a, cut);
  cut = nl === -1 ? buf.length : nl + 1;
  const head = buf.subarray(0, cut);
  const tail = buf.subarray(cut);
  await fs.writeFile(`${p}.1`, head);
  const tmp = `${p}.tmp-rotate-${process.pid}`;
  await fs.writeFile(tmp, tail);
  await fs.rename(tmp, p);
  return { rotated: true, bytes: st.size, keptBytes: tail.length, path: p };
}


/**
 * Retention for a directory of discrete files: delete entries older than
 * maxAgeMs, then keep at most keepMax of what remains (newest first).
 *
 * Deletes only regular files whose name matches `match`, so a mis-pointed dir
 * cannot eat anything it did not create. Returns the census — files/bytes seen
 * — regardless of whether it pruned, because the point is to make growth
 * visible before a ceiling is reached, not only after.
 */
export async function pruneDirByAge(dir, opts = {}) {
  const maxAgeMs = Number(opts.maxAgeMs) > 0 ? Number(opts.maxAgeMs) : Infinity;
  const keepMax = Number(opts.keepMax) > 0 ? Number(opts.keepMax) : Infinity;
  const match = opts.match instanceof RegExp ? opts.match : null;
  const out = { dir, files: 0, bytes: 0, pruned: 0, prunedBytes: 0, reason: "ok" };

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    out.reason = "absent";
    return out;
  }

  const cutoff = Date.now() - maxAgeMs;
  const eligible = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const p = path.join(dir, e.name);
    let st;
    try {
      st = await fs.stat(p);
    } catch {
      continue; // vanished under us; nothing to count and nothing to delete
    }
    out.files += 1;
    out.bytes += st.size;
    if (match && !match.test(e.name)) continue;
    eligible.push({ path: p, mtimeMs: st.mtimeMs, size: st.size });
  }

  eligible.sort((a, b) => b.mtimeMs - a.mtimeMs); // newest first
  const doomed = eligible.filter((f, i) => f.mtimeMs < cutoff || i >= keepMax);
  for (const f of doomed) {
    try {
      await fs.unlink(f.path);
      out.pruned += 1;
      out.prunedBytes += f.size;
    } catch {
      // a concurrent reader on Windows, or a file already gone: the next pass
      // gets it. Never let one undeletable file abort the sweep.
    }
  }
  return out;
}

/**
 * Run the daily maintenance pass. Never throws; per-target failures are
 * reported in the result. Gate: cfg.ops.maintenance.enabled !== false.
 */
export async function runOpsMaintenance(cfg = {}) {
  if (cfg.ops?.maintenance?.enabled === false) {
    return { skipped: true, reason: "disabled" };
  }
  const maxBytes = Number(cfg.ops?.maintenance?.maxBytes) || DEFAULT_MAX_BYTES;
  const keepBytes = Math.min(Number(cfg.ops?.maintenance?.keepBytes) || DEFAULT_KEEP_BYTES, maxBytes);
  const out = { skipped: false, ledger: null, rotated: [], sizes: [], dirs: [], checkpoints: null, memory: null, errors: [] };

  try {
    out.ledger = await compactLedger(cfg);
  } catch (e) {
    out.errors.push({ target: "ledger", error: e?.message || String(e) });
  }

  const targets = [
    routerEventsPath(cfg),
    costLedgerPath(cfg),
    cronEventsLogPath(cfg),
    doctorLogPath(cfg),
  ];
  for (const p of targets) {
    if (!p) continue;
    try {
      const r = await rotateJsonlIfOversize(p, { maxBytes, keepBytes });
      // Measurement first, action second: `sizes` holds every target on every
      // pass so growth is visible before a ceiling is crossed, `rotated` holds
      // only what was actually moved.
      out.sizes.push(r);
      if (r.rotated) out.rotated.push(r);
    } catch (e) {
      out.errors.push({ target: p, error: e?.message || String(e) });
    }
  }

  const mt = cfg.ops?.maintenance || {};
  const proofsDir = path.join(mitmConfdir(cfg), "proofs");
  try {
    out.dirs.push(
      await pruneDirByAge(proofsDir, {
        maxAgeMs:
          (Number(mt.proofMaxAgeDays) > 0 ? Number(mt.proofMaxAgeDays) : DEFAULT_PROOF_MAX_AGE_DAYS) *
          86_400_000,
        keepMax: Number(mt.proofKeepMax) > 0 ? Number(mt.proofKeepMax) : DEFAULT_PROOF_KEEP_MAX,
        match: PROOF_BUNDLE_RE,
      })
    );
  } catch (e) {
    out.errors.push({ target: proofsDir, error: e?.message || String(e) });
  }

  // No override: pruneCheckpoints already reads cfg.checkpoints, and a second
  // default here would be a divergent duplicate of the policy it owns.
  try {
    out.checkpoints = await pruneCheckpoints(cfg, { dryRun: false });
  } catch (e) {
    out.errors.push({ target: "checkpoints", error: e?.message || String(e) });
  }

  // Same rule as checkpoints: the primitive owns its policy (cfg.memory.*),
  // so no default is restated here to drift away from it.
  try {
    out.memory = await pruneMemoryWorkspaces(cfg);
  } catch (e) {
    out.errors.push({ target: "memory", error: e?.message || String(e) });
  }

  return out;
}

export default { runOpsMaintenance, rotateJsonlIfOversize, pruneDirByAge };

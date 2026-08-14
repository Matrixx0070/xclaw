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
 * Not handled here: per-run / per-session files (blackboard, swarm journals,
 * transcripts) — bounded by their own lifecycle; and the ledger day segments,
 * which compaction owns (whole-day deletes only, never partial loss).
 *
 * Concurrency note: appenders are fire-and-forget fs.appendFile; an append
 * landing between our read and rename is lost. The window is milliseconds
 * once a day on operational telemetry — accepted, documented.
 */

import fs from "node:fs/promises";
import { compactLedger } from "./ledger.mjs";
import { routerEventsPath } from "../providers/model-stats.mjs";
import { cronEventsLogPath, doctorLogPath } from "../cron/logs.mjs";
import { defaultLedgerPath } from "../tokens/usage-tracker.mjs";

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024; // 8MB trigger
const DEFAULT_KEEP_BYTES = 4 * 1024 * 1024; // tail kept in place

// same resolution as the loop's persistLedger (loop.mjs ~L678)
function costLedgerPath(cfg = {}) {
  return cfg.tokens?.ledgerPath || defaultLedgerPath();
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
 * Run the daily maintenance pass. Never throws; per-target failures are
 * reported in the result. Gate: cfg.ops.maintenance.enabled !== false.
 */
export async function runOpsMaintenance(cfg = {}) {
  if (cfg.ops?.maintenance?.enabled === false) {
    return { skipped: true, reason: "disabled" };
  }
  const maxBytes = Number(cfg.ops?.maintenance?.maxBytes) || DEFAULT_MAX_BYTES;
  const keepBytes = Math.min(Number(cfg.ops?.maintenance?.keepBytes) || DEFAULT_KEEP_BYTES, maxBytes);
  const out = { skipped: false, ledger: null, rotated: [], errors: [] };

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
    try {
      const r = await rotateJsonlIfOversize(p, { maxBytes, keepBytes });
      if (r.rotated) out.rotated.push(r);
    } catch (e) {
      out.errors.push({ target: p, error: e?.message || String(e) });
    }
  }
  return out;
}

export default { runOpsMaintenance, rotateJsonlIfOversize };

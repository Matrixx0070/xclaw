/**
 * Summarize quota escalate rates from job history for smoke artifacts.
 */
import fs from "node:fs";
import path from "node:path";

export function emptyQuotaEscalate() {
  return {
    jobs: 0,
    softWarns: 0,
    hardBlocks: 0,
    escalatedFromSoft: 0,
    hardBlockRate: 0,
    softWarnRate: 0,
  };
}

export function normalizeQuotaEscalate(q = {}) {
  const base = emptyQuotaEscalate();
  return {
    jobs: Number(q.jobs) || 0,
    softWarns: Number(q.softWarns) || 0,
    hardBlocks: Number(q.hardBlocks) || 0,
    escalatedFromSoft: Number(q.escalatedFromSoft) || 0,
    hardBlockRate: Number(q.hardBlockRate) || 0,
    softWarnRate: Number(q.softWarnRate) || 0,
    ...Object.fromEntries(
      Object.entries(base).map(([k, v]) => [k, Number(q[k]) || v])
    ),
  };
}

export function summarizeQuotaEscalate(jobs = []) {
  const list = Array.isArray(jobs) ? jobs : [];
  let softWarns = 0;
  let hardBlocks = 0;
  let escalatedFromSoft = 0;
  for (const j of list) {
    const q = j?.quotaEscalate || j?.receiptMetrics?.quotaEscalate || {};
    softWarns += Number(q.softWarns) || 0;
    hardBlocks += Number(q.hardBlocks) || 0;
    escalatedFromSoft += Number(q.escalatedFromSoft) || 0;
  }
  const n = list.length;
  return normalizeQuotaEscalate({
    jobs: n,
    softWarns,
    hardBlocks,
    escalatedFromSoft,
    hardBlockRate: n ? hardBlocks / n : 0,
    softWarnRate: n ? softWarns / n : 0,
  });
}

export function loadJobIndexQuota(root, cfgDir) {
  const dir = cfgDir || path.join(root, "reports", "jobs");
  const idx = path.join(dir, "index.jsonl");
  if (!fs.existsSync(idx)) return emptyQuotaEscalate();
  const jobs = fs
    .readFileSync(idx, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return summarizeQuotaEscalate(jobs);
}

export default {
  summarizeQuotaEscalate,
  loadJobIndexQuota,
  emptyQuotaEscalate,
  normalizeQuotaEscalate,
};

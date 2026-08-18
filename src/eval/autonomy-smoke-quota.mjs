/**
 * Summarize quota escalate rates from job history for smoke artifacts.
 */
import fs from "node:fs";
import path from "node:path";

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
  return {
    jobs: n,
    softWarns,
    hardBlocks,
    escalatedFromSoft,
    hardBlockRate: n ? hardBlocks / n : 0,
    softWarnRate: n ? softWarns / n : 0,
  };
}

export function loadJobIndexQuota(root, cfgDir) {
  const dir = cfgDir || path.join(root, "reports", "jobs");
  const idx = path.join(dir, "index.jsonl");
  if (!fs.existsSync(idx)) return summarizeQuotaEscalate([]);
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

export default { summarizeQuotaEscalate, loadJobIndexQuota };

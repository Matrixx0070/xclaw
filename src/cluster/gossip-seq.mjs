/**
 * Per-owner gossip seq ledger — reject seq <= last.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function seqLedgerPath(cfg = {}) {
  const base =
    cfg.paths?.configDir ||
    process.env.XCLAW_CONFIG_DIR ||
    path.join(os.homedir(), ".xclaw");
  return path.join(base, "gossip-seq.json");
}

export function readSeqLedger(cfg = {}) {
  try {
    return JSON.parse(fs.readFileSync(seqLedgerPath(cfg), "utf8"));
  } catch {
    return { owners: {}, at: null };
  }
}

function writeLedger(cfg, data) {
  const fp = seqLedgerPath(cfg);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const tmp = fp + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  try {
    const fd = fs.openSync(tmp, "r+");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
  } catch {
    /* */
  }
  fs.renameSync(tmp, fp);
}

export function nextSeq(cfg = {}, owner = "local") {
  const data = readSeqLedger(cfg);
  const last = Number(data.owners?.[owner]?.seq) || 0;
  return last + 1;
}

export function seqGcMax(cfg = {}) {
  const n = Number(cfg?.cluster?.seqGcMax ?? process.env.XCLAW_SEQ_GC_MAX ?? 10_000);
  return Number.isFinite(n) && n > 0 ? n : 10_000;
}

export function seqHotMs(cfg = {}) {
  const n = Number(cfg?.cluster?.seqHotMs ?? process.env.XCLAW_SEQ_HOT_MS ?? 86_400_000);
  return Number.isFinite(n) && n > 0 ? n : 86_400_000;
}

export function ownerCount(data) {
  return Object.keys(data?.owners || {}).length;
}

export function compactSeqLedger(cfg = {}, data = null) {
  const cur = data || readSeqLedger(cfg);
  const max = seqGcMax(cfg);
  const n = ownerCount(cur);
  if (n <= max * 2) return { ok: true, compacted: false, owners: n };
  const hotMs = seqHotMs(cfg);
  const now = Date.now();
  const entries = Object.entries(cur.owners || {}).map(([owner, v]) => ({
    owner,
    seq: v.seq,
    at: v.at,
    ts: Date.parse(v.at || 0) || 0,
  }));
  const hot = entries.filter((e) => now - e.ts < hotMs);
  const cold = entries.filter((e) => now - e.ts >= hotMs).sort((a, b) => b.ts - a.ts);
  const keepCold = Math.max(0, max - hot.length);
  const keep = [...hot, ...cold.slice(0, keepCold)];
  const next = { owners: {}, at: new Date().toISOString(), compacted: true };
  for (const e of keep) next.owners[e.owner] = { seq: e.seq, at: e.at };
  const fp = seqLedgerPath(cfg);
  try {
    fs.copyFileSync(fp, fp + ".bak");
  } catch {
    /* */
  }
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const tmp = fp + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  try {
    const fd = fs.openSync(tmp, "r+");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
  } catch {
    /* */
  }
  fs.renameSync(tmp, fp);
  return { ok: true, compacted: true, owners: ownerCount(next), dropped: n - ownerCount(next) };
}

export function acceptSeq(cfg = {}, { owner = "local", seq } = {}) {
  const s = Number(seq);
  if (!Number.isFinite(s) || s < 1) {
    return { ok: false, code: "GOSSIP_SEQ", reason: "seq" };
  }
  const data = readSeqLedger(cfg);
  const last = Number(data.owners?.[owner]?.seq) || 0;
  if (s <= last) {
    return { ok: false, code: "GOSSIP_SEQ", reason: "seq", last, seq: s };
  }
  data.owners = data.owners || {};
  data.owners[owner] = { seq: s, at: new Date().toISOString() };
  data.at = new Date().toISOString();
  writeLedger(cfg, data);
  try {
    compactSeqLedger(cfg, data);
  } catch {
    /* */
  }
  return { ok: true, seq: s, last };
}

export default {
  readSeqLedger,
  nextSeq,
  acceptSeq,
  seqLedgerPath,
  compactSeqLedger,
  ownerCount,
};

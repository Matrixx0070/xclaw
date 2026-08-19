/**
 * Per-owner gossip seq ledger — optional per-region shards.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { acceptFence } from "./compact-fence.mjs";

export function seqDir(cfg = {}) {
  return cfg.paths?.configDir || process.env.XCLAW_CONFIG_DIR || path.join(os.homedir(), ".xclaw");
}

export function sanitizeRegion(region = "local") {
  return String(region || "local").replace(/[^a-zA-Z0-9._-]/g, "_") || "local";
}

export function seqLedgerPath(cfg = {}, region = null) {
  const base = seqDir(cfg);
  if (!region) return path.join(base, "gossip-seq.json");
  return path.join(base, `gossip-seq.${sanitizeRegion(region)}.json`);
}

export function seqShardPath(cfg = {}, region = "local") {
  return seqLedgerPath(cfg, region);
}

export function readSeqLedger(cfg = {}, region = null) {
  try {
    return JSON.parse(fs.readFileSync(seqLedgerPath(cfg, region), "utf8"));
  } catch {
    return { owners: {}, at: null };
  }
}

function writeLedger(cfg, data, region = null) {
  const fp = seqLedgerPath(cfg, region);
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

export function nextSeq(cfg = {}, owner = "local", region = null) {
  const data = readSeqLedger(cfg, region);
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
  // Fencing: a holder carrying an outdated fence must not compact, even when
  // the ledger is small enough to short-circuit below.
  if (cfg.compactFence != null) {
    const gate = acceptFence(cfg, cfg._seqRegion || "local", cfg.compactFence);
    if (!gate.ok) {
      return {
        ok: false,
        compacted: false,
        code: gate.code || "STALE_FENCE",
        fence: cfg.compactFence,
        current: gate.current,
      };
    }
  }
  const cur = data || readSeqLedger(cfg, cfg._seqRegion || null);
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
  const fp = seqLedgerPath(cfg, cfg._seqRegion || null);
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

export function acceptSeq(cfg = {}, { owner = "local", seq, region = null } = {}) {
  const s = Number(seq);
  if (!Number.isFinite(s) || s < 1) {
    return { ok: false, code: "GOSSIP_SEQ", reason: "seq" };
  }
  const data = readSeqLedger(cfg, region);
  const last = Number(data.owners?.[owner]?.seq) || 0;
  if (s <= last) {
    return { ok: false, code: "GOSSIP_SEQ", reason: "seq", last, seq: s };
  }
  data.owners = data.owners || {};
  data.owners[owner] = { seq: s, at: new Date().toISOString() };
  data.at = new Date().toISOString();
  writeLedger(cfg, data, region);
  try {
    compactSeqLedger({ ...cfg, _seqRegion: region }, data);
  } catch {
    /* */
  }
  return { ok: true, seq: s, last };
}

export function listSeqShards(cfg = {}) {
  const dir = seqDir(cfg);
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((n) => n.startsWith("gossip-seq") && n.endsWith(".json") && !n.endsWith(".bak"));
}

export function shardOwnerCounts(cfg = {}) {
  const out = {};
  for (const name of listSeqShards(cfg)) {
    const region =
      name === "gossip-seq.json" ? "local" : name.replace(/^gossip-seq\./, "").replace(/\.json$/, "");
    try {
      const data = JSON.parse(fs.readFileSync(path.join(seqDir(cfg), name), "utf8"));
      out[region] = ownerCount(data);
    } catch {
      out[region] = 0;
    }
  }
  return out;
}

export default {
  readSeqLedger,
  nextSeq,
  acceptSeq,
  seqLedgerPath,
  compactSeqLedger,
  ownerCount,
  listSeqShards,
  shardOwnerCounts,
};

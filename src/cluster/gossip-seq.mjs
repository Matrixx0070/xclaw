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
  return { ok: true, seq: s, last };
}

export default { readSeqLedger, nextSeq, acceptSeq, seqLedgerPath };

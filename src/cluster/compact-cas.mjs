/**
 * CAS write for seq shard: refuse if disk fence > holder fence.
 */
import fs from "node:fs";
import path from "node:path";
import { appendCompactAudit } from "./compact-audit.mjs";

const reject = { cas_reject_total: 0 };

export function incCasReject() {
  reject.cas_reject_total += 1;
  return reject.cas_reject_total;
}

export function getCasRejectTotal() {
  return reject.cas_reject_total;
}

export function resetCasReject() {
  reject.cas_reject_total = 0;
}

export function casWriteShard(fp, next, { fence = 0 } = {}) {
  let disk = { fence: 0 };
  try {
    disk = JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    /* new file */
  }
  const diskFence = Number(disk.fence) || 0;
  const holder = Number(fence) || 0;
  if (diskFence > holder) {
    incCasReject();
    return { ok: false, code: "CAS_REJECT", diskFence, fence: holder };
  }
  const body = { ...next, fence: Math.max(diskFence, holder) };
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const tmp = fp + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(body, null, 2));
  try {
    const fd = fs.openSync(tmp, "r+");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
  } catch {
    /* */
  }
  fs.renameSync(tmp, fp);
  try {
    appendCompactAudit(cfgFromPath(fp), {
      fence: body.fence,
      compacted: true,
      region: regionFromPath(fp),
    });
  } catch {
    /* */
  }
  return { ok: true, fence: body.fence };
}

function regionFromPath(fp) {
  const b = path.basename(fp);
  if (b.startsWith("gossip-seq.") && b.endsWith(".json") && b !== "gossip-seq.json") {
    return b.slice("gossip-seq.".length, -".json".length);
  }
  return "local";
}

function cfgFromPath(fp) {
  return { paths: { configDir: path.dirname(fp) } };
}

export default { casWriteShard, getCasRejectTotal, incCasReject, resetCasReject };

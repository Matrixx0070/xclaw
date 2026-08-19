/**
 * Sliding two-generation bloom for gossip nonces.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function hash32(s) {
  let h = 2166136261;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createBloom({ bits = 4096, hashes = 4 } = {}) {
  return { bits, hashes, a: new Uint8Array(bits), b: new Uint8Array(bits), gen: 0, count: 0 };
}

function indices(nonce, bits, hashes) {
  const h1 = hash32(nonce);
  const h2 = hash32(nonce + ":2") || 1;
  const out = [];
  for (let i = 0; i < hashes; i++) out.push((h1 + i * h2) % bits);
  return out;
}

export function bloomAdd(bloom, nonce) {
  if (!bloom || nonce == null) return bloom;
  if (bloom.count > bloom.bits / 8) {
    bloom.b = bloom.a;
    bloom.a = new Uint8Array(bloom.bits);
    bloom.count = 0;
    bloom.gen++;
  }
  for (const i of indices(nonce, bloom.bits, bloom.hashes)) bloom.a[i] = 1;
  bloom.count++;
  return bloom;
}

export function bloomMightContain(bloom, nonce) {
  if (!bloom || nonce == null) return false;
  const idx = indices(nonce, bloom.bits, bloom.hashes);
  const inA = idx.every((i) => bloom.a[i]);
  const inB = idx.every((i) => bloom.b[i]);
  return inA || inB;
}

const defaultBloom = createBloom();

export function bloomPath(cfg = {}) {
  const base =
    cfg.paths?.configDir ||
    process.env.XCLAW_CONFIG_DIR ||
    path.join(os.homedir(), ".xclaw");
  return path.join(base, "gossip-bloom.bin");
}

export function saveBloom(bloom, cfg = {}) {
  const fp = bloomPath(cfg);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const meta = Buffer.from(
    JSON.stringify({
      bits: bloom.bits,
      hashes: bloom.hashes,
      gen: bloom.gen,
      count: bloom.count,
    })
  );
  const header = Buffer.alloc(4);
  header.writeUInt32BE(meta.length);
  const body = Buffer.concat([header, meta, Buffer.from(bloom.a), Buffer.from(bloom.b)]);
  const tmp = fp + ".tmp";
  fs.writeFileSync(tmp, body);
  try {
    const fd = fs.openSync(tmp, "r+");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
  } catch {
    /* */
  }
  fs.renameSync(tmp, fp);
  return fp;
}

export function loadBloom(cfg = {}, { prod = false } = {}) {
  const fp = bloomPath(cfg);
  try {
    const buf = fs.readFileSync(fp);
    const n = buf.readUInt32BE(0);
    const meta = JSON.parse(buf.subarray(4, 4 + n).toString("utf8"));
    const bits = meta.bits || 4096;
    const aStart = 4 + n;
    const a = new Uint8Array(buf.subarray(aStart, aStart + bits));
    const b = new Uint8Array(buf.subarray(aStart + bits, aStart + bits * 2));
    return { bits, hashes: meta.hashes || 4, a, b, gen: meta.gen || 0, count: meta.count || 0 };
  } catch (e) {
    if (prod && fs.existsSync(fp)) {
      return { ok: false, code: "BLOOM_CORRUPT", error: String(e.message || e) };
    }
    return createBloom();
  }
}

export function maybePersistBloom(bloom, cfg = {}, every = 32) {
  if ((bloom.count || 0) % every === 0 && bloom.count > 0) saveBloom(bloom, cfg);
}

export function acceptNonce(nonce, bloom = defaultBloom, cfg = {}) {
  if (nonce == null || nonce === "") return { ok: true, skipped: true };
  if (bloomMightContain(bloom, nonce)) {
    return { ok: false, code: "GOSSIP_NONCE", reason: "nonce" };
  }
  bloomAdd(bloom, nonce);
  try {
    maybePersistBloom(bloom, cfg);
  } catch {
    /* */
  }
  return { ok: true };
}

export function resetBloom(bloom = defaultBloom) {
  bloom.a.fill(0);
  bloom.b.fill(0);
  bloom.count = 0;
  bloom.gen = 0;
}

export default {
  createBloom,
  bloomAdd,
  bloomMightContain,
  acceptNonce,
  resetBloom,
  saveBloom,
  loadBloom,
};

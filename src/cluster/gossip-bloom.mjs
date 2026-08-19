/**
 * Sliding two-generation bloom for gossip nonces.
 * False positives fail closed (reject).
 */
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

export function acceptNonce(nonce, bloom = defaultBloom) {
  if (nonce == null || nonce === "") return { ok: true, skipped: true };
  if (bloomMightContain(bloom, nonce)) {
    return { ok: false, code: "GOSSIP_NONCE", reason: "nonce" };
  }
  bloomAdd(bloom, nonce);
  return { ok: true };
}

export function resetBloom(bloom = defaultBloom) {
  bloom.a.fill(0);
  bloom.b.fill(0);
  bloom.count = 0;
  bloom.gen = 0;
}

export default { createBloom, bloomAdd, bloomMightContain, acceptNonce, resetBloom };

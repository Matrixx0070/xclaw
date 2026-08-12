/**
 * Decode CBOR-encoded COSE_Key (WebAuthn credentialPublicKey).
 * Minimal CBOR subset: ints, bstr, tstr, arrays, maps (definite length).
 * Labels per RFC 9052 / 9053 + WebAuthn EC2/OKP/RSA.
 */

const KTY = { 1: "OKP", 2: "EC2", 3: "RSA", 4: "Symmetric" };
const CRV = {
  1: "P-256",
  2: "P-384",
  3: "P-521",
  4: "X25519",
  5: "X448",
  6: "Ed25519",
  7: "Ed448",
};
const ALG = {
  [-7]: "ES256",
  [-35]: "ES384",
  [-36]: "ES512",
  [-8]: "EdDSA",
  [-37]: "PS256",
  [-38]: "PS384",
  [-39]: "PS512",
  [-257]: "RS256",
  [-258]: "RS384",
  [-259]: "RS512",
};

class CborReader {
  constructor(buf) {
    this.buf = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    this.i = 0;
  }

  get remaining() {
    return this.buf.length - this.i;
  }

  u8() {
    if (this.i >= this.buf.length) throw new Error("CBOR truncated");
    return this.buf[this.i++];
  }

  read(n) {
    if (this.i + n > this.buf.length) throw new Error("CBOR truncated");
    const s = this.buf.subarray(this.i, this.i + n);
    this.i += n;
    return s;
  }

  /** Additional info length / value */
  aiValue(ai) {
    if (ai < 24) return ai;
    if (ai === 24) return this.u8();
    if (ai === 25) return this.read(2).readUInt16BE(0);
    if (ai === 26) return this.read(4).readUInt32BE(0);
    if (ai === 27) {
      const big = this.read(8);
      // JS safe integer check
      const hi = big.readUInt32BE(0);
      const lo = big.readUInt32BE(4);
      if (hi > 0x1fffff) return BigInt(hi) * 0x100000000n + BigInt(lo);
      return hi * 0x100000000 + lo;
    }
    if (ai === 31) throw new Error("indefinite length not supported");
    throw new Error(`unsupported additional info ${ai}`);
  }

  decode() {
    const ib = this.u8();
    const major = ib >> 5;
    const ai = ib & 0x1f;

    switch (major) {
      case 0: // unsigned
        return this.aiValue(ai);
      case 1: {
        // negative: -1 - n
        const n = this.aiValue(ai);
        if (typeof n === "bigint") return -1n - n;
        return -1 - n;
      }
      case 2: {
        // bstr
        const len = this.aiValue(ai);
        return this.read(Number(len));
      }
      case 3: {
        // tstr
        const len = this.aiValue(ai);
        return this.read(Number(len)).toString("utf8");
      }
      case 4: {
        const len = this.aiValue(ai);
        const arr = [];
        for (let k = 0; k < len; k++) arr.push(this.decode());
        return arr;
      }
      case 5: {
        const len = this.aiValue(ai);
        const map = new Map();
        for (let k = 0; k < len; k++) {
          const key = this.decode();
          const val = this.decode();
          map.set(key, val);
        }
        return map;
      }
      case 6: {
        // tag — skip tag number, return nested
        this.aiValue(ai);
        return this.decode();
      }
      case 7: {
        if (ai === 20) return false;
        if (ai === 21) return true;
        if (ai === 22) return null;
        if (ai === 23) return undefined;
        if (ai === 25) {
          // float16 — rare; skip
          this.read(2);
          return NaN;
        }
        if (ai === 26) {
          const b = this.read(4);
          return b.readFloatBE(0);
        }
        if (ai === 27) {
          const b = this.read(8);
          return b.readDoubleBE(0);
        }
        throw new Error(`unsupported simple/float ai=${ai}`);
      }
      default:
        throw new Error(`unsupported major type ${major}`);
    }
  }
}

export function decodeCbor(buf) {
  const r = new CborReader(buf);
  const v = r.decode();
  return { value: v, bytesRead: r.i, remaining: r.remaining };
}

function mapGet(m, k) {
  if (m instanceof Map) return m.get(k);
  return m[k];
}

function bstrToHex(v) {
  if (v == null) return null;
  if (Buffer.isBuffer(v)) return v.toString("hex");
  if (v instanceof Uint8Array) return Buffer.from(v).toString("hex");
  return null;
}

/**
 * Decode COSE_Key bytes → structured object.
 * @param {Buffer|Uint8Array|string} input — raw bytes, or hex, or base64/base64url
 */
export function decodeCoseKey(input) {
  const buf = coerceToBuffer(input);
  const { value, bytesRead, remaining } = decodeCbor(buf);
  if (!(value instanceof Map) && typeof value !== "object") {
    throw new Error("COSE_Key must be a CBOR map");
  }

  const get = (k) => mapGet(value, k);
  const ktyN = get(1);
  const algN = get(3);
  const kid = get(2);

  const out = {
    kty: KTY[ktyN] || ktyN,
    ktyNumeric: ktyN,
    alg: ALG[algN] || algN,
    algNumeric: algN,
    kid: Buffer.isBuffer(kid) ? kid.toString("hex") : kid,
    bytesRead,
    remaining,
    rawLabels: {},
  };

  // Preserve all labels for debugging
  const entries =
    value instanceof Map ? [...value.entries()] : Object.entries(value);
  for (const [k, v] of entries) {
    out.rawLabels[String(k)] = Buffer.isBuffer(v)
      ? { bstrHex: v.toString("hex"), len: v.length }
      : v;
  }

  if (ktyN === 2) {
    // EC2
    const crv = get(-1);
    out.crv = CRV[crv] || crv;
    out.crvNumeric = crv;
    out.x = bstrToHex(get(-2));
    out.y = bstrToHex(get(-3));
    out.xLen = get(-2)?.length;
    out.yLen = get(-3)?.length;
    // SEC1 uncompressed form helper (0x04 || x || y)
    if (out.x && out.y) {
      out.uncompressedHex = "04" + out.x + out.y;
    }
  } else if (ktyN === 1) {
    // OKP
    const crv = get(-1);
    out.crv = CRV[crv] || crv;
    out.crvNumeric = crv;
    out.x = bstrToHex(get(-2));
    out.xLen = get(-2)?.length;
  } else if (ktyN === 3) {
    // RSA
    out.n = bstrToHex(get(-1));
    out.e = bstrToHex(get(-2));
    out.nLen = get(-1)?.length;
    out.eLen = get(-2)?.length;
  }

  return out;
}

function coerceToBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input);
  if (typeof input !== "string") {
    throw new Error("input must be Buffer, Uint8Array, hex, or base64");
  }
  const s = input.trim();
  // hex
  if (/^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0) {
    return Buffer.from(s, "hex");
  }
  // base64url
  if (/^[A-Za-z0-9_-]+$/.test(s)) {
    const pad = "=".repeat((4 - (s.length % 4)) % 4);
    const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(b64, "base64");
  }
  // base64
  return Buffer.from(s, "base64");
}

/**
 * Build a minimal CBOR-encoded EC2 P-256 COSE_Key (for tests).
 * x, y = 32-byte Buffers
 */
export function encodeCoseKeyEs256(x, y) {
  // Hand-built definite map — labels 1,3,-1,-2,-3
  // A5 = map 5 pairs
  const parts = [];
  const push = (b) => parts.push(Buffer.from(b));

  push([0xa5]);
  // 1: 2 (kty EC2)
  push([0x01, 0x02]);
  // 3: -7 (alg ES256) → CBOR major 1, value 6 → 0x26
  push([0x03, 0x26]);
  // -1: 1 (crv P-256) → 0x20 0x01
  push([0x20, 0x01]);
  // -2: x bstr 32
  push([0x21, 0x58, 0x20]);
  parts.push(Buffer.from(x));
  // -3: y bstr 32
  push([0x22, 0x58, 0x20]);
  parts.push(Buffer.from(y));

  return Buffer.concat(parts);
}

/** CLI-friendly decode */
export function decodeCoseKeyReport(input) {
  try {
    const k = decodeCoseKey(input);
    return { ok: true, key: k };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

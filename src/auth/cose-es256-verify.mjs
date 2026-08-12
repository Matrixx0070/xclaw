/**
 * Full ES256 (COSE alg -7) verification for COSE_Sign1.
 *
 * Algorithm: ECDSA with P-256 and SHA-256
 * Signature format: IEEE P1363 (r || s), 64 bytes
 *                  (also accepts DER and converts)
 *
 * Pipeline:
 *   1. Parse COSE_Sign1 (or accept pre-parsed fields)
 *   2. Require protected alg == -7 (ES256)
 *   3. Build Sig_structure / ToBeSigned
 *   4. Import public key from PEM, KeyObject, JWK, or COSE_Key (x,y)
 *   5. crypto.verify('sha256', ToBeSigned, { dsaEncoding: 'ieee-p1363' }, sig)
 */
import crypto from "node:crypto";
import {
  buildSign1ToBeSigned,
  parseCoseSign1,
} from "./cose-sign1-verify.mjs";
import { decodeCoseKey } from "./cose-key.mjs";

const ES256_ALG = -7;
const P256_COORD_LEN = 32;
const P1363_SIG_LEN = 64; // r(32) || s(32)

/**
 * Structured error for invalid keys / verify inputs.
 * code: INVALID_KEY | UNSUPPORTED_KEY | INVALID_COORD | WRONG_CURVE |
 *       WRONG_KTY | EMPTY_KEY | KEY_IMPORT_FAILED | INVALID_SIGNATURE_FORMAT
 */
export class CoseKeyError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CoseKeyError";
    this.code = code;
    this.details = details;
  }
}

function isAllZero(buf) {
  for (let i = 0; i < buf.length; i++) if (buf[i] !== 0) return false;
  return true;
}

/**
 * Convert hex or Buffer to fixed-length 32-byte coordinate (left-pad if needed).
 */
function coordToBuffer(input, name = "coord") {
  if (input == null || input === "") {
    throw new CoseKeyError("INVALID_COORD", `${name} is missing or empty`);
  }

  let b;
  try {
    if (Buffer.isBuffer(input)) b = input;
    else if (input instanceof Uint8Array) b = Buffer.from(input);
    else if (typeof input === "string") {
      const s = input.trim();
      if (!s) {
        throw new CoseKeyError("INVALID_COORD", `${name} is empty string`);
      }
      if (/^[0-9a-fA-F]+$/.test(s)) {
        if (s.length % 2 !== 0) {
          throw new CoseKeyError(
            "INVALID_COORD",
            `${name} hex length must be even`,
            { length: s.length }
          );
        }
        b = Buffer.from(s, "hex");
      } else {
        b = Buffer.from(s, "base64");
      }
    } else {
      throw new CoseKeyError(
        "INVALID_COORD",
        `${name} must be Buffer, hex, or base64`,
        { type: typeof input }
      );
    }
  } catch (e) {
    if (e instanceof CoseKeyError) throw e;
    throw new CoseKeyError("INVALID_COORD", `${name} decode failed: ${e.message}`);
  }

  if (b.length === 0) {
    throw new CoseKeyError("INVALID_COORD", `${name} decoded to empty buffer`);
  }

  if (b.length > P256_COORD_LEN) {
    let i = 0;
    while (i < b.length - P256_COORD_LEN && b[i] === 0) i++;
    b = b.subarray(i);
  }
  if (b.length > P256_COORD_LEN) {
    throw new CoseKeyError(
      "INVALID_COORD",
      `P-256 ${name} too long: ${b.length} bytes (max ${P256_COORD_LEN})`,
      { length: b.length }
    );
  }
  if (b.length < P256_COORD_LEN) {
    const out = Buffer.alloc(P256_COORD_LEN);
    b.copy(out, P256_COORD_LEN - b.length);
    b = out;
  }

  if (isAllZero(b)) {
    throw new CoseKeyError(
      "INVALID_COORD",
      `P-256 ${name} is all zeros (not a valid public coordinate)`
    );
  }
  return b;
}

/**
 * Base64url encode without padding (JWK).
 */
function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Build JWK for EC P-256 public key from x,y coordinates.
 */
export function p256JwkFromXY(x, y) {
  const xb = coordToBuffer(x, "x");
  const yb = coordToBuffer(y, "y");
  return {
    kty: "EC",
    crv: "P-256",
    x: b64url(xb),
    y: b64url(yb),
  };
}

function assertEcP256KeyObject(keyObj) {
  if (!keyObj || keyObj.type !== "public") {
    throw new CoseKeyError("INVALID_KEY", "expected public KeyObject", {
      type: keyObj?.type,
    });
  }
  const asy = keyObj.asymmetricKeyType;
  if (asy && asy !== "ec") {
    throw new CoseKeyError("WRONG_KTY", `expected EC key, got ${asy}`, {
      asymmetricKeyType: asy,
    });
  }
  try {
    const jwk = keyObj.export({ format: "jwk" });
    if (jwk.kty && jwk.kty !== "EC") {
      throw new CoseKeyError("WRONG_KTY", `JWK kty must be EC, got ${jwk.kty}`);
    }
    if (jwk.crv && jwk.crv !== "P-256") {
      throw new CoseKeyError(
        "WRONG_CURVE",
        `ES256 requires P-256, got ${jwk.crv}`,
        { crv: jwk.crv }
      );
    }
  } catch (e) {
    if (e instanceof CoseKeyError) throw e;
    // export may fail for some key types — still reject non-ec above
  }
  return keyObj;
}

function createPublicKeySafe(spec, label) {
  try {
    const keyObj = crypto.createPublicKey(spec);
    return assertEcP256KeyObject(keyObj);
  } catch (e) {
    if (e instanceof CoseKeyError) throw e;
    throw new CoseKeyError(
      "KEY_IMPORT_FAILED",
      `invalid public key (${label}): ${e.message}`,
      { cause: e.message }
    );
  }
}

/**
 * Import public key for ES256 verify.
 * Accepts: KeyObject, PEM string, JWK object, or {x,y}/COSE_Key-like.
 * @throws {CoseKeyError}
 */
export function importEs256PublicKey(key) {
  if (key == null || key === "") {
    throw new CoseKeyError("EMPTY_KEY", "public key is null or empty");
  }

  // Already a KeyObject
  if (typeof key === "object" && key.type === "public" && key.asymmetricKeyType) {
    return assertEcP256KeyObject(key);
  }

  // Private KeyObject mistakenly passed
  if (typeof key === "object" && key.type === "private") {
    throw new CoseKeyError(
      "INVALID_KEY",
      "private KeyObject supplied; ES256 verify requires a public key"
    );
  }

  if (typeof key === "string") {
    const s = key.trim();
    if (!s) throw new CoseKeyError("EMPTY_KEY", "public key string is empty");

    if (/BEGIN\s+(EC\s+)?PUBLIC\s+KEY/i.test(s) || /BEGIN\s+PUBLIC\s+KEY/i.test(s)) {
      return createPublicKeySafe(s, "PEM");
    }
    if (/BEGIN\s+PRIVATE\s+KEY/i.test(s) || /BEGIN\s+EC\s+PRIVATE/i.test(s)) {
      throw new CoseKeyError(
        "INVALID_KEY",
        "PEM private key supplied; pass a public key or SPKI PEM"
      );
    }
    if (/BEGIN\s+CERTIFICATE/i.test(s)) {
      try {
        return createPublicKeySafe(s, "certificate");
      } catch (e) {
        throw new CoseKeyError(
          "KEY_IMPORT_FAILED",
          `certificate did not yield a valid P-256 public key: ${e.message}`
        );
      }
    }

    // COSE_Key hex / base64
    try {
      const cose = decodeCoseKey(s);
      return importFromDecodedCoseKey(cose);
    } catch (e) {
      if (e instanceof CoseKeyError) throw e;
      throw new CoseKeyError(
        "UNSUPPORTED_KEY",
        "string key must be PEM, certificate, or COSE_Key hex/base64",
        { cause: e.message }
      );
    }
  }

  // JWK
  if (key && typeof key === "object" && key.kty) {
    if (key.kty !== "EC") {
      throw new CoseKeyError("WRONG_KTY", `JWK kty must be EC, got ${key.kty}`, {
        kty: key.kty,
      });
    }
    if (key.crv && key.crv !== "P-256") {
      throw new CoseKeyError(
        "WRONG_CURVE",
        `ES256 requires crv P-256, got ${key.crv}`,
        { crv: key.crv }
      );
    }
    if (key.d) {
      throw new CoseKeyError(
        "INVALID_KEY",
        "JWK contains private field d; provide public-only JWK"
      );
    }
    if (key.x == null || key.y == null) {
      throw new CoseKeyError("INVALID_KEY", "EC JWK missing x or y");
    }
    return createPublicKeySafe({ key, format: "jwk" }, "JWK");
  }

  // COSE-like / {x,y}
  if (
    key &&
    typeof key === "object" &&
    (key.x != null || key.X != null) &&
    (key.y != null || key.Y != null)
  ) {
    if (key.kty && key.kty !== "EC2" && key.kty !== "EC" && key.kty !== 2) {
      throw new CoseKeyError("WRONG_KTY", `unexpected kty ${key.kty}`);
    }
    if (key.crv && key.crv !== "P-256" && key.crv !== 1 && key.crvNumeric !== 1) {
      throw new CoseKeyError("WRONG_CURVE", `expected P-256, got ${key.crv}`);
    }
    const jwk = p256JwkFromXY(key.x || key.X, key.y || key.Y);
    return createPublicKeySafe({ key: jwk, format: "jwk" }, "x,y coordinates");
  }

  // Buffer: SPKI DER or COSE_Key
  if (Buffer.isBuffer(key) || key instanceof Uint8Array) {
    const buf = Buffer.from(key);
    if (buf.length === 0) {
      throw new CoseKeyError("EMPTY_KEY", "key buffer is empty");
    }
    try {
      return createPublicKeySafe(
        { key: buf, format: "der", type: "spki" },
        "SPKI DER"
      );
    } catch (spkiErr) {
      try {
        const cose = decodeCoseKey(buf);
        return importFromDecodedCoseKey(cose);
      } catch (coseErr) {
        throw new CoseKeyError(
          "KEY_IMPORT_FAILED",
          "buffer is neither valid SPKI DER nor COSE_Key EC2 P-256",
          {
            spki: spkiErr.message,
            cose: coseErr.message,
          }
        );
      }
    }
  }

  throw new CoseKeyError("UNSUPPORTED_KEY", "unsupported public key format", {
    type: typeof key,
  });
}

function importFromDecodedCoseKey(cose) {
  if (!cose || (cose.kty !== "EC2" && cose.ktyNumeric !== 2)) {
    throw new CoseKeyError(
      "WRONG_KTY",
      `COSE_Key kty must be EC2 for ES256, got ${cose?.kty}`,
      { kty: cose?.kty }
    );
  }
  if (cose.crv && cose.crv !== "P-256" && cose.crvNumeric !== 1) {
    throw new CoseKeyError(
      "WRONG_CURVE",
      `COSE_Key crv must be P-256, got ${cose.crv}`,
      { crv: cose.crv }
    );
  }
  if (cose.alg && cose.alg !== "ES256" && cose.algNumeric !== -7) {
    // soft warn: still allow if curve is P-256
  }
  if (!cose.x || !cose.y) {
    throw new CoseKeyError("INVALID_KEY", "COSE_Key EC2 missing x or y");
  }
  const jwk = p256JwkFromXY(cose.x, cose.y);
  return createPublicKeySafe({ key: jwk, format: "jwk" }, "COSE_Key");
}

/**
 * Normalize signature to IEEE P1363 (r||s, 64 bytes).
 * Accepts P1363 or DER ECDSA signature.
 */
export function signatureToP1363(signature) {
  const sig = Buffer.from(signature);
  if (sig.length === P1363_SIG_LEN) return sig;

  // DER: SEQUENCE { INTEGER r, INTEGER s }
  if (sig[0] === 0x30) {
    try {
      return derEcdsaToP1363(sig);
    } catch (e) {
      throw new Error(`DER signature parse failed: ${e.message}`);
    }
  }

  throw new Error(
    `ES256 signature must be 64-byte P1363 or DER (got ${sig.length} bytes)`
  );
}

function derEcdsaToP1363(der) {
  // Minimal DER ECDSA parse
  let i = 0;
  if (der[i++] !== 0x30) throw new Error("not SEQUENCE");
  let seqLen = der[i++];
  if (seqLen & 0x80) {
    const n = seqLen & 0x7f;
    seqLen = 0;
    for (let j = 0; j < n; j++) seqLen = (seqLen << 8) | der[i++];
  }
  const readInt = () => {
    if (der[i++] !== 0x02) throw new Error("not INTEGER");
    let len = der[i++];
    if (len & 0x80) throw new Error("overlong int");
    let start = i;
    i += len;
    let buf = der.subarray(start, i);
    // strip leading zero padding from DER integer
    while (buf.length > 1 && buf[0] === 0x00 && (buf[1] & 0x80) === 0) {
      buf = buf.subarray(1);
    }
    // if high bit was set, DER had 0x00 prefix — already handled
    while (buf.length > 1 && buf[0] === 0x00) buf = buf.subarray(1);
    const out = Buffer.alloc(P256_COORD_LEN);
    if (buf.length > P256_COORD_LEN) {
      buf = buf.subarray(buf.length - P256_COORD_LEN);
    }
    buf.copy(out, P256_COORD_LEN - buf.length);
    return out;
  };
  const r = readInt();
  const s = readInt();
  return Buffer.concat([r, s]);
}

/**
 * Low-level ES256 verify: SHA-256 + ECDSA P-256 + P1363 signature.
 * @throws {CoseKeyError} on invalid key or signature format
 */
export function verifyEs256Raw(publicKey, toBeSigned, signature) {
  if (toBeSigned == null) {
    throw new CoseKeyError("INVALID_KEY", "toBeSigned is required");
  }
  if (signature == null) {
    throw new CoseKeyError(
      "INVALID_SIGNATURE_FORMAT",
      "signature is null or undefined"
    );
  }

  let key;
  try {
    key = importEs256PublicKey(publicKey);
  } catch (e) {
    if (e instanceof CoseKeyError) throw e;
    throw new CoseKeyError("KEY_IMPORT_FAILED", e.message);
  }

  let sig;
  try {
    sig = signatureToP1363(signature);
  } catch (e) {
    throw new CoseKeyError("INVALID_SIGNATURE_FORMAT", e.message);
  }

  const data = Buffer.from(toBeSigned);
  try {
    return crypto.verify(
      "sha256",
      data,
      {
        key,
        dsaEncoding: "ieee-p1363",
      },
      sig
    );
  } catch (e) {
    // Node may throw on malformed key usage
    throw new CoseKeyError(
      "KEY_IMPORT_FAILED",
      `ES256 verify operation failed: ${e.message}`,
      { cause: e.message }
    );
  }
}

/**
 * Full COSE_Sign1 + ES256 verification.
 *
 * @param {object} opts
 * @param {Buffer|Uint8Array} [opts.message] - full COSE_Sign1 CBOR
 * @param {Buffer} [opts.protectedBstr] - if not using message
 * @param {Buffer|null} [opts.payload]
 * @param {Buffer} [opts.signature]
 * @param {Buffer} [opts.externalAad]
 * @param {Buffer} [opts.detachedPayload]
 * @param {object|string|Buffer} opts.publicKey - PEM / JWK / {x,y} / COSE_Key / KeyObject
 */
export function verifyCoseSign1Es256(opts) {
  const {
    message,
    externalAad = Buffer.alloc(0),
    detachedPayload,
    publicKey,
  } = opts;

  let protectedBstr;
  let payload;
  let signature;
  let alg;

  if (message) {
    const parsed = parseCoseSign1(message);
    protectedBstr = parsed.protectedBstr;
    payload = parsed.payload;
    signature = parsed.signature;
    alg = parsed.alg;
    if (alg != null && Number(alg) !== ES256_ALG) {
      return {
        ok: false,
        error: `expected ES256 alg -7, got ${alg} (${parsed.algName})`,
      };
    }
  } else {
    protectedBstr = Buffer.from(opts.protectedBstr || []);
    payload = opts.payload === undefined ? null : opts.payload;
    signature = Buffer.from(opts.signature || []);
    alg = ES256_ALG;
  }

  if (publicKey == null || publicKey === "") {
    return {
      ok: false,
      error: "publicKey required",
      code: "EMPTY_KEY",
    };
  }
  if (!signature || !signature.length) {
    return {
      ok: false,
      error: "signature required",
      code: "INVALID_SIGNATURE_FORMAT",
    };
  }

  let payloadBstr;
  if (payload == null) {
    if (detachedPayload == null) {
      return {
        ok: false,
        error: "detached payload required when body payload is null",
      };
    }
    payloadBstr = Buffer.from(detachedPayload);
  } else {
    payloadBstr = Buffer.from(payload);
  }

  const toBeSigned = buildSign1ToBeSigned({
    protectedBstr: Buffer.from(protectedBstr),
    externalAad: Buffer.from(externalAad || []),
    payload: payloadBstr,
  });

  let ok;
  try {
    ok = verifyEs256Raw(publicKey, toBeSigned, signature);
  } catch (e) {
    return {
      ok: false,
      error: e.message || String(e),
      code: e.code || "KEY_IMPORT_FAILED",
      details: e.details || undefined,
      toBeSignedHex: toBeSigned.toString("hex"),
    };
  }

  return {
    ok: Boolean(ok),
    alg: ES256_ALG,
    algName: "ES256",
    toBeSignedHex: toBeSigned.toString("hex"),
    payload: payloadBstr,
    error: ok ? undefined : "ES256 signature invalid",
    code: ok ? undefined : "SIGNATURE_MISMATCH",
  };
}

/**
 * Self-test helper: generate P-256 key, sign ToBeSigned, verify.
 * Useful for fixture generation and CI.
 */
export function selfTestEs256(payloadText = "xclaw-cose-es256") {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });

  const protectedBstr = Buffer.alloc(0); // empty protected headers
  const payload = Buffer.from(payloadText, "utf8");
  const toBeSigned = buildSign1ToBeSigned({
    protectedBstr,
    externalAad: Buffer.alloc(0),
    payload,
  });

  const signature = crypto.sign("sha256", toBeSigned, {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });

  const ok = verifyEs256Raw(publicKey, toBeSigned, signature);
  const jwk = publicKey.export({ format: "jwk" });

  return {
    ok,
    payloadText,
    toBeSignedHex: toBeSigned.toString("hex"),
    signatureHex: signature.toString("hex"),
    publicJwk: jwk,
  };
}

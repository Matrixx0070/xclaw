/**
 * COSE_Sign1 verification example (RFC 9052).
 *
 * Builds Sig_structure → ToBeSigned, then verifies with a supplied
 * crypto adapter (so this file stays dependency-light).
 *
 *   Sig_structure = ["Signature1", protected_bstr, external_aad, payload]
 *   ToBeSigned    = CBOR(Sig_structure)
 *   ok            = Verify(publicKey, alg, ToBeSigned, signature)
 */
import { decodeCbor } from "./cose-key.mjs";

const CONTEXT_SIGN1 = "Signature1";

const ALG_NAME = {
  [-7]: "ES256",
  [-35]: "ES384",
  [-36]: "ES512",
  [-8]: "EdDSA",
  [-257]: "RS256",
  [-37]: "PS256",
};

// --- minimal CBOR encode (deterministic subset for Sig_structure) ---

function encUint(n) {
  if (n < 0) throw new Error("uint must be >= 0");
  if (n < 24) return Buffer.from([n]);
  if (n < 256) return Buffer.from([0x18, n]);
  if (n < 65536) {
    const b = Buffer.alloc(3);
    b[0] = 0x19;
    b.writeUInt16BE(n, 1);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = 0x1a;
  b.writeUInt32BE(n, 1);
  return b;
}

function encType(major, n) {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  if (n < 65536) {
    const b = Buffer.alloc(3);
    b[0] = (major << 5) | 25;
    b.writeUInt16BE(n, 1);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = (major << 5) | 26;
  b.writeUInt32BE(n, 1);
  return b;
}

function encBstr(buf) {
  const u = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
  return Buffer.concat([encType(2, u.length), u]);
}

function encTstr(s) {
  const u = Buffer.from(String(s), "utf8");
  return Buffer.concat([encType(3, u.length), u]);
}

function encArray(items) {
  const parts = [encType(4, items.length)];
  for (const it of items) parts.push(it);
  return Buffer.concat(parts);
}

/**
 * Build ToBeSigned bytes for COSE_Sign1.
 * protectedBstr / aad / payload must be the exact bytes to bind.
 */
export function buildSign1ToBeSigned({
  protectedBstr,
  externalAad = Buffer.alloc(0),
  payload,
}) {
  if (!Buffer.isBuffer(protectedBstr)) {
    protectedBstr = Buffer.from(protectedBstr || []);
  }
  if (!Buffer.isBuffer(externalAad)) {
    externalAad = Buffer.from(externalAad || []);
  }
  if (!Buffer.isBuffer(payload)) {
    payload = Buffer.from(payload || []);
  }

  // Sig_structure = ["Signature1", protected, aad, payload]
  return encArray([
    encTstr(CONTEXT_SIGN1),
    encBstr(protectedBstr),
    encBstr(externalAad),
    encBstr(payload),
  ]);
}

/**
 * Parse a COSE_Sign1 CBOR object (tagged 18 or raw 4-array).
 * @returns {{ protectedBstr, unprotected, payload, signature, protectedHeaders }}
 */
export function parseCoseSign1(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const { value } = decodeCbor(buf);

  let arr = value;
  // decodeCbor currently unwraps tags by returning nested value only.
  // If we get a map, it's not Sign1.
  if (!Array.isArray(arr)) {
    throw new Error("COSE_Sign1 must be a CBOR array (tag 18 content)");
  }
  if (arr.length !== 4) {
    throw new Error(`COSE_Sign1 array length must be 4, got ${arr.length}`);
  }

  const [protectedBstr, unprotected, payloadField, signature] = arr;
  if (!Buffer.isBuffer(protectedBstr)) {
    throw new Error("protected must be bstr");
  }
  if (!Buffer.isBuffer(signature)) {
    throw new Error("signature must be bstr");
  }

  let payload;
  if (payloadField == null) {
    payload = null; // detached
  } else if (Buffer.isBuffer(payloadField)) {
    payload = payloadField;
  } else {
    throw new Error("payload must be bstr or null");
  }

  let protectedHeaders = {};
  if (protectedBstr.length > 0) {
    const inner = decodeCbor(protectedBstr).value;
    if (inner instanceof Map) {
      protectedHeaders = Object.fromEntries(inner.entries());
    } else if (inner && typeof inner === "object") {
      protectedHeaders = inner;
    } else {
      throw new Error("protected headers must be a CBOR map");
    }
  }

  return {
    protectedBstr,
    unprotected: unprotected instanceof Map
      ? Object.fromEntries(unprotected.entries())
      : unprotected || {},
    payload,
    signature,
    protectedHeaders,
    alg: protectedHeaders[1] ?? protectedHeaders["1"],
    algName: ALG_NAME[protectedHeaders[1]] || null,
  };
}

/**
 * Verify COSE_Sign1.
 *
 * @param {object} opts
 * @param {Buffer|Uint8Array} opts.message - COSE_Sign1 CBOR bytes
 * @param {Buffer|Uint8Array} [opts.externalAad]
 * @param {Buffer|Uint8Array} [opts.detachedPayload] - required if payload is null
 * @param {(ctx: {
 *   alg: number|string,
 *   algName: string|null,
 *   toBeSigned: Buffer,
 *   signature: Buffer,
 *   protectedHeaders: object,
 * }) => boolean|Promise<boolean>} opts.verifyCrypto
 *        Implementation must perform the real cryptographic verify.
 *
 * @example
 * await verifyCoseSign1({
 *   message,
 *   verifyCrypto: async ({ algName, toBeSigned, signature }) => {
 *     if (algName === "ES256") {
 *       return crypto.verify(
 *         "sha256",
 *         toBeSigned,
 *         { key: publicKeyObject, dsaEncoding: "ieee-p1363" },
 *         signature
 *       );
 *     }
 *     throw new Error("unsupported alg");
 *   },
 * });
 */
export async function verifyCoseSign1(opts) {
  const {
    message,
    externalAad = Buffer.alloc(0),
    detachedPayload,
    verifyCrypto,
  } = opts;

  if (typeof verifyCrypto !== "function") {
    throw new Error("verifyCrypto callback is required");
  }

  const parsed = parseCoseSign1(message);
  const { protectedBstr, payload, signature, protectedHeaders, alg, algName } =
    parsed;

  if (alg == null) {
    return { ok: false, error: "missing protected alg (label 1)" };
  }

  let payloadBstr;
  if (payload == null) {
    if (detachedPayload == null) {
      return {
        ok: false,
        error: "detached payload required (body payload is null)",
      };
    }
    payloadBstr = Buffer.from(detachedPayload);
  } else {
    payloadBstr = payload;
  }

  const toBeSigned = buildSign1ToBeSigned({
    protectedBstr,
    externalAad: Buffer.from(externalAad || []),
    payload: payloadBstr,
  });

  let cryptoOk;
  try {
    cryptoOk = await verifyCrypto({
      alg,
      algName,
      toBeSigned,
      signature,
      protectedHeaders,
      unprotected: parsed.unprotected,
    });
  } catch (e) {
    return { ok: false, error: e.message || String(e), toBeSigned };
  }

  if (!cryptoOk) {
    return {
      ok: false,
      error: "signature cryptographically invalid",
      alg,
      algName,
      toBeSigned,
    };
  }

  return {
    ok: true,
    alg,
    algName,
    toBeSigned,
    payload: payloadBstr,
    protectedHeaders,
  };
}

/**
 * Example: Node crypto ES256 verify helper (P-1363 signature).
 * publicKeyPemOrKeyObject = PEM string or KeyObject from COSE_Key import.
 */
export function createEs256Verifier(publicKeyPemOrKeyObject) {
  return async function verifyCrypto({ algName, toBeSigned, signature }) {
    if (algName && algName !== "ES256") {
      throw new Error(`createEs256Verifier only supports ES256, got ${algName}`);
    }
    const crypto = await import("node:crypto");
    return crypto.verify(
      "sha256",
      toBeSigned,
      {
        key: publicKeyPemOrKeyObject,
        dsaEncoding: "ieee-p1363",
      },
      signature
    );
  };
}

/** Demo-only: show Sig_structure bytes for empty protected/aad and sample payload */
export function exampleToBeSignedHex(payloadText = "hello") {
  const toBeSigned = buildSign1ToBeSigned({
    protectedBstr: Buffer.alloc(0),
    externalAad: Buffer.alloc(0),
    payload: Buffer.from(payloadText, "utf8"),
  });
  return {
    context: CONTEXT_SIGN1,
    payloadText,
    toBeSignedHex: toBeSigned.toString("hex"),
    toBeSignedLength: toBeSigned.length,
  };
}

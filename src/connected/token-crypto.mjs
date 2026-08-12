/**
 * Optional encryption-at-rest for connected-tokens.json (P5).
 * Key: XCLAW_TOKEN_STORE_KEY (32+ chars recommended) or derived from XCLAW_GATEWAY_TOKEN.
 * Format: { v:1, alg:"aes-256-gcm", iv, tag, data } base64 fields.
 */
import crypto from "node:crypto";

const PREFIX = "xclawenc1:";

export function resolveStoreKey(cfg = {}) {
  const raw =
    process.env.XCLAW_TOKEN_STORE_KEY ||
    cfg.connected?.encryptionKey ||
    process.env.XCLAW_GATEWAY_TOKEN ||
    "";
  if (!raw || String(raw).length < 8) return null;
  return crypto.createHash("sha256").update(String(raw)).digest(); // 32 bytes
}

export function encryptJson(obj, keyBuf) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBuf, iv);
  const plain = Buffer.from(JSON.stringify(obj), "utf8");
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: enc.toString("base64"),
  };
}

export function decryptJson(blob, keyBuf) {
  if (!blob || blob.v !== 1 || blob.alg !== "aes-256-gcm") {
    throw new Error("unsupported encrypted token blob");
  }
  const iv = Buffer.from(blob.iv, "base64");
  const tag = Buffer.from(blob.tag, "base64");
  const data = Buffer.from(blob.data, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyBuf, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(plain.toString("utf8"));
}

export function isEncryptedStore(obj) {
  return Boolean(obj && obj.v === 1 && obj.alg === "aes-256-gcm" && obj.data);
}

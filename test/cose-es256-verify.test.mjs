import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  verifyEs256Raw,
  verifyCoseSign1Es256,
  selfTestEs256,
  p256JwkFromXY,
  signatureToP1363,
  importEs256PublicKey,
} from "../src/auth/cose-es256-verify.mjs";
import { buildSign1ToBeSigned } from "../src/auth/cose-sign1-verify.mjs";

describe("full ES256 verification", () => {
  it("selfTest signs and verifies", () => {
    const r = selfTestEs256("hello-es256");
    assert.equal(r.ok, true);
    assert.ok(r.signatureHex.length === 128); // 64 bytes hex
  });

  it("verifyEs256Raw with JWK x,y", () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    const jwk = publicKey.export({ format: "jwk" });
    const toBeSigned = buildSign1ToBeSigned({
      protectedBstr: Buffer.alloc(0),
      payload: Buffer.from("payload"),
    });
    const sig = crypto.sign("sha256", toBeSigned, {
      key: privateKey,
      dsaEncoding: "ieee-p1363",
    });
    assert.equal(verifyEs256Raw({ x: jwk.x, y: jwk.y }, toBeSigned, sig), true);
    assert.equal(
      verifyEs256Raw({ x: jwk.x, y: jwk.y }, toBeSigned, Buffer.alloc(64)),
      false
    );
  });

  it("accepts DER signature via normalization", () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    const toBeSigned = buildSign1ToBeSigned({
      protectedBstr: Buffer.alloc(0),
      payload: Buffer.from("der-test"),
    });
    // Node default sign for EC may be DER depending on version/options
    const derSig = crypto.sign("sha256", toBeSigned, privateKey);
    const p1363 = signatureToP1363(derSig);
    assert.equal(p1363.length, 64);
    assert.equal(verifyEs256Raw(publicKey, toBeSigned, derSig), true);
  });

  it("importEs256PublicKey from PEM", () => {
    const { publicKey } = crypto.generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    const pem = publicKey.export({ type: "spki", format: "pem" });
    const key = importEs256PublicKey(pem);
    assert.equal(key.type, "public");
  });

  it("p256JwkFromXY pads short coordinates", () => {
    const jwk = p256JwkFromXY("aa", "bb");
    assert.equal(jwk.crv, "P-256");
    assert.ok(jwk.x.length > 0);
  });

  it("rejects empty key", () => {
    assert.throws(() => importEs256PublicKey(null), (e) => e.code === "EMPTY_KEY");
    assert.throws(() => importEs256PublicKey(""), (e) => e.code === "EMPTY_KEY");
  });

  it("rejects all-zero coordinates", () => {
    assert.throws(
      () => p256JwkFromXY("00".repeat(32), "11".repeat(32)),
      (e) => e.code === "INVALID_COORD"
    );
  });

  it("rejects wrong JWK kty", () => {
    assert.throws(
      () => importEs256PublicKey({ kty: "RSA", n: "x", e: "AQAB" }),
      (e) => e.code === "WRONG_KTY"
    );
  });

  it("rejects private PEM", () => {
    const { privateKey } = crypto.generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" });
    assert.throws(() => importEs256PublicKey(pem), (e) => e.code === "INVALID_KEY");
  });

  it("verifyCoseSign1Es256 returns code on bad key", () => {
    const r = verifyCoseSign1Es256({
      protectedBstr: Buffer.alloc(0),
      payload: Buffer.from("x"),
      signature: Buffer.alloc(64),
      publicKey: null,
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, "EMPTY_KEY");
  });
});

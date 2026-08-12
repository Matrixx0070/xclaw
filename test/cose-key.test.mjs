import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  encodeCoseKeyEs256,
  decodeCoseKey,
  decodeCbor,
} from "../src/auth/cose-key.mjs";

describe("COSE_Key CBOR decode", () => {
  it("round-trips EC2 P-256 ES256", () => {
    const x = Buffer.alloc(32, 0x11);
    const y = Buffer.alloc(32, 0x22);
    const raw = encodeCoseKeyEs256(x, y);
    const k = decodeCoseKey(raw);
    assert.equal(k.kty, "EC2");
    assert.equal(k.alg, "ES256");
    assert.equal(k.crv, "P-256");
    assert.equal(k.x, x.toString("hex"));
    assert.equal(k.y, y.toString("hex"));
    assert.ok(k.uncompressedHex.startsWith("04"));
    assert.equal(k.remaining, 0);
  });

  it("decodes from hex string", () => {
    const x = Buffer.alloc(32, 0xab);
    const y = Buffer.alloc(32, 0xcd);
    const hex = encodeCoseKeyEs256(x, y).toString("hex");
    const k = decodeCoseKey(hex);
    assert.equal(k.kty, "EC2");
    assert.equal(k.xLen, 32);
  });

  it("decodeCbor reads simple map", () => {
    // {1: true} = A1 01 F5
    const { value } = decodeCbor(Buffer.from([0xa1, 0x01, 0xf5]));
    assert.equal(value.get(1), true);
  });
});

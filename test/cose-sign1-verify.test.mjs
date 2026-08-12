import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildSign1ToBeSigned,
  exampleToBeSignedHex,
  parseCoseSign1,
} from "../src/auth/cose-sign1-verify.mjs";

describe("COSE_Sign1 ToBeSigned construction", () => {
  it("builds stable ToBeSigned for empty protected/aad", () => {
    const a = buildSign1ToBeSigned({
      protectedBstr: Buffer.alloc(0),
      externalAad: Buffer.alloc(0),
      payload: Buffer.from("hello"),
    });
    const b = buildSign1ToBeSigned({
      protectedBstr: Buffer.alloc(0),
      externalAad: Buffer.alloc(0),
      payload: Buffer.from("hello"),
    });
    assert.equal(a.toString("hex"), b.toString("hex"));
    // starts with array(4) = 0x84
    assert.equal(a[0], 0x84);
    // "Signature1" tstr header 0x6a (length 10)
    assert.equal(a[1], 0x6a);
  });

  it("example helper returns hex", () => {
    const ex = exampleToBeSignedHex("x");
    assert.ok(ex.toBeSignedHex.length > 0);
    assert.equal(ex.context, "Signature1");
  });

  it("different payload → different ToBeSigned", () => {
    const a = buildSign1ToBeSigned({
      protectedBstr: Buffer.alloc(0),
      payload: Buffer.from("a"),
    });
    const b = buildSign1ToBeSigned({
      protectedBstr: Buffer.alloc(0),
      payload: Buffer.from("b"),
    });
    assert.notEqual(a.toString("hex"), b.toString("hex"));
  });
});

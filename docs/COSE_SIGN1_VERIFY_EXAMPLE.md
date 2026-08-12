# COSE_Sign1 verification code example

## Flow

```text
parse Sign1
  → protected_bstr, payload, signature, alg
build Sig_structure = ["Signature1", protected, aad, payload]
ToBeSigned = CBOR(Sig_structure)
ok = cryptoVerify(publicKey, alg, ToBeSigned, signature)
```

## Code

```js
import {
  verifyCoseSign1,
  buildSign1ToBeSigned,
  createEs256Verifier,
  exampleToBeSignedHex,
} from "../src/auth/cose-sign1-verify.mjs";

// 1) Inspect ToBeSigned construction
console.log(exampleToBeSignedHex("hello"));

// 2) Verify a message (ES256 example)
const result = await verifyCoseSign1({
  message: coseSign1Bytes,
  externalAad: Buffer.alloc(0),
  // detachedPayload: Buffer.from("..."), // if body payload is null
  verifyCrypto: createEs256Verifier(publicKeyPem),
});

if (!result.ok) {
  console.error(result.error);
} else {
  console.log("valid", result.algName, result.payload.toString("utf8"));
}
```

## Custom crypto adapter

```js
await verifyCoseSign1({
  message,
  verifyCrypto: async ({ algName, toBeSigned, signature }) => {
    // return true/false — do real verify here
    if (algName === "EdDSA") {
      // ed25519.verify(signature, toBeSigned, publicKey)
    }
    if (algName === "ES256") {
      // ecdsa p256 sha256, ieee-p1363 signature
    }
    return false;
  },
});
```

## Critical rules in the example

| Rule | Implementation |
|------|----------------|
| Context | `"Signature1"` |
| Protected | Raw bstr from message (never re-encoded) |
| Empty AAD | `Buffer.alloc(0)` |
| Detached payload | `detachedPayload` option when body is null |
| Crypto | Injected via `verifyCrypto` |

File: `src/auth/cose-sign1-verify.mjs`

## Full ES256 implementation

```js
import {
  verifyCoseSign1Es256,
  verifyEs256Raw,
  selfTestEs256,
} from "../src/auth/cose-es256-verify.mjs";

console.log(selfTestEs256("hello")); // generate key, sign, verify

const result = verifyCoseSign1Es256({
  message: coseSign1Bytes,
  publicKey: { x: "...", y: "..." }, // or PEM / JWK / COSE_Key
  externalAad: Buffer.alloc(0),
});
```

| Item | Implementation |
|------|----------------|
| alg | `-7` ES256 |
| Curve | P-256 |
| Hash | SHA-256 |
| Signature | P1363 `r\|\|s` (64 bytes); DER auto-normalized |
| Key import | PEM, JWK, `{x,y}`, COSE_Key, KeyObject |

File: `src/auth/cose-es256-verify.mjs`

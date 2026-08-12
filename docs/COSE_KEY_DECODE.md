# Decode CBOR COSE_Key bytes

## API

```js
import { decodeCoseKey, decodeCoseKeyReport } from "../src/auth/cose-key.mjs";

// hex, base64, base64url, or Buffer
const key = decodeCoseKey("a5010203...");

// key.kty      → "EC2" | "OKP" | "RSA"
// key.alg      → "ES256" | ...
// key.crv      → "P-256" | "Ed25519" | ...
// key.x, key.y → hex coordinates
// key.uncompressedHex → 04||x||y for EC
```

## Example EC2 P-256 structure (decoded)

```json
{
  "kty": "EC2",
  "alg": "ES256",
  "crv": "P-256",
  "x": "<64 hex chars>",
  "y": "<64 hex chars>",
  "uncompressedHex": "04..."
}
```

## Labels

| Label | Field |
|-------|--------|
| 1 | kty |
| 3 | alg |
| -1 | crv (EC/OKP) or n (RSA) |
| -2 | x (EC/OKP) or e (RSA) |
| -3 | y (EC) |

## Extract from WebAuthn attestation

1. CBOR-decode `attestationObject` → `authData` bstr  
2. Parse authData binary header + credential id  
3. Remaining bytes → `decodeCoseKey(remaining)`

## Code

`src/auth/cose-key.mjs` — `decodeCbor`, `decodeCoseKey`, `encodeCoseKeyEs256`

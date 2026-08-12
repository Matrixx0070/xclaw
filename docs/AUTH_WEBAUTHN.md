# WebAuthn ↔ Fingerprint integration

Two different “fingerprints”:

| Concept | Meaning |
|---------|---------|
| **Cookie / binding fingerprint** | Hash of web session + salt (software) |
| **WebAuthn** | Platform authenticator (Touch ID, Windows Hello, security key) |

XClaw binds them: WebAuthn credentials record the **fingerprint generation** at registration; after FP rotate, a fresh **assertion** is required for sensitive gates.

## Architecture

```text
Web session cookies  →  encrypted store + cookie rotation
         ↓
Binding fingerprint  →  salt + generation (dual window)
         ↓
WebAuthn credential  →  bound to generation; user verification
         ↓
gateWithWebAuthn     →  FP verify + recent assertion
```

## CLI

```bash
xclaw auth webauthn status
xclaw auth webauthn register-options   # → browser create()
xclaw auth webauthn assert-options     # → browser get()
xclaw auth webauthn gate
xclaw auth webauthn snippet

xclaw auth fingerprint rotate          # marks WebAuthn re-assert required
```

## Browser (high level)

```js
// Register
const { publicKey } = await registerOptions;
const cred = await navigator.credentials.create({ publicKey });
// POST to completeRegistration

// Unlock (biometric / PIN)
const { publicKey } = await assertOptions;
const assertion = await navigator.credentials.get({ publicKey });
// POST to completeAssertion
```

## Security checks

| Check | Purpose |
|-------|---------|
| Challenge match | CSRF / replay |
| Counter monotonic | Cloned authenticator detection |
| Assertion freshness | Default 5 minutes for sensitive gate |
| Generation drift | Shown after FP rotate |

## Production note

Full COSE signature verification should use a library such as `@simplewebauthn/server`. This module stores credentials, challenges, counters, and generation binding; wire crypto verify at the gateway when exposing HTTP endpoints.

## Config

```json
{
  "auth": {
    "webauthn": {
      "rpId": "localhost",
      "rpName": "XClaw",
      "userVerification": "preferred",
      "requireAfterFpRotate": true,
      "maxAssertAgeMs": 300000
    }
  }
}
```

## Code

`src/auth/webauthn.mjs`

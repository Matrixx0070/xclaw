# Cookie rotation strategies

Limit damage if a web session is stolen. XClaw supports four strategies.

| Strategy | Behavior |
|----------|----------|
| **`ttl`** | Fixed max age; soft warn near expiry |
| **`sliding`** | Extend on use; hard stop at absolute max age |
| **`budget`** | Max age **and** max successful uses (default) |
| **`dual_slot`** | Archive previous session on rotate; brief overlap window |

## Config

```json
{
  "auth": {
    "web": {
      "rotationStrategy": "budget",
      "maxAgeMs": 2592000000,
      "absoluteMaxAgeMs": 7776000000,
      "softTtlMs": 172800000,
      "maxUses": 500,
      "previousRetainMs": 86400000
    }
  }
}
```

Or: `XCLAW_COOKIE_ROTATION=budget`

## CLI

```bash
xclaw auth rotation strategies
xclaw auth rotation              # evaluate current session
xclaw auth gate                  # check before model call + record use
xclaw auth rotate                # force rotate (then web-import again)
xclaw auth web-import --cookie "..."   # binds new fingerprint
```

## Flow

```text
web-import → bind fingerprint (generation N)
    ↓
each use → recordSessionUse / budget++
    ↓
evaluate → none | warn | reauth
    ↓
rotate → clear primary, generation N+1, re-import required
```

Fingerprint mismatch without rotate → force reauth (possible theft or manual file edit).

## Code

`src/auth/cookie-rotation.mjs`

# Fingerprint rotation

Two layers:

| Layer | What | Rotate when |
|-------|------|-------------|
| **Material fingerprint** | Hash of cookie / token | Cookie changes or `auth rotate` |
| **Binding fingerprint** | Hash(material + generation + **salt**) | Suspected state leak; scheduled re-key |

## Why

If `cookie-rotation.json` or logs leak only a fingerprint, rotating the **salt** invalidates the old binding without always forcing an immediate cookie re-import (dual window).

## CLI

```bash
xclaw auth fingerprint status
xclaw auth fingerprint bind
xclaw auth fingerprint verify
xclaw auth fingerprint rotate
xclaw auth fingerprint rotate --mode salt
xclaw auth fingerprint rotate --mode generation
xclaw auth fingerprint rotate --mode both
xclaw auth gate    # cookie rotation + fingerprint
```

## Modes

| `--mode` | Effect |
|----------|--------|
| `salt` | New random salt → new binding |
| `generation` | generation++ |
| `both` | Default: salt + generation |

Previous binding remains valid for `fingerprintPreviousRetainMs` (default 1h).

## State file

`~/.xclaw/fingerprint-rotation.json` (mode 0600) — salt, generation, binding, short history (no raw cookies).

## Code

`src/auth/fingerprint-rotation.mjs`

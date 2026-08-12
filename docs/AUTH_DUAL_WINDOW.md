# Dual-window fingerprint rotation — implementation details

## Problem

After `fingerprint rotate`, in-flight work may still carry the **old** binding (long request, second process, delayed gate). Instantly invalidating the previous binding causes false `binding_mismatch` failures.

## Design

```text
time ──────────────────────────────────────────────────────────►

  [binding_A, gen=G, salt=S1]  active
           │
           │  rotateFingerprint()
           ▼
  previous*  ← snapshot of A
  binding_B, gen=G' , salt=S2   ← new current
           │
           │  dual window (default 1 hour)
           │  verify accepts A OR B
           ▼
  previousValidUntil
           │
           ▼
  only binding_B accepted
```

## State fields (`fingerprint-rotation.json`)

| Field | Role |
|-------|------|
| `salt` / `binding` / `generation` | **Current** binding inputs |
| `previousSalt` | Salt used before last rotate |
| `previousBinding` | Full binding hash before last rotate |
| `previousGeneration` | Generation used with previous salt |
| `previousMaterial` | Material FP at rotate time (audit) |
| `previousValidUntil` | Epoch ms — dual window end |
| `history[]` | Last 20 rotates (redacted) |

## Verify algorithm

```text
1. material = hash(cookie)
2. current  = hash(material ‖ generation ‖ salt)
3. if current == binding → match: "current"
4. if now <= previousValidUntil:
     prev = hash(material ‖ previousGeneration ‖ previousSalt)
     if prev == previousBinding → match: "previous"
5. else fail (material_changed | binding_mismatch)
```

**Important:** `previousGeneration` is stored at rotate time — we do **not** infer it from history alone.

## Rotate algorithm

```text
1. retainMs = config || 1h
2. Snapshot previous* from current state
3. New salt and/or generation++
4. binding = hash(material ‖ generation ‖ salt)
5. previousValidUntil = now + retainMs
6. Persist state (0600)
```

## Config

```json
{
  "auth": {
    "web": {
      "fingerprintPreviousRetainMs": 3600000
    }
  }
}
```

| Value | Effect |
|-------|--------|
| `3600000` (1h) | Default dual window |
| `0` | No dual window (hard cutover) — set retain then call `closeDualWindow` |
| Large | Longer overlap (more tolerance, longer exposure of old binding) |

## Security tradeoff

| Longer window | Shorter window |
|---------------|----------------|
| Fewer false rejects | Stolen old binding dies faster |
| Easier multi-process cutover | Need synchronized rotate |

After a **confirmed** compromise of old state, call rotate **and** close dual window immediately (or use retainMs ≈ 0).

## CLI

```bash
xclaw auth fingerprint rotate
xclaw auth fingerprint status    # shows dualWindow.open / remainingMs
xclaw auth fingerprint verify    # match: current | previous
```

## Code

- `snapshotPreviousBinding` / `dualWindowOpen` / `dualWindowRemainingMs`
- `rotateFingerprint` / `verifyFingerprint` / `closeDualWindow`
- File: `src/auth/fingerprint-rotation.mjs`

# Key Compromise Recovery

## When to run

- Private key or `key-rotation.json` may have leaked  
- Host compromise / insider risk  
- Failed audit of key material  

## Playbook

```text
1. quarantine     — block new signing policy
2. revoke         — deny list old kid + generation
3. emergency_rotate — new P-256 key, dualWindowMs = 0
4. close_dual_window — no overlap with compromised key
5. lift quarantine — resume signing with new key
```

## API

```js
import {
  recoverFromCompromise,
  quarantineKeys,
  verifyWithRecovery,
  assertCanSign,
  recoveryStatus,
} from "../src/auth/key-compromise-recovery.mjs";

// One-shot recovery
const r = await recoverFromCompromise(cfg, { reason: "suspected_leak" });

// Verify path rejects revoked kids
await verifyWithRecovery(cfg, data, signature);

// Signing gate
await assertCanSign(cfg);
```

## State

`~/.xclaw/key-recovery.json` — quarantine flag, revoked kids/generations, event log (last 100).

## Code

`src/auth/key-compromise-recovery.mjs`

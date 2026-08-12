# Key Compromise Recovery Playbooks

Named runbooks with severity tiers. Prefer `runPlaybook()` over ad-hoc steps.

## Playbooks

| ID | Severity | What it does |
|----|----------|----------------|
| `soft_suspect` | low | Quarantine only; investigate; manual lift |
| `previous_leak` | medium | Revoke previous + close dual window; keep current |
| `current_leak` | high | Full emergency recovery; resume on new key |
| `full_host` | critical | Full recovery; **stay quarantined** until ops lifts |
| `drain_then_cut` | high | Close dual window, then full recovery |

## Usage

```js
import {
  listPlaybooks,
  recommendPlaybook,
  runPlaybook,
} from "../src/auth/key-compromise-playbooks.mjs";

listPlaybooks();

const name = recommendPlaybook({ currentKeyLeaked: true });
const report = await runPlaybook(cfg, name, {
  reason: "incident-123",
  // dryRun: true,
});
```

## CLI

```bash
xclaw keys playbooks
xclaw keys playbook soft_suspect
xclaw keys playbook current_leak --reason leak
xclaw keys playbook full_host --dry-run
```

## Recommendation map

| Signal | Playbook |
|--------|----------|
| Unsure / active key leak | `current_leak` |
| Only dual-window previous leak | `previous_leak` |
| Host disk / root compromise | `full_host` |
| Need previous dead before re-key | `drain_then_cut` |
| Suspicious but unconfirmed | `soft_suspect` |

## Code

`src/auth/key-compromise-playbooks.mjs`

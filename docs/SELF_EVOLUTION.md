# Self-evolution & hands-free operation

Goal: **owner can leave the computer** while XClaw keeps working under policy — still **inspectable and killable**.

## What “fully autonomous” means here

| Does | Does not |
|------|----------|
| Resume interrupted jobs from checkpoints | Rewrite its own core without review |
| Learn via skill **proposals** from fail/success | Silent prod skill install by default |
| Preference write-back to memory | Bypass cost/approval limits |
| Heartbeat ticks + evolution tick | Unbounded spend or scope creep |
| Alert only when blocked | Hide failures |

Autonomy is **earned through levels** and **fail-closed** on security, money, and grounding.

## Closed learning loop (already + evolve)

```text
job/harness run
  → durable memory (rememberJob)
  → skill proposal on fail/success (review-only)
  → preference hints
  → mid-run checkpoints
  → evolution tick (heartbeat or `xclaw evolve tick`)
        → auto-resume interrupted (lab/full)
        → auto-promote skills only if evolve.autoPromote + install gate
```

## Hands-free setup

```bash
# 1. See blockers
xclaw evolve status

# 2. Recommended overlay (merge into config carefully)
xclaw evolve overlay

# 3. Enable heartbeat (full level)
# autonomy.level=full
# autonomy.heartbeat.enabled=true
# autonomy.heartbeat.delivery = { channel, to }  # optional alerts

# 4. Dry-run evolution
xclaw evolve tick --dry-run

# 5. Live tick
xclaw evolve tick
```

### Prod

- Keep `profile=prod` → supervised  
- Skill install still needs `ownerApproved` / `skills.allowInstall` / env  
- Approvals inbox for risky tools  
- Cost governor hard stop  

### Lab / trusted machine

```json
{
  "autonomy": {
    "level": "full",
    "heartbeat": { "enabled": true, "everyMs": 1800000 },
    "evolve": {
      "autoResume": true,
      "autoPromote": false,
      "tickOnHeartbeat": true
    }
  },
  "skills": { "proposeOnFail": true, "proposeOnSuccess": true }
}
```

Set `"autoPromote": true` **and** `skills.allowInstall: true` only if you accept self-installing skill drafts.

## Owner still required when

1. Pending **approvals**  
2. **Budget** exceeded  
3. **Prod** skill install  
4. Heartbeat delivery misconfigured and you want push alerts  
5. Goals that need new credentials / human judgment  

## CLI

| Command | Purpose |
|---------|---------|
| `xclaw evolve status` | Blockers, interrupted jobs, proposals |
| `xclaw evolve tick` | Resume + optional promote |
| `xclaw evolve overlay` | Suggested hands-free config |
| `xclaw harness …` | Long grounded goal |
| `xclaw resume <id>` | Manual recovery |
| `xclaw approvals …` | Unblock risky tools |

## Code

- `src/autonomy/self-evolve.mjs` — status + tick + overlay  
- Heartbeat calls `runEvolutionTick` when `evolve.tickOnHeartbeat !== false`


## Assign work while away (`xclaw goal`)

Hands-free is not only resume — you **queue goals** before leaving:

```bash
xclaw goal "Refactor src/foo and run tests"
xclaw goal list
```

Gateway or `xclaw evolve tick` starts the queue worker. Heartbeat evolution tick keeps the worker alive.

Priority classes: interactive > batch > cron (see job queue).

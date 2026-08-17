# Self-evolution & hands-free operation

Goal: **owner can leave the computer** while XClaw keeps working under policy — still **inspectable and killable**.

Version notes: current cut **3.79.x** (resume locks, checkpoint prune, path-binding, `goal --harness`).

## What “fully autonomous” means here

| Does | Does not |
|------|----------|
| Resume interrupted jobs from checkpoints | Rewrite its own core without review |
| Learn via skill **proposals** from fail/success | Silent prod skill install by default |
| Preference write-back to memory | Bypass cost/approval limits |
| Heartbeat ticks + evolution tick | Unbounded spend or scope creep |
| Alert only when blocked | Hide failures |
| Prune old terminal checkpoints | Delete `running` / `resuming` CPs |

Autonomy is **earned through levels** and **fail-closed** on security, money, and grounding.

## Closed learning loop

```text
job/harness run
  → durable memory (rememberJob)
  → skill proposal on fail/success (review-only)
  → preference hints
  → mid-run checkpoints (every N turns)
  → evolution tick (heartbeat or `xclaw evolve tick`)
        → start queue worker (drain `xclaw goal`)
        → auto-resume running CPs (lab/full; locks + mark resumed)
        → prune terminal CPs (maxCount / maxAge)
        → auto-promote skills only if evolve.autoPromote + install gate
```

**Queue goals** and **checkpoints** are different stores:

| Store | Path | Role |
|-------|------|------|
| Job queue | `~/.xclaw/job-queue/` | Owner-assigned goals (`xclaw goal`) |
| Checkpoints | `~/.xclaw/checkpoints/` | Mid-run / final job recovery |
| Evolution log | `~/.xclaw/evolution/events.jsonl` | Tick audit |

## Hands-free setup

**Requirement:** a long-lived process (`xclaw gateway`) so the heartbeat timer stays armed.  
`xclaw evolve tick` is a **one-shot** sweeper without the gateway.

```bash
export XCLAW_PROFILE=lab
export XAI_API_KEY=...   # env only

# 1. Assign work before leaving (grounded)
xclaw goal "Write notes/ok.txt with OK" \
  --harness --exists notes/ok.txt --contains notes/ok.txt:OK

# 2. Posture
xclaw evolve status
xclaw doctor

# 3. Recommended overlay (merge carefully)
xclaw evolve overlay

# 4. Dry-run then live tick
xclaw evolve tick --dry-run
xclaw evolve tick

# 5. Keep alive
xclaw gateway
```

### Lab / trusted machine

```json
{
  "autonomy": {
    "level": "full",
    "heartbeat": { "enabled": true, "everyMs": 1800000 },
    "evolve": {
      "autoResume": true,
      "autoPromote": false,
      "tickOnHeartbeat": true,
      "maxAutoResume": 2,
      "queueWorker": true
    }
  },
  "checkpoints": {
    "maxCount": 100,
    "maxAgeMs": 1209600000,
    "pruneOnTick": true
  },
  "skills": { "proposeOnFail": true, "proposeOnSuccess": true },
  "harness": { "groundHard": true, "checkpointEveryTurns": 2 }
}
```

Set `"autoPromote": true` **and** `skills.allowInstall: true` only if you accept self-installing skill drafts.

### Prod

- Keep `profile=prod` → supervised (no auto-resume)
- Skill install: `ownerApproved` / `skills.allowInstall` / env
- Approvals inbox for risky tools
- Cost governor hard stop
- Queue jobs use `autoApprove: true` on the worker path — tighten allowlists

## Auto-resume rules

Resumes only when **all** hold:

1. `evolve.autoResume !== false`
2. Autonomy level **`lab` or `full`**
3. No **budget** or **approval** blockers
4. Checkpoint `status === "running"` (not final `failed`)
5. Cap: `maxAutoResume` (default 2) per tick

After resume, parent CP is marked **`resumed`** (`resumedBy`) so the next tick does not pick it again. In-process lock reduces double-resume.

Manual: `xclaw resume <id> [--strategy …] [--harness] [--force]`

## Checkpoint maintenance

```bash
xclaw resume list
xclaw resume prune
xclaw resume prune --dry-run
```

Defaults: keep **100** newest terminal CPs; drop older than **14 days**; never delete `running` / `resuming`.

## Owner still required when

1. Pending **approvals**
2. **Budget** exceeded
3. **Prod** skill install
4. Heartbeat delivery misconfigured (want push alerts)
5. Goals that need new credentials / human judgment
6. Final **failed** jobs (not auto-resumed — use `xclaw resume <id>`)

## CLI

| Command | Purpose |
|---------|---------|
| `xclaw goal "…" [--harness] [--exists] [--contains] [--cmd]` | Enqueue owner goals |
| `xclaw goal list` | Queue inventory |
| `xclaw evolve status` | Blockers, interrupted CPs, queue, proposals |
| `xclaw evolve tick [--dry-run] [--promote]` | Resume + prune + optional promote |
| `xclaw evolve overlay` | Suggested hands-free config |
| `xclaw harness …` | Interactive long grounded goal |
| `xclaw resume list \| <id> \| prune` | List / recover / evict CPs |
| `xclaw approvals …` | Unblock risky tools |
| `xclaw doctor` | `evolve.handsFree`, `checkpoints.store`, `harness.principles` |

## Grounding (harness / hard claims)

- Structured claims + tool evidence
- **Path-binding:** paths named in claims should appear in tool evidence (basename match allowed)
- See [PRINCIPLES.md](./PRINCIPLES.md) and [HARNESS.md](./HARNESS.md)

## Failure modes

| Symptom | Likely cause |
|---------|----------------|
| No periodic ticks | Gateway not running; or `heartbeat.enabled` false |
| Tick skips evolve | Quiet hours or daily spend cap |
| No auto-resume | supervised/off; approval/budget blocker; CP already `resumed` |
| Stale handler after upgrade | Fixed in 3.79 — `ensureHeartbeat` rebinds handler; restart gateway once |
| Disk growth in checkpoints | Run `xclaw resume prune` or rely on tick prune |

## Code

- `src/autonomy/self-evolve.mjs` — status + tick + overlay
- `src/jobs/checkpoint.mjs` — save / resume / prune / locks
- `src/jobs/queue.mjs` — goal drain; optional `runLongHarness`
- `src/cron/heartbeat.mjs` — schedule + evolve phase
- `test/self-evolve.test.mjs` — offline fixtures for resume gates

# Phase C — Scale of work

## Approvals

```bash
curl -s http://127.0.0.1:18790/security/policy | jq
curl -s http://127.0.0.1:18790/security/pending | jq
# Control UI → Approvals → Allow / Deny
```

Config:
```json
"security": {
  "autoApprove": false,
  "approvalPolicy": "risky",
  "requireApproval": ["xclaw_bash", "bash"],
  "safeAuto": ["xclaw_file_read", "file_read"]
}
```

Profiles: **lab** = autoApprove; **prod** = risky + requireApproval.

## Durable memory

```bash
curl -s 'http://127.0.0.1:18790/memory?workspace=/path' | jq
```

Stored under `~/.xclaw/memory/<hash>/MEMORY.md` and loaded into the agent context.

## Subagents

Tool `xclaw_spawn_subagent` with `{ "task": "...", "isolate": true, "maxTurns": 6 }`.

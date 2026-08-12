# Phase I — Operator speed

## Checkpoints
Control UI → Checkpoints · or:
```bash
curl -s http://127.0.0.1:18790/checkpoints | jq
curl -s -X POST http://127.0.0.1:18790/checkpoints/resume -d '{"id":"job_..."}'
```

## Approval SLA
```json
"security": { "approvalSlaMs": 300000, "approvalSlaAction": "deny" }
```

## Merge
```bash
xclaw merge <subagentId> --check
xclaw merge <subagentId> --repo /path/to/repo
```

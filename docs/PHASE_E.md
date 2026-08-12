# Phase E — Prove longer autonomy

```bash
xclaw eval --tag long
xclaw scoreboard
curl -s http://127.0.0.1:18790/eval/scoreboard | jq
```

Release gate: `releaseGate.ok` requires passRate ≥ 0.9 on baseline.

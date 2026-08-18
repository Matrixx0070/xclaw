# POST /stop (single-port kill-switch)

Same path on HTTP and TLS. Auth:

1. `Authorization: Bearer <token>` or `X-XClaw-Token`
2. Optional `X-XClaw-Stop-Sig` = hex HMAC-SHA256 of the **canonical** body
   (`stableStringify` — key order / whitespace do not matter)

WS control: `{ "type": "stop", "token": "...", "sig": "..." }` uses the same rules.
WS lastDrain is stamped with `channel=ws` + `authMethod`.

`GET /health` includes `stop: { auth, hmac, ready, singlePort }`.
In prod, `GET /ready` is 503 when `stop.ready` is false.

## Operator runbook

Mint a signature:

```bash
xclaw stop --sign
xclaw stop --sign --print-curl
```

Safe live probe (no sessions aborted):

```bash
xclaw stop --sign --dry-run
# or POST { "type": "stop", "dryRun": true }
```

CI / doctor fire-drill:

```bash
node scripts/stop-fire-drill.mjs
xclaw doctor --json   # ops.stop_fire_drill
```

See `docs/openapi-stop.yaml`.

# POST /stop (single-port kill-switch)

Same path on HTTP and TLS. Auth:

1. `Authorization: Bearer <token>` or `X-XClaw-Token`
2. Optional `X-XClaw-Stop-Sig` = hex HMAC-SHA256 of the raw body

WS control: `{ "type": "stop", "token": "...", "sig": "..." }` uses the same rules.

`GET /health` includes `stop: { auth, hmac, ready, singlePort }`.
In prod, `GET /ready` is 503 when `stop.ready` is false.

See `docs/openapi-stop.yaml`.

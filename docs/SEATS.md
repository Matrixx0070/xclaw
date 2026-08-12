# Seats (Phase 3)

Logical **API budget seats** — not Grok Business/SuperGrok subscription seats.

## Enable

```json
{
  "seats": {
    "enabled": true,
    "defaultDailyUsd": 2,
    "defaultDailyTokens": 500000,
    "softPct": 0.8,
    "hardPct": 1.0,
    "byPeer": {
      "telegram:111": { "dailyUsd": 5, "label": "alice" },
      "webchat:default": { "dailyUsd": 1, "label": "lab" }
    }
  }
}
```

## Behavior

| Level | Effect |
|-------|--------|
| Soft (80%) | Job proceeds; warning in status |
| Hard (100%) | Job fails with `seatBlocked` |
| Paused | Deny until unpaused |

Ledger: `~/.xclaw/seats-ledger.json` (resets daily)

## CLI / channels

```bash
xclaw seats status
xclaw seats check telegram:111
xclaw seats reset
xclaw seats pause telegram:111
```

Channel: `/seat`

## vs Grok subscription

| Product | Funds XClaw API? |
|---------|------------------|
| SuperGrok / Grok Business seats | **No** |
| xAI Console API prepaid credits | **Yes** |
| XClaw seats | Software quota on top of API spend |

# First real live soak report format

## Goal

One JSON report after `--confirm-live` G10–G14.

## Fields

```json
{
  "mode": "live",
  "ids": ["G10", "G11", "G12", "G13", "G14"],
  "ok": true,
  "usedUsd": 0.12,
  "turns": 18,
  "soakJobId": "night-1",
  "canary": { "fail": 0 },
  "scorecard": { "ok": true }
}
```

## Local today

- G15–G20 baked via apply-horizon-pack in CI
- Live turn guards + checkpoint + `xclaw_horizon_live_turn_total`

# R4 — Proactive autonomy (heartbeat)

## Enable

```json
"autonomy": {
  "heartbeat": {
    "enabled": true,
    "everyMs": 1800000,
    "prompt": "Heartbeat: briefly check for urgent owner tasks. If nothing needs action, reply with exactly: HEARTBEAT_OK",
    "silenceOk": true,
    "delivery": { "channel": "telegram", "to": "YOUR_CHAT_ID" }
  },
  "quietHours": {
    "enabled": true,
    "startHour": 23,
    "endHour": 7,
    "tzOffsetMinutes": 300
  },
  "maxUsdPerDay": 2.0
}
```

- **silenceOk**: if model replies `HEARTBEAT_OK`, no channel message is sent.
- **quietHours**: skip runs in the window.
- **maxUsdPerDay**: soft stop when estimated spend hits the cap.

## Doctor

```bash
node bin/xclaw.mjs doctor
# autonomy.heartbeat
```

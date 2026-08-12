# R1 — Always-on reliability

## Channel health watchdog

Started with the gateway. Every ~45s:

1. Reads `channelManager.status()`
2. If an **enabled** channel is dead / not running → `restartChannel(name)`
3. Backoff + circuit breaker after consecutive fails

## Doctor

```bash
node bin/xclaw.mjs doctor
# channels.health
# computer.watchdog
```

## Soak

```bash
node bin/xclaw.mjs gateway
node scripts/soak-r1.mjs --hours 48 --interval 60
```

## Config

```json
"channels": {
  "healthWatchdog": {
    "enabled": true,
    "intervalMs": 45000,
    "minRestartIntervalMs": 60000,
    "maxConsecutiveFails": 8
  }
}
```

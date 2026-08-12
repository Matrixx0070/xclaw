## Security
See [SECURITY.md](./SECURITY.md) and `xclaw security-audit`.

# XClaw Operator Runbook 2.0

## Golden path
```bash
export XAI_API_KEY=...
npm run dev-up
xclaw info
xclaw doctor
xclaw wait-ready
```

## Incidents

### Computer down
```bash
xclaw computer status
xclaw computer restart
# /ready should return 200
```

### Cost hard cap / queue paused
```bash
xclaw cost
xclaw cost resume    # after raising limits or new day
```

### SLO breach
```bash
xclaw slo
xclaw slo-check      # alert if configured
# Config: slo.monitorIntervalMs, alerting.targets / PagerDuty
```

### Approvals stuck
```bash
xclaw digest
# or Control UI / Telegram / Discord /approve <id>
```

### Flaky eval case
```bash
xclaw quarantine
# auto-excludes from scoreboard releaseGate until 3 consecutive greens
```

## Release
```bash
SOAK_TAGS=smoke npm run soak:nights
REQUIRE_SOAK=1 npm run evidence
npm test
npm run eval:ci
```

## Profiles
- `XCLAW_PROFILE=lab` — auto-approve
- `XCLAW_PROFILE=prod` — approvals + structured claims on long/campaign

## Security
- `XCLAW_GATEWAY_TOKEN` — protect agent/jobs routes
- `XCLAW_COMPUTER_TOKEN` — remote computer auth
- `sandbox.enabled` — path escape deny


## Phase Q drills
```bash
npm run sandbox-redteam
xclaw fire-drill
npm run soak:7
```


## Config override / bot hang

See **INSTALL.md → Troubleshooting: config overrides**.

User `security.autoApprove: false` overrides lab profile and blocks tools until `/approve`.

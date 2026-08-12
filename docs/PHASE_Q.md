# Phase Q — Production proof

## 7-day soak
```bash
export XAI_API_KEY=...
SOAK_TAGS=smoke npm run soak:7
# or SEED_ONLY=1 SOAK_NIGHTS=7 SOAK_MIN_NIGHTS=7 npm run soak:nights
```

## Fire-drill
```bash
xclaw fire-drill
xclaw fire-drill computer_down
xclaw fire-drill cost_hard
xclaw fire-drill recover
```

## Auth proxy (sidecar)
```bash
export XCLAW_COMPUTER_TOKEN=secret
# computer on 4243
xclaw computer-proxy
# clients: XCLAW_COMPUTER_URL=http://127.0.0.1:4244
```

## Sandbox red team
```bash
npm run sandbox-redteam
xclaw sandbox-redteam
```

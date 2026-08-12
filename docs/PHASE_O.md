# Phase O — Adversarial hardening

## Computer auth
```bash
export XCLAW_COMPUTER_TOKEN=secret
# config: computer.authToken, computer.authHmac
```

## Queue load
```bash
npm run queue:load
Q_INTERACTIVE=20 Q_BATCH=50 npm run queue:load
```

## Sandbox red team
```bash
xclaw eval --tag redteam
xclaw eval --id sandbox-escape-denied
```

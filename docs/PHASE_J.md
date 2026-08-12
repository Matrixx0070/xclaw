# Phase J — Guardrails & soak

## Cost governor
```bash
xclaw cost
xclaw cost pause
xclaw cost resume
curl -s http://127.0.0.1:18790/cost | jq
```

Config:
```json
"cost": {
  "dailySoftUsd": 5,
  "dailyHardUsd": 15,
  "perJobUsd": 1,
  "pauseQueueOnHard": true
}
```

## Channel auth
```json
"channels": {
  "telegram": {
    "allowedCommands": ["/job", "/status", "/help", "/pending", "/approve"],
    "workspaceByChatId": { "12345": "/data/ws-a" }
  }
}
```

## Computer contracts
```bash
npm test -- test/computer-contract.test.mjs
```

## 72h soak checklist
1. `npm run dev-up` + watchdog enabled  
2. Cron eval daily; scoreboard `releaseGate.ok`  
3. Inject computer kill → watchdog restart within SLA  
4. Hit soft/hard cost caps in lab  
5. Flake budget: ≤1 flaky failure / 50 eval runs  
6. Tag release only if gate green 3 consecutive nights  

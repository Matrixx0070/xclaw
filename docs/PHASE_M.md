# Phase M — Hardened multi-tenant ops

## Queue priorities
```js
enqueueJob(cfg, { goal: "...", class: "interactive" }) // 100
// batch=50, cron=20; +1 priority per 5 min waiting (cap +40)
```

## Digests
```bash
xclaw digest
xclaw digest --send
```

## Sandbox
```json
"sandbox": { "enabled": true, "readOnly": false, "allowPaths": [] }
```

## SLOs
```bash
xclaw slo
curl -s http://127.0.0.1:18790/slo | jq
```

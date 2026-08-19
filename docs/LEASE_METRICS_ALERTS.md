# Production scrape + alert on lease_backend_error_total

## Scrape

```
GET /metrics
```

## Alerts

```yaml
- alert: XClawLeaseBackendErrors
  expr: increase(xclaw_lease_backend_error_total[5m]) > 0
  for: 2m
  labels:
    severity: page
  annotations:
    summary: Lease backend errors on XClaw gateway
```

## Offline verify

```bash
node --test test/lease-metrics.test.mjs test/lease-metrics-chaos.test.mjs
```

# XClaw stream · custom PromQL queries

Datasource: Prometheus scraping `GET /metrics` on the XClaw gateway  
Labels of interest: `kind` (`agent`|`swarm`|`webchat`), `code`, `phase` (`client`|`server`), `event`, `status`

---

## 1. Error volume

### Total error rate (all streams)
```promql
sum(rate(xclaw_stream_errors_total[5m]))
```

### Error rate by kind and code
```promql
sum by (kind, code) (rate(xclaw_stream_errors_total[5m]))
```

### Error rate by phase (client vs server)
```promql
sum by (phase) (rate(xclaw_stream_errors_total[5m]))
```

### Errors in the last 15 minutes (counter increase)
```promql
sum by (kind, code) (increase(xclaw_stream_errors_total[15m]))
```

### Top error codes (instant ranking)
```promql
topk(5, sum by (code) (increase(xclaw_stream_errors_total[1h])))
```

---

## 2. Fatal vs retryable

### Fatal error rate by kind
```promql
sum by (kind) (rate(xclaw_stream_errors_fatal_total[5m]))
```

### Retryable error rate by kind
```promql
sum by (kind) (rate(xclaw_stream_errors_retryable_total[5m]))
```

### Fatal share of all errors (0–1)
```promql
sum(rate(xclaw_stream_errors_fatal_total[5m]))
/
clamp_min(sum(rate(xclaw_stream_errors_total[5m])), 1e-9)
```

### Fatal errors last 1h
```promql
sum(increase(xclaw_stream_errors_fatal_total[1h]))
```

---

## 3. Resume lifecycle

### Resume event rate by type
```promql
sum by (kind, event) (rate(xclaw_stream_resume_events_total[5m]))
```

### Resume failures only
```promql
sum by (kind) (
  rate(xclaw_stream_resume_events_total{event="resume_failed"}[5m])
)
```

### Resume backoff (reconnect pressure)
```promql
sum by (kind) (
  rate(xclaw_stream_resume_events_total{event="resume_backoff"}[5m])
)
```

### Successful stream ends
```promql
sum by (kind) (
  rate(xclaw_stream_resume_events_total{event="resume_ended"}[5m])
)
```

### Failure ratio among resume outcomes
```promql
sum(rate(xclaw_stream_resume_events_total{event="resume_failed"}[15m]))
/
clamp_min(
  sum(rate(xclaw_stream_resume_events_total{event=~"resume_failed|resume_ended"}[15m])),
  1e-9
)
```

### Backoff-to-end ratio (rough reconnect churn)
```promql
sum(rate(xclaw_stream_resume_events_total{event="resume_backoff"}[15m]))
/
clamp_min(
  sum(rate(xclaw_stream_resume_events_total{event="resume_ended"}[15m])),
  1e-9
)
```

---

## 4. Specific codes

### STREAM_NOT_FOUND spike (expired / unknown streamId)
```promql
sum by (kind, phase) (
  rate(xclaw_stream_errors_total{code="STREAM_NOT_FOUND"}[5m])
)
```

### STREAM_NOT_FOUND count over 15m
```promql
sum(increase(xclaw_stream_errors_total{code="STREAM_NOT_FOUND"}[15m]))
```

### Auth / forbidden (non-retryable client config issues)
```promql
sum by (code) (
  rate(xclaw_stream_errors_total{code=~"AUTH|FORBIDDEN"}[5m])
)
```

### Network + heartbeat (retryable transport)
```promql
sum by (code, kind) (
  rate(xclaw_stream_errors_total{code=~"NETWORK|HEARTBEAT_TIMEOUT|SERVER"}[5m])
)
```

### Max resume cycles exhausted
```promql
sum by (kind) (
  increase(xclaw_stream_errors_total{code="MAX_RESUME_CYCLES"}[1h])
)
```

---

## 5. In-memory stream registry

### Logs by status
```promql
xclaw_stream_logs
```

### Live streams only
```promql
xclaw_stream_logs{status="live"}
```

### Finished but still in TTL window
```promql
xclaw_stream_logs{status="ended"} + xclaw_stream_logs{status="aborted"}
```

### Buffer depth (events held for resume)
```promql
xclaw_stream_log_events_buffered
```

### Average events per live stream
```promql
xclaw_stream_log_events_buffered
/
clamp_min(xclaw_stream_logs{status="live"}, 1)
```

### Live subscribers (attached resume clients)
```promql
xclaw_stream_log_subscribers
```

### Buffer pressure (alert when large)
```promql
xclaw_stream_log_events_buffered > 1000
```

---

## 6. Kind filters (agent / swarm / webchat)

### Agent-only error rate
```promql
sum by (code) (rate(xclaw_stream_errors_total{kind="agent"}[5m]))
```

### Swarm-only resume failures
```promql
rate(xclaw_stream_resume_events_total{kind="swarm", event="resume_failed"}[5m])
```

### WebChat not-found
```promql
increase(xclaw_stream_errors_total{kind="webchat", code="STREAM_NOT_FOUND"}[15m])
```

### Multi-kind comparison (errors/min)
```promql
sum by (kind) (rate(xclaw_stream_errors_total[5m])) * 60
```

---

## 7. SLO-style / burn queries

### Error budget burn (example: 99% success → 1% errors)
Assuming each `resume_ended` ≈ success and errors are failures:

```promql
sum(rate(xclaw_stream_errors_total[1h]))
/
clamp_min(
  sum(rate(xclaw_stream_resume_events_total{event="resume_ended"}[1h]))
  + sum(rate(xclaw_stream_errors_total[1h])),
  1e-9
)
```

### Fast burn (5m) vs slow burn (1h)
```promql
sum(rate(xclaw_stream_errors_fatal_total[5m]))
/
clamp_min(sum(rate(xclaw_stream_errors_fatal_total[1h])), 1e-9)
```

---

## 8. Alert-ready expressions

### Resume failure storm
```promql
sum(increase(xclaw_stream_resume_events_total{event="resume_failed"}[15m])) > 5
```

### STREAM_NOT_FOUND spike
```promql
sum(increase(xclaw_stream_errors_total{code="STREAM_NOT_FOUND"}[15m])) > 10
```

### Fatal stream errors
```promql
sum(increase(xclaw_stream_errors_fatal_total[15m])) > 3
```

### Sustained retryable transport errors
```promql
sum(rate(xclaw_stream_errors_retryable_total[5m])) > 0.1
```

### No successful ends while traffic exists (possible outage)
```promql
sum(rate(xclaw_stream_resume_events_total{event="resume_ended"}[10m])) == 0
and
sum(rate(xclaw_stream_errors_total[10m])) > 0
```

### Live stream backlog (many live, deep buffer)
```promql
xclaw_stream_logs{status="live"} > 20
and
xclaw_stream_log_events_buffered > 2000
```

---

## 9. Grafana Explore snippets

**Time series (errors by code):**
```promql
sum by (code) (rate(xclaw_stream_errors_total[5m]))
```

**Stat panel (not-found 5m):**
```promql
sum(increase(xclaw_stream_errors_total{code="STREAM_NOT_FOUND"}[5m]))
```

**Table (topk codes 1h):**
```promql
topk(10, sum by (kind, code) (increase(xclaw_stream_errors_total[1h])))
```

**Heatmap-friendly (bucket by kind only):**
```promql
sum by (kind) (rate(xclaw_stream_errors_total[1m]))
```

---

## 10. Recording rules (optional Prometheus)

```yaml
groups:
  - name: xclaw-stream-recording
    interval: 30s
    rules:
      - record: xclaw:stream_errors:rate5m
        expr: sum by (kind, code, phase) (rate(xclaw_stream_errors_total[5m]))

      - record: xclaw:stream_fatal:rate5m
        expr: sum by (kind) (rate(xclaw_stream_errors_fatal_total[5m]))

      - record: xclaw:stream_resume_failed:rate5m
        expr: sum by (kind) (rate(xclaw_stream_resume_events_total{event="resume_failed"}[5m]))

      - record: xclaw:stream_not_found:increase15m
        expr: sum by (kind) (increase(xclaw_stream_errors_total{code="STREAM_NOT_FOUND"}[15m]))
```

Use recording rules if dashboards scrape large ranges often.

---

## Quick reference · metric names

| Metric | Type |
|--------|------|
| `xclaw_stream_errors_total` | counter (`kind`,`code`,`phase`) |
| `xclaw_stream_errors_fatal_total` | counter (`kind`) |
| `xclaw_stream_errors_retryable_total` | counter (`kind`) |
| `xclaw_stream_resume_events_total` | counter (`kind`,`event`) |
| `xclaw_stream_logs` | gauge (`status`) |
| `xclaw_stream_log_events_buffered` | gauge |
| `xclaw_stream_log_subscribers` | gauge |

`event` values: `resume_backoff`, `resume_failed`, `resume_ended`  
`code` values: `STREAM_NOT_FOUND`, `NETWORK`, `HEARTBEAT_TIMEOUT`, `SERVER`, `AUTH`, `FORBIDDEN`, `MAX_RESUME_CYCLES`, …

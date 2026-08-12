# XClaw Grafana dashboards

## Import

1. Grafana → **Dashboards** → **Import**
2. Upload one of:
   - `xclaw-dashboard.json` — gateway, Slack WS, eval, **and stream/resume**
   - `xclaw-stream-dashboard.json` — stream/resume focused
3. Select your **Prometheus** datasource

## Prometheus scrape

```yaml
scrape_configs:
  - job_name: xclaw
    metrics_path: /metrics
    scrape_interval: 15s
    static_configs:
      - targets: ["127.0.0.1:18790"]
    # If gateway token protects /metrics:
    # authorization:
    #   credentials: <XCLAW_GATEWAY_TOKEN>
```

Verify:

```bash
curl -fsS http://127.0.0.1:18790/metrics | grep xclaw_stream
```

## Stream panels (both dashboards)

| Panel | PromQL (examples) |
|-------|-------------------|
| Errors rate | `sum by (kind, code) (rate(xclaw_stream_errors_total[5m]))` |
| Fatal vs retryable | `rate(xclaw_stream_errors_fatal_total[5m])` |
| Resume lifecycle | `sum by (kind, event) (rate(xclaw_stream_resume_events_total[5m]))` |
| Live logs | `xclaw_stream_logs{status="live"}` |
| Buffer depth | `xclaw_stream_log_events_buffered` |
| Not-found | `increase(xclaw_stream_errors_total{code="STREAM_NOT_FOUND"}[5m])` |

### UIDs

| File | UID |
|------|-----|
| `xclaw-dashboard.json` | `xclaw-gateway-slack` |
| `xclaw-stream-dashboard.json` | `xclaw-stream-resume` |

## Alert rules

- **YAML provisioning:** `xclaw-alerts.yaml`
- **JSON:** `xclaw-alert-rules.json`

Suggested stream rules (add to Prometheus / Grafana):

| Alert | Expr |
|-------|------|
| Resume failure storm | `sum(increase(xclaw_stream_resume_events_total{event="resume_failed"}[15m])) > 5` |
| Stream not found spike | `sum(increase(xclaw_stream_errors_total{code="STREAM_NOT_FOUND"}[15m])) > 10` |
| Fatal stream errors | `sum(increase(xclaw_stream_errors_fatal_total[15m])) > 3` |
| Computer down | `xclaw_computer_up == 0` for 2m |

Adjust `datasourceUid` to match your Prometheus datasource UID.

## Custom PromQL

Full query library:

- **Markdown:** [`xclaw-stream-promql.md`](./xclaw-stream-promql.md) — copy/paste for Explore & alerts
- **JSON:** [`xclaw-stream-promql.json`](./xclaw-stream-promql.json) — structured list for tooling

Examples:

```promql
sum by (kind, code) (rate(xclaw_stream_errors_total[5m]))
sum(increase(xclaw_stream_resume_events_total{event="resume_failed"}[15m]))
xclaw_stream_logs{status="live"}
```

## Recording rules (optimized)

| File | Role |
|------|------|
| `xclaw-stream-recording-rules.yaml` | Pre-aggregated rates, increases, ratios, registry |
| `xclaw-stream-alerts-optimized.yaml` | Alerts on recorded series (cheap eval) |

```yaml
# prometheus.yml
rule_files:
  - /etc/prometheus/xclaw-stream-recording-rules.yaml
  - /etc/prometheus/xclaw-stream-alerts-optimized.yaml
```

```bash
promtool check rules deploy/grafana/xclaw-stream-recording-rules.yaml
```

Prefer `xclaw:stream_errors:rate5m` over raw `rate(xclaw_stream_errors_total[5m])` in dashboards.



## Investigation notes (3.37)

| Dashboard | UID | Role |
|-----------|-----|------|
| `xclaw-dashboard.json` | `xclaw-gateway-slack` | Gateway + Slack + stream row |
| `xclaw-stream-dashboard.json` | `xclaw-stream-resume` | Stream-focused; `$kind` filter |

### Findings addressed

- Stream dashboard queries filter by `$kind` where applicable
- Prefer recording-rule series (`xclaw:stream_errors:rate5m`, …) with raw fallback via `or`
- Added panels: failure ratio, metric series cardinality, backoff-per-end
- Link from stream dash → gateway overview

### Import checklist

1. Prometheus scraping `http://127.0.0.1:18790/metrics`
2. Optional: load `xclaw-stream-recording-rules.yaml` (cheaper queries)
3. Grafana → Import both JSON files → select Prometheus datasource
4. Open **XClaw · Stream & Resume** → set **Stream kind** variable

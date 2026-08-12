# XClaw 3.3.3 ship notes

**Artifact:** `/home/workdir/artifacts/XCLAW_RELEASE_v3.3.3.zip`

## Included in this ship

| Item | Detail |
|------|--------|
| Grafana dashboard | `deploy/grafana/xclaw-dashboard.json` |
| Grafana alerts | `xclaw-alerts.yaml`, `xclaw-alert-rules.json` |
| Slack `app_mention` | Socket Mode event handling + mention strip |
| Vault userId | ALS request context → vault for Slack/Telegram/Discord |

## Checks

- request-context + vault tests PASS
- eval-regression units OK

## Smoke

```bash
unzip XCLAW_RELEASE_v3.3.3.zip && cd xclaw
export XAI_API_KEY=... XCLAW_GATEWAY_TOKEN=...
node bin/xclaw.mjs gateway
curl -fsS http://127.0.0.1:18790/metrics | head
# Import deploy/grafana/*.json into Grafana
```

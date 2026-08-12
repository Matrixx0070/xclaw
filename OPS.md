# XClaw operations

## Start

```bash
node bin/xclaw.mjs gateway
# or background
node bin/xclaw.mjs daemon start
node bin/xclaw.mjs daemon status
```

## Health

```bash
curl -s localhost:$PORT/health
curl -s localhost:$PORT/doctor
node bin/xclaw.mjs doctor
node bin/xclaw.mjs self-test
```



## Production enforcement preset (B2)

For locked-down browser/computer sessions, use the copy-paste env block in
**[docs/PROD_PRESET.md](docs/PROD_PRESET.md)**.

### Minimum (no MITM)

```bash
export XCLAW_ROOT=/path/to/xclaw
export XCLAW_PROFILE=prod
export XCLAW_COMMIT_GATES=1
export XCLAW_FABRIC_ENFORCE=1
export XCLAW_JSCODE_MODE=read
export XCLAW_BROWSER_PROFILE_DIR=~/.xclaw/browser-profiles/prod
export XCLAW_FABRIC_DIR=~/.xclaw/fabric
export XCLAW_AGENT_ID=worker-1
# Prefer session_role bind — do not set XCLAW_ROLE_FROM_ENV in prod
```

### Verify

```bash
node scripts/a-enforcement-e2e.mjs
npm run check-bundle-markers
node bin/xclaw.mjs doctor
npm run release-gate:quick

### Tab lease heartbeat (C1)

```bash
export XCLAW_TAB_LEASE_TTL_MS=120000
export XCLAW_TAB_LEASE_HEARTBEAT_MS=40000   # default ~ttl/3
# export XCLAW_TAB_LEASE_HEARTBEAT=0        # disable auto interval
```

`tab_lease acquire` starts auto-renew; `release` stops it. Under fabric enforce, successful tab acts also touch the lease.

### Live e2e cadence (B3)

```bash
node bin/xclaw.mjs live-e2e                 # one-shot + log
node bin/xclaw.mjs live-e2e-schedule        # every 24h while gateway cron runs
npm run release-gate:live                   # pre-release
```

Log: `~/.xclaw/live-e2e-cron.log` — see [docs/PROD_PRESET.md](docs/PROD_PRESET.md#live-e2e-cadence-b3).
```

### Lab vs prod

| | Lab | Prod |
|--|-----|------|
| Commit gates | off | `XCLAW_COMMIT_GATES=1` |
| Fabric leases | off | `XCLAW_FABRIC_ENFORCE=1` |
| jsCode | allow | `read` or `deny` |
| Role | env OK | session bind / trusted only |
| MITM | optional | on if network truth required |


## Auth (optional)

```json
"gateway": { "token": "secret" }
```

```bash
curl -H "Authorization: Bearer secret" localhost:$PORT/pairing/pending
```

## Channels

### Telegram
```json
"channels": {
  "telegram": {
    "enabled": true,
    "token": "...",
    "dmPolicy": "pairing"
  }
}
```
Approve: `node bin/xclaw.mjs pairing approve telegram CODE`

### Discord
Enable Message Content Intent. Slash: `/ask`, `/status`, `/session`.
```json
"channels": {
  "discord": {
    "enabled": true,
    "token": "...",
    "dmPolicy": "pairing"
  }
}
```

## Cron announce
```json
POST /cron/jobs
{
  "name": "daily",
  "schedule": { "kind": "every", "everyMs": 86400000 },
  "sessionKey": "telegram:dm:CHAT_ID",
  "payload": { "message": "Daily brief" }
}
```

## Skills
Place `~/.xclaw/skills/<name>/SKILL.md` with YAML front matter (`name`, `priority`, `enabled`).

## Pairing UI
Open `/control/` → Pairing card.

## Systemd
```bash
node bin/xclaw.mjs daemon unit > ~/.config/systemd/user/xclaw.service
systemctl --user enable --now xclaw
```


## Doctor cron

Enabled by default every hour (`doctor.cron.everyMs`).

```json
"doctor": {
  "cron": {
    "enabled": true,
    "everyMs": 3600000,
    "notifyOnFail": true,
    "delivery": { "channel": "telegram", "to": "YOUR_CHAT_ID" }
  }
}
```

- Logs: `~/.xclaw/doctor-cron.log`
- Manual: `POST /doctor/run` or `node bin/xclaw.mjs doctor`
- Reschedule helper: `node bin/xclaw.mjs doctor-schedule 1800000`


## Alerting

```json
"alerting": {
  "enabled": true,
  "cooldownMs": 1800000,
  "minSeverity": "error",
  "targets": [
    { "channel": "telegram", "to": "YOUR_CHAT_ID" }
  ]
}
```

Triggers:
- Doctor failures (scheduled + `/doctor/run`)
- Cron job handler errors
- Manual: `xclaw alerts test` or `POST /alerts/test`

Cooldownpe: same alert key suppressed for `cooldownMs` (default 30m).


## PagerDuty escalation

1. Create an **Events API v2** integration in PagerDuty; copy the **Integration Key**.
2. Configure:

```json
"alerting": {
  "pagerduty": {
    "routingKey": "YOUR_INTEGRATION_KEY"
  },
  "targets": [
    { "channel": "telegram", "to": "CHAT_ID" },
    { "type": "pagerduty", "channel": "pagerduty" }
  ]
}
```

Or set `PAGERDUTY_ROUTING_KEY` in the environment (auto-added as a target).

Doctor failures and cron errors **trigger** incidents with stable `dedup_key`s.
Resolve:

```bash
node bin/xclaw.mjs alerts pd-resolve 'doctor:computer,provider'
# or POST /alerts/pd { "action": "resolve", "dedupKey": "..." }
```


### Escalation policy setup (PagerDuty UI)

Escalation **policies** are owned by PagerDuty. XClaw only **triggers** incidents.

1. **PagerDuty → People → Escalation Policies → New**
   - Level 1: primary on-call schedule (0–15 min)
   - Level 2: backup / secondary
   - Level 3: manager / team lead
2. **Service Directory → New Service**
   - Assign the escalation policy
   - Add integration: **Events API V2**
   - Copy **Integration Key** → `alerting.pagerduty.routingKey`
3. Optional REST token (read policies from CLI):
   - PagerDuty → User → API Access → Create Token
   - `alerting.pagerduty.apiToken` or `PAGERDUTY_API_TOKEN`
4. Verify:

```bash
node bin/xclaw.mjs alerts pd-setup
node bin/xclaw.mjs alerts pd-policies
node bin/xclaw.mjs alerts pd-services
```


### Customize escalation levels

```json
"alerting": {
  "pagerduty": {
    "apiToken": "REST_API_TOKEN",
    "escalation": {
      "name": "XClaw Escalation",
      "policyId": null,
      "numLoops": 2,
      "levels": [
        { "delayMinutes": 0,  "targets": [{ "type": "user", "id": "P_PRIMARY" }] },
        { "delayMinutes": 15, "targets": [{ "type": "schedule", "id": "P_BACKUP" }] },
        { "delayMinutes": 30, "targets": [{ "type": "user", "id": "P_MANAGER" }] }
      ]
    }
  }
}
```

```bash
node bin/xclaw.mjs alerts pd-levels template   # example levels
node bin/xclaw.mjs alerts pd-levels preview    # validate config
node bin/xclaw.mjs alerts pd-levels diff       # vs remote policy
node bin/xclaw.mjs alerts pd-levels apply      # create/update on PagerDuty
```

Find user/schedule IDs in PagerDuty URLs or `pd-policies` / REST API.
After create, set `policyId` so later applies update the same policy.
Assign the policy to your Events API service in the PD UI.


### PagerDuty webhooks (inbound)

1. PagerDuty → Integrations → **Generic Webhooks V3** (or service webhook)
2. URL: `https://<your-host>/webhooks/pagerduty`
3. Optional shared secret → `alerting.pagerduty.webhooks.secret` or `PAGERDUTY_WEBHOOK_SECRET`

```json
"alerting": {
  "pagerduty": {
    "webhooks": {
      "secret": "whsec_...",
      "mirrorToChannels": true
    }
  }
}
```

Events are logged to `~/.xclaw/pd-webhook-events.jsonl`.
Escalate events can mirror to Telegram/Discord via the alerter.

```bash
node bin/xclaw.mjs alerts pd-webhooks
curl -s localhost:$PORT/webhooks/pagerduty/recent
```

## CLI stream exit codes

See [docs/cli-run-exit-codes.md](docs/cli-run-exit-codes.md) for `xclaw run` exit status (`STREAM_NOT_FOUND` → 2, transient → 7, etc.).

## Stream resume & metrics (3.37)

### Gateway streams

| Endpoint | Notes |
|----------|--------|
| `POST /agent/run/stream` | Agent loop; SSE or NDJSON |
| `POST /swarm/run/stream` | Swarm run |
| `POST /channel/webchat/message/stream` | WebChat |

Headers: `Accept: application/x-ndjson` or `text/event-stream`  
Resume: `Last-Event-ID` header and/or body `{ "streamId", "resume": true, "lastEventId" }`

### CLI

```bash
xclaw gateway                                    # must be running
xclaw run --ndjson "List files in /tmp"
xclaw run --resume <streamId> --last-event-id <id>
xclaw run --resume bad --json-error; echo $?   # 2 if not found
```

Exit codes: see [docs/cli-run-exit-codes.md](docs/cli-run-exit-codes.md).

### Config

```json
"stream": {
  "capacity": 500,
  "ttlMs": 300000,
  "heartbeatMs": 15000,
  "backoff": "full",
  "baseMs": 1000,
  "maxMs": 30000,
  "maxResumeCycles": 5
}
```

Env overrides: `XCLAW_STREAM_*` — [docs/stream-config.md](docs/stream-config.md).

### Prometheus scrape

```yaml
scrape_configs:
  - job_name: xclaw
    metrics_path: /metrics
    scrape_interval: 15s
    static_configs:
      - targets: ["127.0.0.1:18790"]
```

Key series: `xclaw_stream_errors_total`, `xclaw_stream_resume_events_total`, `xclaw_stream_logs`.

Recording rules / alerts: `deploy/grafana/xclaw-stream-recording-rules.yaml`, `xclaw-stream-alerts-optimized.yaml`  
Dashboards: `deploy/grafana/xclaw-dashboard.json`, `xclaw-stream-dashboard.json`

### Retry scripting

```bash
source scripts/xclaw-run-lib.sh
./scripts/xclaw-run-with-retry.sh "smoke"
XCLAW_BACKOFF=decorrelated ./scripts/xclaw-run-with-retry.sh --resume "$ID" --last-event-id "$LAST"
```

### Ops checklist

1. `curl -fsS localhost:18790/metrics | grep xclaw_stream`
2. `xclaw doctor` — config validation includes `stream.*`
3. After deploy, confirm TTL/capacity match memory budget
4. Prefer recorded Prom series (`xclaw:stream_errors:rate5m`) in Grafana




## B0 — Human-like browser

```bash
# Durable profile (cookies / LS survive restarts)
export XCLAW_BROWSER_PROFILE_DIR=~/.xclaw/browser-profiles/default

# Visible Chromium window (headed)
export XCLAW_BROWSER_HEADED=1

# Humanize timing (default on)
export XCLAW_BROWSER_HUMANIZE=1
export XCLAW_BROWSER_HUMANIZE_SPEED=1.0   # 0.5 = slower, 2 = faster

# Optional seed from system Chrome
export XCLAW_BROWSER_COPY_SESSION=1
```

Modules: `src/browser/humanize.mjs`, `src/browser/profile.mjs`.
Config key: `browser.{profileDir,headless,humanize,humanizeSpeed,copySession}`.

## M1 — MITM (opt-in)

```bash
# OFF by default — enable explicitly
export XCLAW_MITM=true
export XCLAW_MITM_PORT=4444
export XCLAW_MITM_CONFDIR=~/.xclaw/mitm
# optional host allowlist (comma-separated)
export XCLAW_MITM_ALLOWLIST=api.example.com,cdn.example.com
# path to mitmdump if not on PATH
export XCLAW_MITMDUMP=/usr/local/bin/mitmdump

# install mitmproxy once
pip install mitmproxy

# supervisor starts/stops mitmdump when enabled
node scripts/gateway-supervisor.mjs
```

Flows (redacted): `~/.xclaw/mitm/flows.jsonl`  
Chrome proxy args (M2 CA trust still required): `--proxy-server=http://127.0.0.1:4444`


## M2 — Chrome proxy + CA trust

With `XCLAW_MITM=true`, Chromium launches with:

```text
--proxy-server=http://127.0.0.1:4444
--proxy-bypass-list=<-loopback>
--ignore-certificate-errors-spki-list=<mitm-ca-spki>   # when CA present
```

CA locations (first hit wins):

```text
$XCLAW_MITM_CONFDIR/mitmproxy-ca-cert.pem
~/.xclaw/mitm/mitmproxy-ca-cert.pem
~/.mitmproxy/mitmproxy-ca-cert.pem
```

Generate CA by running mitmdump once (supervisor does this when MITM enabled).

Lab-only (accept any cert):

```bash
export XCLAW_MITM_INSECURE_CERTS=1
```

Optional: install `libnss3-tools` for `certutil` profile import.


## M3 — MITM agent tools

With `XCLAW_MITM=true` and traffic through the proxy, the agent can call:

| Tool | Purpose |
|------|---------|
| `mitm_status` | enabled, listening, CA, flowCount |
| `mitm_flows` | filter recent redacted flows |
| `mitm_clear_flows` | wipe flows.jsonl |
| `mitm_control` | start / stop / status mitmdump |

Example filters on `mitm_flows`:

```json
{ "host": "api.example.com", "method": "POST", "statusMin": 400, "limit": 20 }
```

Secrets in headers/query are already redacted by the addon before write.

## Mitmproxy scripting

See **[docs/MITM_SCRIPTING.md](docs/MITM_SCRIPTING.md)** for addon hooks, env rules
(`XCLAW_MITM_BLOCK`, `XCLAW_MITM_MAP`, body capture), and custom addons.

Stock script: `src/browser/mitm-confdir/addons.py` → copied to `~/.xclaw/mitm/addons.py`.


## MITM startup order (3.42.3+)

Supervisor sequence when `XCLAW_MITM=true`:

1. `startMitm()` → mitmdump
2. `waitForMitmReady()` → listen + CA + ready file
3. Gateway/computer inherit `mitmEnvFromConfig()` (`XCLAW_MITM`, `XCLAW_CHROME_MITM_ARGS`, …)
4. Chromium gets `--proxy-server` + SPKI when CA present

Doctor: `node bin/xclaw.mjs doctor` reports `mitm.binary`, `mitm.proxy`, `mitm.ca`.

PATH tip: user installs live in `~/.local/bin` — `findMitmdump` searches there even if PATH is minimal.

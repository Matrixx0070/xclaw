# Production enforcement preset (B2)

Copy-paste environment for **locked-down** browser + computer sessions.
Lab defaults stay open; production must set these explicitly.

## Minimum prod block

```bash
export XCLAW_ROOT=/path/to/xclaw          # required so computer finds bridges
export XCLAW_PROFILE=prod                 # or: XCLAW_ENFORCEMENT_STRICT=1

# Phase A enforcement
export XCLAW_COMMIT_GATES=1               # pay/checkout/… need critic approval
export XCLAW_FABRIC_ENFORCE=1             # tab leases required when tabId set
export XCLAW_JSCODE_MODE=read             # block .click()/submit via jsCode; use motor tools
# Do NOT set XCLAW_ROLE_FROM_ENV=1 in prod unless you accept env spoofing
# Prefer: session_role action=bind role=actor (or swarm-trusted bind)

export XCLAW_AGENT_ID=worker-1            # stable agent id for leases
export XCLAW_SESSION_ID=worker-1          # optional; used for role binding

# Browser organism
export XCLAW_BROWSER_PROFILE_DIR=~/.xclaw/browser-profiles/prod
export XCLAW_BROWSER_HUMANIZE=1
# export XCLAW_BROWSER_HEADED=1           # only if you need a visible window

# Fabric durability (A8)
export XCLAW_FABRIC_DIR=~/.xclaw/fabric
export XCLAW_TAB_LEASE_TTL_MS=120000

# Bridges (manager usually sets these when XCLAW_ROOT is set)
# export XCLAW_HOOKS_BRIDGE=$XCLAW_ROOT/src/computer/hooks-bridge.mjs
# export XCLAW_MOTOR_BRIDGE=$XCLAW_ROOT/src/computer/motor-bridge.mjs
# export XCLAW_CHROME_ARGS_BRIDGE=$XCLAW_ROOT/src/computer/chrome-args-bridge.mjs
```

## Optional — network truth (MITM)

```bash
export XCLAW_MITM=true
export XCLAW_MITM_PORT=4444
export XCLAW_MITM_CONFDIR=~/.xclaw/mitm
# Lab only — prefer SPKI/NSS, not blanket ignore:
# export XCLAW_MITM_INSECURE_CERTS=1
export XCLAW_TRUTH_AUTO_ASSERT=1          # soft network binding after browser tools
```

## Lab / dev (not prod)

```bash
unset XCLAW_COMMIT_GATES
unset XCLAW_FABRIC_ENFORCE
export XCLAW_JSCODE_MODE=allow
export XCLAW_ROLE_FROM_ENV=1
export XCLAW_AGENT_ROLE=actor
export XCLAW_PROFILE=lab
```

## Verify before traffic

```bash
export XCLAW_ROOT=/path/to/xclaw
node scripts/a-enforcement-e2e.mjs          # offline A-plane (exit 0 or 1 OK; 2 = fail)
node scripts/c4-engine-soak.mjs             # engine resolution: every selector → native
node bin/xclaw.mjs doctor                   # includes a.* checks
# With Chrome available:
node scripts/live-enforcement-e2e.mjs       # or: npm run release-gate:live
```

## Release gate

```bash
npm run release-gate:quick                  # includes a-enforcement + markers
npm run release-gate                        # full gate
npm run release-gate:live                   # + live computer path
```

## Ops checklist (prod)

| Check | Expect |
|-------|--------|
| `XCLAW_ROOT` set | bridges resolve |
| `XCLAW_COMMIT_GATES=1` | `/checkout` blocked without critic gate |
| `XCLAW_FABRIC_ENFORCE=1` | no tab act without lease (unless auto) |
| `XCLAW_JSCODE_MODE=read` | `.click()` via jsCode denied |
| No `XCLAW_ROLE_FROM_ENV` | roles from `session_role` / trusted ctx |
| Engine resolution | every selector resolves native (c4-engine-soak) |
| Doctor `a.*` | no errors under strict/prod |
| Durable profile | `XCLAW_BROWSER_PROFILE_DIR` set if identity matters |

## Incident hints

| Symptom | Check |
|---------|--------|
| Navigate blocked on normal URL | role bound as observer/critic? bind `actor` |
| Checkout always blocked | open/approve `commit_gate`; critic role |
| `HOOKS_UNAVAILABLE` | `XCLAW_ROOT` / `XCLAW_HOOKS_BRIDGE` |
| `TAB_LEASE_HELD` | other agent holds tab; `tab_lease release` or wait TTL |
| Motor missing | `XCLAW_MOTOR_BRIDGE`; `browser_click` not raw jsCode |
| MITM HTTPS errors | CA ensure + SPKI; avoid insecure certs in prod |

## Related

- [OPS.md](../OPS.md) — general operations
- [COMPUTER_SOURCE_OF_TRUTH.md](COMPUTER_SOURCE_OF_TRUTH.md) — computer ownership
- [MITM_SCRIPTING.md](MITM_SCRIPTING.md) — MITM addons

## Live e2e cadence (B3)

Prove the **real computer path** on a schedule (not only offline smoke).

### One-shot

```bash
export XCLAW_ROOT=/path/to/xclaw
node scripts/live-enforcement-e2e.mjs
# or via CLI (logs to ~/.xclaw/live-e2e-cron.log):
node bin/xclaw.mjs live-e2e
```

### In-process schedule (gateway must stay up)

The gateway registers the job **only** when `liveE2e.cron.enabled` is the
boolean `true`. Doctor/eval default on; live-e2e does not — a stock
gateway must not spawn Chromium. CLI `live-e2e-schedule` still arms on
request (honours `enabled: false`).

Default **every 24h** (anchored as `cron.liveE2e` so restarts do not
reset the clock):

```bash
node bin/xclaw.mjs live-e2e-schedule           # 86400000 ms
node bin/xclaw.mjs live-e2e-schedule 21600000  # every 6h
```

Config (optional in `xclaw.json`):

```json
"liveE2e": {
  "cron": {
    "enabled": true,
    "everyMs": 86400000,
    "strict": false,
    "timeoutMs": 600000,
    "delivery": { "channel": "telegram", "to": "YOUR_CHAT_ID" }
  }
}
```

- Log: `~/.xclaw/live-e2e-cron.log`
- `timeoutMs` (default 600000) bounds one pass; the child is SIGTERM'd, then
  SIGKILL'd after `graceMs` (default 2000), and the run is reported as a hard
  failure with `reason=timeout`. Without it a wedged check hangs the job forever
- Exit 1 (warnings) = soft pass unless `XCLAW_LIVE_E2E_STRICT=1` or `strict: true`
- Exit 2 = hard fail + alert when delivery configured

### Pre-release

```bash
npm run release-gate:live
# or
XCLAW_LIVE_E2E=1 npm run release-gate
```

### Systemd timer (host cron alternative)

```ini
# ~/.config/systemd/user/xclaw-live-e2e.service
[Unit]
Description=XClaw live enforcement e2e

[Service]
Type=oneshot
Environment=XCLAW_ROOT=/path/to/xclaw
WorkingDirectory=/path/to/xclaw
ExecStart=/usr/bin/node scripts/live-enforcement-e2e.mjs --json
```

```ini
# ~/.config/systemd/user/xclaw-live-e2e.timer
[Unit]
Description=Nightly XClaw live e2e

[Timer]
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
systemctl --user enable --now xclaw-live-e2e.timer
```

### Requirements

- Machine with Chromium/Chrome discoverable (or accept chrome-related **warnings**)
- `XCLAW_ROOT` set so hooks/motor/chrome-args bridges load in the computer process


## Alerting (B4)

Shared alerter covers doctor, live-e2e, and Phase A enforcement failures.

```json
"alerting": {
  "enabled": true,
  "cooldownMs": 1800000,
  "minSeverity": "error",
  "targets": [
    { "channel": "telegram", "to": "YOUR_CHAT_ID" }
  ]
},
"doctor": {
  "cron": {
    "enabled": true,
    "everyMs": 3600000,
    "notifyOnFail": true
  }
},
"liveE2e": {
  "cron": {
    "everyMs": 86400000,
    "delivery": { "channel": "telegram", "to": "YOUR_CHAT_ID" }
  }
}
```

- Doctor cron also runs enforcement slice (`a.*` / `h0.*`); errors → `alertEnforcementFailure`
- Live e2e hard fail → `alertLiveE2eFailure`
- Cooldown prevents alert storms (`cooldownMs`)

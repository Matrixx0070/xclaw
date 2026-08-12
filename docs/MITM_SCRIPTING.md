# XClaw mitmproxy scripting

XClaw runs **mitmdump** with `addons.py` from the MITM confdir
(`~/.xclaw/mitm/` or `XCLAW_MITM_CONFDIR`).

Package default: `src/browser/mitm-confdir/addons.py`  
Copied into the confdir on first `ensureMitmConfdir()` if missing.

## Quick start

```bash
export XCLAW_MITM=true
pip install mitmproxy
node scripts/gateway-supervisor.mjs
```

## Built-in scripting (env)

| Env | Effect |
|-----|--------|
| `XCLAW_MITM_ALLOWLIST` | Only log/transform these hosts (comma) |
| `XCLAW_MITM_BLOCK` | Return 403 if host/path contains substring |
| `XCLAW_MITM_MAP` | Path rewrite `old=>new,old2=>new2` |
| `XCLAW_MITM_CAPTURE_BODY=1` | Attach redacted body snippets to flows |
| `XCLAW_MITM_BODY_MAX` | Max chars per body (default 2048) |
| `XCLAW_MITM_DUMP_HOSTS` | Write detailed JSON dumps under `dumps/` |

Examples:

```bash
# Only API traffic
export XCLAW_MITM_ALLOWLIST=api.example.com,auth.example.com

# Block trackers
export XCLAW_MITM_BLOCK=google-analytics,facebook.com/tr

# Rewrite staging path
export XCLAW_MITM_MAP=/api/v1=>/api/v2

# Capture bodies for agent inspection
export XCLAW_MITM_CAPTURE_BODY=1
export XCLAW_MITM_BODY_MAX=4096
```

## Addon lifecycle hooks

mitmproxy calls methods on classes listed in `addons = [...]`:

| Hook | When |
|------|------|
| `load(loader)` | Process start — register options |
| `configure(updated)` | Options changed |
| `request(flow)` | Client request (modify / block / map) |
| `response(flow)` | Server response (log / rewrite body) |
| `error(flow)` | Error |
| `websocket_message(flow)` | WS frame |
| `done()` | Shutdown |

Reference: [mitmproxy addon events](https://docs.mitmproxy.org/stable/addons-events/)

## Custom addon next to stock

Edit `~/.xclaw/mitm/addons.py` (or replace the file). Stock registers:

```python
addons = [XClawFlows(), XClawEcho()]
```

Add your class:

```python
class MyRewrite:
    def response(self, flow):
        if flow.request.host == "api.example.com" and flow.response:
            # example: force JSON pretty flag for debugging
            flow.response.headers["X-Debug"] = "xclaw"

addons = [XClawFlows(), XClawEcho(), MyRewrite()]
```

Example file in-repo: `src/browser/mitm-confdir/examples/inject_header.py`

After edits, restart mitmdump:

```bash
# via agent tool
mitm_control action=stop
mitm_control action=start
# or supervisor restart
```

## Agent tools (M3)

| Tool | Use |
|------|-----|
| `mitm_status` | Is proxy up? CA? flow count? |
| `mitm_flows` | Filter redacted history |
| `mitm_clear_flows` | Wipe `flows.jsonl` |
| `mitm_control` | start / stop / status |

## Security notes

- **Default off** — `XCLAW_MITM` must be set.
- Secrets in headers/query/JSON bodies are redacted before disk write.
- Prefer allowlist in prod.
- `XCLAW_MITM_INSECURE_CERTS=1` is lab-only.
- Do not log raw Authorization/Cookie values in custom addons.

## Manual mitmdump (debug)

```bash
mitmdump \
  --listen-host 127.0.0.1 -p 4444 \
  --set confdir=$HOME/.xclaw/mitm \
  -s $HOME/.xclaw/mitm/addons.py \
  --ssl-insecure \
  --set xclaw_tag=lab
```


## Stock hooks (XClawFlows)

| Hook | Behavior |
|------|----------|
| `load` / `configure` | Register `xclaw_tag` option |
| `running` | Write `confdir/ready` + `stats.json` |
| `requestheaders` | Early block via `XCLAW_MITM_BLOCK` (no body buffer) |
| `request` | Block fallback + path map (`XCLAW_MITM_MAP`) |
| `responseheaders` | Optional `Set-Cookie` strip (`XCLAW_MITM_STRIP_COOKIES=1`) |
| `response` | Redacted flows.jsonl (+ optional bodies/dumps) |
| `error` | Log transport errors to flows + stats |
| `tls_failed_client` / `tls_failed_server` | Log TLS failures; surface in `mitm_status` |
| `done` | Final stats; remove ready file |

`mitm_status` exposes `ready`, `errors`, `blocked`, `tlsFailClient`, `tlsFailServer`, and raw `stats`.

## CA certificate management

mitmproxy generates a local CA on first start in the confdir:

```text
~/.xclaw/mitm/mitmproxy-ca-cert.pem   # public cert (PEM)
~/.xclaw/mitm/mitmproxy-ca.pem        # key + cert
~/.xclaw/mitm/mitmproxy-ca.p12        # PKCS#12
```

### API (`src/browser/mitm.mjs`)

| Function | Purpose |
|----------|---------|
| `findMitmCaCert()` | Locate PEM |
| `getMitmCaInfo()` | subject, dates, fingerprint, SPKI |
| `ensureMitmCa()` | Generate via short mitmdump if missing |
| `exportMitmCa(dest)` | Copy PEM + P12 + `.spki` sidecar |
| `mitmCaStatus()` | Agent/doctor summary + trust methods |
| `mitmCaSpkiHash()` | Base64 SHA-256 SPKI for Chrome |
| `trustMitmCaInProfile(userDataDir)` | `certutil` import into NSS DB |

### Agent tool `mitm_ca`

```json
{ "action": "status" }
{ "action": "ensure" }
{ "action": "export", "dest": "/tmp/ca-export" }
{ "action": "trust", "dest": "/path/to/chrome-user-data" }
```

### Trust paths (preferred → lab)

1. **SPKI list** — `--ignore-certificate-errors-spki-list=<hash>` (scoped to this CA)
2. **certutil** — import into Chromium profile NSS DB
3. **CDP** — `Security.setIgnoreCertificateErrors` for the session
4. **Lab only** — `XCLAW_MITM_INSECURE_CERTS=1`

Supervisor calls `ensureMitmCa()` before `waitForMitmReady()` so Chrome can use SPKI on first navigation.

## Horizon 2 — Policy DSL (`policy.json`)

Path: `$XCLAW_MITM_CONFDIR/policy.json` (default `~/.xclaw/mitm/policy.json`)

```json
{
  "version": 1,
  "rules": [
    {
      "id": "block-trackers",
      "action": "block",
      "match": { "hostOrPathContains": "evil-tracker" }
    },
    {
      "id": "rewrite-api",
      "action": "map",
      "match": { "pathPrefix": "/v1/" },
      "rewrite": { "pathPrefix": "/v2/" }
    },
    {
      "id": "checkout-must-post",
      "action": "require",
      "match": { "hostContains": "api.shop", "method": "POST", "pathContains": "/checkout" },
      "expect": { "status": 200, "minFlows": 1 }
    }
  ]
}
```

| action | Where enforced |
|--------|----------------|
| `block` / `deny` | mitmproxy addon (requestheaders) |
| `map` | mitmproxy addon (request path) |
| `require` / `expect` | Agent loop when `XCLAW_TRUTH_AUTO_ASSERT=1` + `browser_assert` |

Agent tools: `mitm_policy` (get\|set\|test), `mitm_export` (proof bundle).

```bash
export XCLAW_TRUTH_AUTO_ASSERT=1   # annotate browser_* tool results with require-rule checks
export XCLAW_MITM_SYNC_ADDON=1     # resync addons.py after upgrades
```

# P3 implementation steps (detailed)

**Version:** 3.0.0  
**Goal:** Connected apps, neural TTS, X semantic search, artifacts UI, browser clipboard/PDF, host persistence.

Master map: [PHASES_P0_P4.md](./PHASES_P0_P4.md)

---

## Prerequisites (before P3)

- P0–P2 already on tree (local tools registry, channels manager, agent loop local-tool path)
- `src/tools/registry.mjs` aggregates local tools into the agent loop
- Gateway serves HTTP and static UI under `ui/`

---

## Step 1 — Token store (P3.1 foundation)

**File:** `src/connected/token-store.mjs`

1. Choose store path: `{configDir or ~/.xclaw}/connected-tokens.json`
2. Implement:
   - `loadTokens(cfg)` → `{ version, apps }` (empty on missing file)
   - `saveTokens(cfg, data)` → mkdir + write JSON
   - `setAppToken(cfg, appId, record)` → merge `updatedAt`
   - `getAppToken(cfg, appId)`
   - `listConnectedApps(cfg)` → `{ id, hasToken, updatedAt, scopes }`
3. Never log raw tokens; store only what the operator wrote via config/CLI later

**Shape:**
```json
{
  "version": 1,
  "apps": {
    "github": { "accessToken": "ghp_…", "updatedAt": "…" }
  }
}
```

---

## Step 2 — Connected catalog (P3.1)

**File:** `src/connected/catalog.mjs`

1. Define `CONNECTED_CATALOG` entries, each with:
   - `id`, `name`, `description`
   - `envKeys[]` (documentation + resolve order)
   - `tools[]` with `name`, `description`, `input_schema`
2. Apps shipped:
   - **voice** → tool `voice_speak`
   - **github** → tool `github_request`
   - **generic_http** → tool `connected_http` (needs `app_id`)
3. `listCatalogTools()` flattens tools and prefixes description with `[AppName]`
4. `resolveToken(cfg, appId)`:
   - Prefer env (`GITHUB_TOKEN` / `GH_TOKEN`, `TTS_API_KEY` / `OPENAI_API_KEY` / `XAI_API_KEY`)
   - Else `getAppToken` from store
   - Return `{ accessToken, source }` or `null`

---

## Step 3 — Connected tool executors (P3.1 + P3.2)

**File:** `src/tools/connected-tools.mjs`

### 3a. `search_connected_tools`

1. Score catalog tools (+ optional `cfg.mcp.tools`) by query token overlap
2. Return JSON list of `{ name, description, input_schema, app_id? }`
3. If no score hits, return first N catalog tools

### 3b. `call_connected_tool`

Dispatch on `tool_name`:

#### `voice_speak` (P3.2 neural TTS)

1. Resolve output path: `arguments.out` or `artifacts/audio/speak_<ts>.wav`
2. **Neural path:** `POST {TTS_BASE_URL or OpenAI}/audio/speech` with Bearer key  
   - body: `{ model, input, voice }`  
   - write mp3/wav bytes to disk
3. **Local path:** try `espeak-ng -w`, `espeak -w`, optional `piper`
4. **Fallback:** write `.txt` sidecar and report clearly (no crash)

#### `github_request`

1. `resolveToken(cfg, "github")` — fail with actionable message if missing
2. `fetch https://api.github.com{path}` with `Authorization: Bearer`, `Accept: application/vnd.github+json`
3. Return `HTTP status` + body slice (cap ~50k chars)

#### `connected_http`

1. Require `app_id` + `url` (http/https only)
2. Bearer from `resolveToken(cfg, app_id)`
3. Optional JSON body; return status + text

### 3c. Wire into registry

In `src/tools/registry.mjs`:

```js
...createConnectedTools({ workingDir, cfg }),
```

Agent loop already executes any name in `localToolNames(localTools)`.

### 3d. safeAuto

Add `search_connected_tools`, `call_connected_tool` to `security.safeAuto` in defaults so risky policy does not block them unnecessarily.

---

## Step 4 — X semantic search (P3.3)

**File:** `src/tools/x-tools.mjs` → `createXSemanticSearchTool`

1. Register name `x_semantic_search`
2. Call existing `x_keyword_search` with higher limit
3. If `XAI_API_KEY` present, POST chat completion asking model to rank/summarize top matches for the intent
4. If no key or chat fails, return keyword results with `metadata.provider = keyword_proxy`
5. Export via `createXTools()` array
6. Add to `safeAuto`

**Note:** True embedding search needs X API products not always available; this is intentional fail-soft semantic *rerank*.

---

## Step 5 — Artifacts browser (P3.4)

### 5a. Lister

**File:** `src/artifacts/browser.mjs`

1. Walk interesting roots only: `artifacts`, `telegram-media`, `discord-media`, `slack-media`, `imagine_images`, `screenshots`, `video_frames`, `pdf`, `audio`
2. Cap depth and file count; sort by `mtime` desc
3. Return `{ root, count, files: [{ path, size, mtime }] }`

### 5b. UI

**File:** `ui/artifacts/index.html`

1. Dark minimal table UI
2. `fetch('/artifacts/list')` → client filter by path substring

### 5c. Gateway routes

**File:** `src/gateway/index.mjs`

1. `GET /artifacts/list` → `listArtifacts(workspace)` JSON
2. `GET /artifacts` → serve `ui/artifacts/index.html`
3. Workspace = `cfg.agent.workingDir || cfg.workspace || cwd`
4. Keep `/artifacts` on public UI list unless `gateway.publicUi === false`

---

## Step 6 — Browser clipboard & PDF (P3.5)

**File:** `src/tools/browser-tools.mjs`

### `browser_clipboard`

1. Require computer session (`computer` + `sessionId` from agent loop ctx)
2. `action: read|write` via `xclaw_browser_tab` + `jsCode` using `navigator.clipboard`
3. Best-effort: clipboard permissions may fail in headless — return error text, not throw

### `browser_pdf`

1. Optional `url` open via browser_tab
2. Capture HTML snapshot to `artifacts/pdf/page_*.html`
3. Instruct agent to run `office_convert` if binary PDF required
4. (Computer server may not expose CDP `Page.printToPDF`; HTML path is the robust default)

### Registry

`createBrowserTools(ctx)` must receive `{ computer, sessionId, workingDir }` from agent loop (same as screenshot/snapshot).

---

## Step 7 — Persistence story (P3.6)

### Docs

**File:** `docs/PERSISTENCE.md`

- systemd unit example (`Restart=always`)
- Docker Compose volume for `~/.xclaw`
- Cron + health URL

### Watchdog

**File:** `scripts/watchdog.sh`

1. `curl -fsS $XCLAW_HEALTH_URL` (default `http://127.0.0.1:$PORT/ready`)
2. On failure: `systemctl restart xclaw` if enabled, else `nohup node bin/xclaw.mjs gateway`

### Deploy assets

- `deploy/docker-compose.yml`
- `deploy/xclaw.service` (if present)
- `deploy/env.example`

---

## Step 8 — Tests

**File:** `test/p3-tools.test.mjs`

1. Registry includes `x_semantic_search`, `browser_clipboard`, `browser_pdf`
2. Catalog lists `voice_speak` and `github_request`
3. `listArtifacts(cwd)` returns `{ count, files }`

Run:

```bash
node --test test/p3-tools.test.mjs
# or
npm run eval:regression
```

---

## Step 9 — Version & docs

1. `package.json` version **3.0.0**
2. `docs/PHASE_P3.md` summary table
3. Changelog entry under `## 3.0.0 — P3 platform`
4. Cross-link from `PHASES_P0_P4.md`

---

## Operator verification checklist

```bash
# Connected search
# (via agent or unit) search_connected_tools { query: "github" }

export GITHUB_TOKEN=ghp_...
# call_connected_tool github_request path=/user

export OPENAI_API_KEY=...   # or TTS_API_KEY
# call_connected_tool voice_speak text="hello"

# Artifacts (gateway running)
curl -fsS http://127.0.0.1:4243/artifacts/list | head
open http://127.0.0.1:4243/artifacts

# Persistence
chmod +x scripts/watchdog.sh
XCLAW_SERVER_PORT=4243 ./scripts/watchdog.sh
```

---

## Design choices (why)

| Choice | Reason |
|--------|--------|
| Env before file tokens | 12-factor; easy CI |
| Fail-soft TTS | Sandbox may lack espeak and cloud TTS |
| Keyword + LLM rerank for X | No guaranteed embedding API |
| HTML fallback for PDF | CDP print not always exposed on computer server |
| Interesting-dir walk only | Avoid scanning entire monorepo |

---

## Non-goals (P3)

- Full OAuth dance UI (authorization code + PKCE) — token store is manual/env
- Neural TTS without any API key or local binary
- Slack/Email (those are P2)
- Gateway TLS (P4)

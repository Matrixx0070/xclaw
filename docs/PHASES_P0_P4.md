# XClaw phases P0–P4 (complete reference)

Shipped through **v3.1.0**. This document is the full detail map for the gap roadmap bands.

Related: [ROADMAP_GAPS.md](./ROADMAP_GAPS.md) · [SHIP_3.1.md](./SHIP_3.1.md) · [FULL_TOOL_SURFACE.md](./FULL_TOOL_SURFACE.md)

---

## P0 — Foundation (v2.7.0)

**Goal:** Local agent quality, Office skill depth, browser visibility, Telegram media, LO reliability.

| ID | Item | Implementation | Paths / config |
|----|------|----------------|----------------|
| P0.1 | Full Office skill trees | Sync Grok skills into `skills/bundled/` (docx/pptx/xlsx scripts + office py helpers; skip huge XSD/templates) | `skills/bundled/{docx,pptx,xlsx,pdf,ffmpeg,…}`; loader also scans `~/.grok/skills` |
| P0.2 | Browser screenshot | `browser_screenshot` → computer `xclaw_browser_tab` with `screenshot: desktop`; saves under `artifacts/screenshots/` | `src/tools/browser-tools.mjs` |
| P0.3 | Browser snapshot | `browser_snapshot` → page JS for title/url/headings/links/main text | same |
| P0.4 | Telegram media ingest | photo/document/voice/video/audio via `getFile`; paths under `telegram-media/`; caption+path in agent prompt | `src/channels/telegram/index.mjs` |
| P0.5 | LibreOffice UNO optional | Isolated `UserInstallation` per job; optional `cfg.office.unoUrl` + `userInstallation` | `src/tools/media-tools.mjs`; `docs/LIBREOFFICE_HEADLESS.md` |

**Env:** `XCLAW_LO_UNO_URL`, `XCLAW_LO_USER_INSTALLATION`

**Exit:** Skills load via `xclaw skills list`; screenshot/snapshot in tool list; media-only Telegram messages accepted.

---

## P1 — Media & vision (v2.8.0)

**Goal:** Parity with product-style media tools; fail-soft without keys.

| ID | Item | Implementation | Paths / config |
|----|------|----------------|----------------|
| P1.1 | `view_x_video` | ffprobe metadata; evenly spaced ffmpeg frames → `artifacts/video_frames/`; optional subs + tesseract OCR | `src/tools/video-tools.mjs` |
| P1.2 | Stronger `search_images` | Backend chain: Bing → SerpAPI → Openverse → Unsplash; always write files to `artifacts/images/` | `src/tools/image-tools.mjs` |
| P1.3 | `generate_image` | Multi model/endpoint try against xAI images API; clear error + search fallback | same |
| P1.4 | `edit_image` | Try API edits; else prompt→ImageMagick op map (grayscale, blur, rotate, sharpen, …) | same |
| P1.5 | `view_image` vision | Multi-model vision retry (`XCLAW_VISION_MODEL`, grok-2-vision-*) + OCR/metadata | `src/tools/media-tools.mjs` |

**Env:** `XAI_API_KEY`, `XCLAW_IMAGE_MODEL`, `XCLAW_VISION_MODEL`, `BING_SEARCH_KEY`, `SERPAPI_API_KEY`

**Tests:** `test/p1-tools.test.mjs` (synthetic mp4 frames)

---

## P2 — Channels & Office depth (v2.9.0)

**Goal:** Multi-channel ops + richer Discord + template pack.

| ID | Item | Implementation | Paths / config |
|----|------|----------------|----------------|
| P2.1 | Slack | `conversations.history` poll; file download → `slack-media/`; thread replies | `src/channels/slack/index.mjs`; `SLACK_BOT_TOKEN` + `channelIds` |
| P2.2 | Email | Pure Node IMAP UNSEEN + SMTP AUTH LOGIN; `allowFrom` | `src/channels/email/index.mjs`; `EMAIL_IMAP_*` / `EMAIL_SMTP_*` |
| P2.3 | Discord attachments | Attach-only messages; files → `discord-media/` | `src/channels/discord/index.mjs` |
| P2.4 | pptx templates | Curated ~20 JS templates under bundled skill | `skills/bundled/pptx/templates/` |
| P2.5 | Office helpers | docx/xlsx `scripts/office/*.py` helpers (pack/unpack/validate) | `skills/bundled/*/scripts/office/` |

**Manager:** telegram · discord · slack · email (`src/channels/manager.mjs`)

**Tests:** `test/channels-p2.test.mjs`

---

## P3 — Platform & connected apps (v3.0.0)

**Goal:** Connected tool catalog, TTS, X semantic, artifacts UI, browser extras, persistence story.

| ID | Item | Implementation | Paths / config |
|----|------|----------------|----------------|
| P3.1 | Connected catalog | voice, github, generic_http; token store | `src/connected/catalog.mjs`, `token-store.mjs` → `~/.xclaw/connected-tokens.json` |
| P3.2 | Neural TTS | OpenAI-compatible `/audio/speech` → espeak/piper → text sidecar | `call_connected_tool` / `voice_speak` |
| P3.3 | `x_semantic_search` | Keyword search + optional xAI rerank | `src/tools/x-tools.mjs` |
| P3.4 | Artifacts UI | `GET /artifacts`, `GET /artifacts/list` | `src/artifacts/browser.mjs`, `ui/artifacts/` |
| P3.5 | Browser clipboard / PDF | `browser_clipboard`, `browser_pdf` | `src/tools/browser-tools.mjs` |
| P3.6 | Persistence | systemd notes, compose, watchdog | `docs/PERSISTENCE.md`, `deploy/`, `scripts/watchdog.sh` |

**Env:** `GITHUB_TOKEN`, `TTS_API_KEY` / `OPENAI_API_KEY`, `TTS_BASE_URL`, `X_BEARER_TOKEN`

**Tests:** `test/p3-tools.test.mjs`

---

## P4 — Production publish (v3.1.0)

**Goal:** Secure gateway, Slack realtime, image matrix, CI, container.

| ID | Item | Implementation | Paths / config |
|----|------|----------------|----------------|
| P4.1 | Gateway auth + TLS | Strict protected paths when token set; HTTPS | `src/gateway/auth.mjs`, `tls.mjs`; `XCLAW_GATEWAY_TOKEN`, `XCLAW_TLS_CERT/KEY` |
| P4.2 | Slack Socket Mode | `apps.connections.open` + WebSocket | `appToken` / `SLACK_APP_TOKEN`, `socketMode: true` |
| P4.3 | Imagine model matrix | Ordered model/endpoint tries | `src/media/imagine-models.mjs`; `XCLAW_IMAGE_MODELS` |
| P4.4 | Eval regression CI | Unit packs (+ optional live) | `npm run eval:regression` → `scripts/eval-regression.mjs` |
| P4.5 | Docker publish | Slim image + healthcheck + publish docs | `Dockerfile`, `docs/PUBLISH.md` |

**Tests:** `test/gateway-auth-p4.test.mjs` · eval-regression unit packs

---

## Tool surface (after P0–P4)

### Computer
`xclaw_bash`, `xclaw_file_read`, `xclaw_file_write`, `xclaw_file_edit`, `xclaw_browser_tab`, `xclaw_browser_network_details`

### Local agent
`glob`, `grep`, `web_fetch`, `web_search`, `file_type`, `markitdown`, `host_capabilities`,  
`ocr`, `office_convert`, `view_image`, `search_images`, `generate_image`, `edit_image`,  
`view_x_video`, `finance_quote`,  
`x_keyword_search`, `x_user_search`, `x_thread_fetch`, `x_semantic_search`,  
`search_connected_tools`, `call_connected_tool`,  
`browser_screenshot`, `browser_snapshot`, `browser_clipboard`, `browser_pdf`

### Channels
Telegram · Discord · Slack (poll + socket) · Email · WebChat

---

## Version map

| Version | Band |
|---------|------|
| 2.7.0 | P0 |
| 2.8.0 | P1 |
| 2.9.0 | P2 |
| 3.0.0 | P3 |
| **3.1.0** | **P4 + ship** |

## Verify

```bash
npm run eval:regression
node bin/xclaw.mjs doctor
node bin/xclaw.mjs skills list
# with gateway up:
curl -fsS http://127.0.0.1:4243/ready
curl -fsS -H "Authorization: Bearer $XCLAW_GATEWAY_TOKEN" http://127.0.0.1:4243/version
```

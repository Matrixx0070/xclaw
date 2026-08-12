# Phase P3 complete (v3.0.0)

| Item | Status |
|------|--------|
| P3.1 Connected OAuth catalog | voice, github, generic_http + token store |
| P3.2 Neural TTS | OpenAI-compatible `/audio/speech` then espeak/piper |
| P3.3 x_semantic_search | Keyword + optional xAI rerank |
| P3.4 Artifacts UI | GET `/artifacts` + `/artifacts/list` |
| P3.5 browser_clipboard, browser_pdf | CDP/page helpers |
| P3.6 Persistence | docs/PERSISTENCE.md, deploy/docker-compose.yml, scripts/watchdog.sh |

## Connected tokens

Store: `~/.xclaw/connected-tokens.json`  
Env: `GITHUB_TOKEN`, `TTS_API_KEY` / `OPENAI_API_KEY`, `TTS_BASE_URL`

Full detail: [PHASES_P0_P4.md](./PHASES_P0_P4.md)

Implementation steps: [PHASE_P3_IMPLEMENTATION.md](./PHASE_P3_IMPLEMENTATION.md)

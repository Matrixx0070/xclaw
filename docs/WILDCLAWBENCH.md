# WildClawBench + XClaw

Reference (MIT): https://github.com/InternLM/WildClawBench

## Category → XClaw modes

| WildClaw category | XClaw mode id | Status |
|-------------------|---------------|--------|
| Productivity Flow | `productivity_flow` | partial |
| Code Intelligence | `code_intelligence` | partial |
| Social Interaction | `social_interaction` | partial |
| Search Retrieval | `search_retrieval` | partial |
| Creative Synthesis | `creative_synthesis` | partial |
| Safety Alignment | `safety_alignment` | partial |

See `src/eval/wildclaw-modes.mjs` for tools and notes.

## What shipped

- **A4 pack** + **a4-W\*** cases inspired by WildClaw *modes* (not the full 60 Docker tasks)
- **grok-4.6** registered as default xAI model
- Metrics: completion, handoff, tool-first

## Full 60-task suite

Still requires Harbor/Docker workspaces from InternLM. Path:

1. Submodule `third_party/WildClawBench`
2. Tool name bridge
3. Nightly Docker runner

Do not equate A4/W scores with official WildClawBench leaderboard numbers.

## Wave B (fixtures)

Official task **workspaces** live on HuggingFace (`internlm/WildClawBench` → `workspace/`).

```bash
# download (python huggingface_hub)
python3 -c "from huggingface_hub import snapshot_download; snapshot_download('internlm/WildClawBench', repo_type='dataset', local_dir='/tmp/wc-hf/WildClawBench-data', allow_patterns=['workspace/04_Search_Retrieval/**','workspace/01_Productivity_Flow/**','workspace/06_Safety_Alignment/**'])"

python3 scripts/wave-b-install-fixtures.py
```

- Installed under `eval/fixtures/wc/*`
- Large trees (>80 files, e.g. some safety) skipped by default (`WILDCLAW_MAX_FIXTURE_FILES`)
- Cases with fixtures: `eval/cases/wildclaw-wave-b.json`
- Attribution: InternLM/WildClawBench (MIT / dataset terms)

## Wave C2 — FastAPI mocks + video creative cases

### FastAPI gmail / calendar / slack

```bash
# terminals (or scripts/start-wc-fastapi-mocks.py after fixtures installed)
cd eval/fixtures/wc-fastapi/meeting/mock_services/gmail
PYTHONPATH=.. GMAIL_FIXTURES=../../fixtures/gmail/inbox.json python3 -m uvicorn server:app --port 9100

cd ../calendar
PYTHONPATH=.. CALENDAR_FIXTURES=../../fixtures/calendar/events.json python3 -m uvicorn server:app --port 9101

cd ../../../../wc-fastapi/slack/mock_services/slack
PYTHONPATH=.. python3 -m uvicorn server:app --port 9102
```

Agent tools: `xclaw_gmail_list`, `xclaw_gmail_get`, `xclaw_gmail_send`, `xclaw_calendar_list`, `xclaw_calendar_create`, `xclaw_slack_list`.

### Video creative cases

`eval/cases/wildclaw-wave-c2-video.json` — many tasks lack full MP4s in the public HF workspace (binaries live in Docker images). Soft eval + local image/pdf fixtures where present.

## Video policy (option 2 — active)

**Docker video images are skipped** in the default XClaw eval path.

- Cases: `eval/cases/wildclaw-wave-c2-video.json` (soft-only)
- Allowed: local HF workspace fixtures (png/jpg/pdf/gt JSON) under `eval/fixtures/wc/wc-05_*`
- Not required: `wildclawbench-*.tar` Docker loads or MP4 extraction
- Grading: soft (`results/` exists + agent completes); no official video checkpoint graders unless fixtures provide text GT

To enable official video later: pull images on a host with Docker + ≥16GB disk, then mount assets into fixtures.


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

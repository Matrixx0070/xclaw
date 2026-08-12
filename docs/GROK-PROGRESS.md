# GROK-PROGRESS

## 2026-08-12 — Design-review P0 honesty fixes

STATUS: green

### FIXED (Claude Code report)
1. **swarm early-merge** — no longer forces `autoMerge:true` (prod can skip)
2. **soak-multinight** — removed synthetic backdated nights
3. **release-gate** — no exit 1→0 remap; weak steps advisory
4. **eval cron** — `intervalMs`/`everyMs` aligned (not silent 60s)

### TESTS
test/swarm-early-merge-policy.test.mjs 3/3

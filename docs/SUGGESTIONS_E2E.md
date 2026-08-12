# Suggestions arc — e2e harden checklist

## Flow under test

```
toolTrace (status/outcome/artifacts)
    → detectTurnClosure
    → buildTurnSuggestions (schema chips | commit chip)
    → Telegram keyboard / plain
    → shown + tapped feedback (memory + ~/.xclaw/suggestion-feedback.json)
    → score bias on next turn
    → agent-metrics + Prometheus
    → xclaw doctor (agent_tools / agent_suggestions / agent_closure / suggestion_feedback)
```

## Automated

```bash
node --test test/suggestions-e2e.test.mjs
node --test test/suggestions.test.mjs test/tool-trace.test.mjs test/suggestion-feedback.test.mjs test/agent-metrics.test.mjs test/git-status.test.mjs
```

## Manual (live bot)

1. Trigger a failing tool turn → expect **Diagnose / Fix tests** chip.
2. Tap chip → bot re-runs prompt; `suggestion-feedback.json` gains `tapped`.
3. Finish an implement task with dirty git → expect **Commit N changes**.
4. `xclaw doctor` → info lines for agent_suggestions + suggestion_feedback.
5. `curl -s localhost:PORT/metrics | grep xclaw_suggestion`

## Config knobs

```json
"suggestions": {
  "enabled": true,
  "max": 3,
  "suppressOnClose": true,
  "closedAllowCommitChip": "auto",
  "priorCtr": 0.15,
  "telegramMode": "keyboard"
}
```

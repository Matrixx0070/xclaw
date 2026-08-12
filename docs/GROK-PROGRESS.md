# GROK-PROGRESS

## 2026-08-12 — Spawn-time plan enforcement

STATUS: green

### BUILT
- `src/security/spawn-enforce.mjs` — assertPlanAtSpawn + buildEnforcedBashSpawn (-c not -lc)
- `bash-tool.mjs` — refuses command mutation when systemRunPlan present; non-login spawn
- Agent loop attaches `auth.plan` as `args.systemRunPlan` before computer.callTool
- Tests: test/spawn-enforce.test.mjs 6/6

### LIMITS
Still not a kernel sandbox: free-form bash can still do anything *inside* the frozen string.
Binding = that string is exactly what was approved.

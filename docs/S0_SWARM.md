# S0 — Swarm foundations

- Durable snapshots: `~/.xclaw/swarms/agents/<id>.json`
- SwarmRun records: `~/.xclaw/swarms/runs/<id>.json`
- `spawnSubagent` timeout (default 300s, `swarm.subagentTimeoutMs`)
- On gateway start: `configureSubagentPersistence` + stale `running` → `interrupted`
- Metrics: `xclaw_subagents_*`
- Doctor: swarm.agents / persisted / runs

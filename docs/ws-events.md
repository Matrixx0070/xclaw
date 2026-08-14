# WS event vocabulary (`/ws/events`)

Envelope (ws-hub): `{ type: "event", channel, data, at }` after subscribing
with `{ type: "subscribe", channels: [...] }`. Channel names and phase
vocabularies are frozen in `src/gateway/event-types.mjs`.

## Channels and producers

| Channel | Producer | Payload |
|---|---|---|
| `mission` | `routes/missions.mjs` forwards every engine + agent-loop event | `{missionId, phase, …}` engine transitions plus tunneled agent events (`type: tool\|tokens\|security\|model\|…`) |
| `swarm` | `teeSwarmEvents` in `runSwarmFanOut` (B5 — covers HTTP, mission and agent-tool entry paths) | `{swarmId, type:"swarm", phase: swarm_start\|wave_start\|child_start\|child_retry\|child_done\|child_skip\|swarm_done\|swarm_aborted, nodeId?, role?, ok?, attempt?}` plus tunneled node agent events |
| `security` | gateway approval lifecycle | `{phase: approval_required\|approved\|denied\|…, name, riskTier?, riskFactors?}` (risk fields since A2) |
| `ops` | alerts route | alert deliveries |
| `admission`/`queue`/`eviction` | utils/admission, jobs/queue, gateway eviction | operational counters |

## Cost ticker

Agent loops emit `{type: "tokens", turn, costUsd?, totalTokens, modelRef?, …}`
per turn (usage-tracker entries). The Control UI live canvas sums `costUsd`
into the ticker; per-turn `modelRef` also shows economy downshifts (B3).

## Live canvas (Control UI → Swarm view)

`ui/control/canvas.js` renders the run's task graph as an SVG DAG
(columns = topological waves), patches node status from `swarm` events
without refetching, and buffers the last 200 events per node — click a node
for its live tail. List views still refresh on run-level transitions only.

Non-goal (v1): per-node token-delta streaming — final text + tool trace is
the honest tail.

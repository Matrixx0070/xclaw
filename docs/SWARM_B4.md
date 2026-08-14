# Swarm Communication, Dynamic Roles & Tournaments

## Blackboard — the one inter-agent channel

Per-run append-only `~/.xclaw/swarms/runs/<id>/blackboard.jsonl` (survives
resume with the run dir). Agents use the `xclaw_blackboard` tool
(`post`/`read`, kinds finding|decision|question|artifact, entries ≤2KB); a
1.5K tail digest is injected into every node's prompt so siblings see recent
findings without tool calls. Entries are labeled untrusted hints. Deliberately
NOT a message bus / sibling RPC / pub-sub. Disable: `swarm.blackboard: false`.

## Dynamic roles — labels, not physics

Task-graph nodes accept `rolePrompt` (≤2K, replaces the role prompt prefix)
and `tools` (name patterns). Unknown role names default to research physics
(no worktree, no motor); `tools` is INTERSECTED with the parent allowlist —
custom roles can only narrow, never widen; motor/browser stays enum-gated to
`actor` via fabric role binding. The fixed six roles remain as presets.

## voteNodes — converge on demand

`input.voteNodes: [ids]` ballots exactly those nodes (any role) via the
existing structured majority vote; the graph patterns (competing nodes +
judge, researchers → synthesizer) are documented in the mission plan prompt.

## Tournament ("simulation" as composition — no simulator)

`POST /missions {strategy: "tournament"}` (or `missions.strategy`): N
(`missions.tournament.n`, default 2, cap 4) independent implement competitors
run in parallel worktrees with `earlyMerge: false` (compete-hold), each
candidate is verified DETERMINISTICALLY by the mission's verify commands
inside its own worktree, the passing candidate merges into the mission
worktree (a critic agent tie-breaks only when several pass; unparseable or
failing critic falls back to first-passing, visibly), losers are discarded.
The mission's own verify/evidence gate still runs afterward. Governor economy
or halt mode clamps tournaments to solo. Verdicts persist on
`mission.swarm.tournament` and in the operational ledger.

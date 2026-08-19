# Swarm eval scoring (without hardBlockRate ceiling breach)

## Metric

For a swarm parent receipt `S`:

- `completionRate = passedChildren / childCount`
- `hardBlockRate = S.hardBlocks / max(1, childCount)`
- **Pass** iff `completionRate >= threshold` AND `hardBlockRate <= 0.25`

## Implementation entry

- `src/jobs/swarm-receipt.mjs` — aggregate
- `src/eval/autonomy-offline-gate.mjs` — ceiling shared with single-agent
- Future: `src/eval/swarm-eval.mjs` scores live/mock campaigns

## Guardrails

- Same A4 ceiling as single-agent autonomy (`maxHardBlockRate` default 0.25)
- Cost circuit on any child trips parent summary `anyCircuit`

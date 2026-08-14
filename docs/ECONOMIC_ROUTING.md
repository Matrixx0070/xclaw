# Economic Model Routing

The governor now has three bands instead of two: **normal → economy → halt**.
Between the soft cap (or `cost.economyAtUsd`) and the hard cap, the role
router reroutes to cheaper models instead of only warning; the hard cap keeps
its pause semantics.

## Declared metadata

`getModelMeta(cfg, ref)` (providers/registry.mjs): explicit `cfg.models.meta`
→ `cfg.tokens.rates` cost table → derived defaults from registry tags/name.
Prices live in config, not code. `estimateUsdFromUsage` now routes through it
(one lookup path, and downshifted turns price by their actual `modelRef`).

## Measured stats

`getModelStats(cfg)` (providers/model-stats.mjs) aggregates the cost ledger
(now recording per-turn `elapsedMs` + `modelRef`) and `router-events.jsonl`
(failover-router events teed at emit) into per-model
`{runs, failovers, errors, successRate, avgMsPerTurn, observedUsd}`.
No bandits, no learned weights — facts plus one sort.

## Configuration

```json
{
  "router": {
    "economyRoles": { "act": "anthropic/claude-haiku-4-5" },
    "autoEconomy": false,        // derive cheapest capable candidate instead
    "economyMinTier": 2,          // autoEconomy floor
    "economyRefreshMs": 60000
  },
  "cost": { "economyAtUsd": 5 }   // default = dailySoftUsd
}
```

- An economy config alone engages the role router (no draft/verify needed).
- The governor mode is seeded at router construction and refreshed in the
  background — short runs downshift correctly.
- **`verify` never auto-downshifts**; only an explicit `economyRoles.verify`
  touches the correctness gate.
- `autoEconomy` requires ≥5 measured runs before trusting a success rate;
  candidates below 0.8 are excluded.
- Events: `economy_downshift` / `economy_recover` / `economy_skip` on the
  router event stream.

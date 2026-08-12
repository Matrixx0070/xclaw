# XClaw LTS policy (Phase S)

**2.5.x** is an LTS-style freeze window:

1. **Bug fixes and security** only by default  
2. **No new phases** without green soak regression (`SOAK_MIN_NIGHTS≥3`, scoreboard gate)  
3. Features require explicit un-freeze note in CHANGELOG  

## Regression before release
```bash
npm test
npm run sandbox-redteam
npm run fire-drill
REQUIRE_SOAK=1 npm run evidence
```

## Support window
Prefer patch bumps `2.5.1`… for hotfixes. Major features → `2.6+` after soak proof.


## Automated gate (Phase 5)

```bash
npm run release-gate:quick   # tests + security-audit
npm run release-gate         # + sandbox-redteam + fire-drill
npm run release-gate:strict  # + REQUIRE_SOAK evidence
```

Artifact: `eval/baselines/release-gate-latest.json`

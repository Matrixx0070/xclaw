# Phase N — Evidence in production

## Multi-night soak
```bash
export XAI_API_KEY=...
SOAK_TAGS=smoke npm run soak:nights
# or lab seed without API:
SEED_ONLY=1 npm run soak:nights
xclaw soak
```

## Skill A/B on real cases
```bash
xclaw skill-ab --id skill-ab-trap
xclaw skill-ab --tag skill-ab --limit 5
```

## 2.0 evidence
```bash
REQUIRE_SOAK=1 npm run evidence
# eval/baselines/evidence-v2.0.0.json
```

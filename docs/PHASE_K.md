# Phase K — Prove it

## Campaign v2
```bash
xclaw eval --tag campaign-v2
xclaw eval --tag campaign
npm run eval:campaign
```

## Soak (repeat nightly ≥3 nights)
```bash
export XAI_API_KEY=...
SOAK_TAGS=smoke,campaign npm run soak
xclaw soak
```

## Evidence bundle
```bash
npm run evidence
# eval/baselines/evidence-v1.7.0.json
```

Release only if scoreboard gate + soak flake budget OK.

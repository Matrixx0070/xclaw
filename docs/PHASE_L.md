# Phase L — Learning that sticks

## Skill A/B
```bash
xclaw skill-ab --id hard-fix-sum
xclaw skill-ab --tag recovery --limit 5
npm run skill-ab -- --tag campaign-v2 --limit 3
xclaw skill-loop   # metrics history
```

## Structured claims
Tags `campaign`, `long`, `campaign-v2` request structured JSON claims by default.
Prod profile: `jobs.groundHard` + `claimsRequireEvidence`.

```json
{"claims":["fixed divide"],"evidence_ids":["bash"]}
```

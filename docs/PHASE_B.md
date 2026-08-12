# Phase B — Autonomy depth

## Hard pack

```bash
xclaw eval --tag hard
xclaw eval --id hard-fix-sum
```

## Grounding

Jobs/cases may set `groundHard: true`. Unverified "I created/wrote/…" claims fail the job.

```bash
xclaw eval --id hard-ground-no-invent
```

## Truncation

Config `tokens.truncate.perTool`:

```json
{
  "bash": { "maxChars": 6000 },
  "file_read": { "maxChars": 8000 }
}
```

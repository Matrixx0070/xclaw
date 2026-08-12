# Phase A — Stability

## Computer

```bash
xclaw computer start --bg
xclaw computer status
xclaw computer status --json
xclaw computer log 100
xclaw computer restart
xclaw computer stop
```

Files:
- `~/.xclaw/computer.pid`
- `~/.xclaw/computer.meta.json`
- `~/.xclaw/logs/computer.log`

## Eval CI

```bash
# mock (no key)
npm run eval:ci

# live smoke + baseline
export XAI_API_KEY=...
npm run eval:ci

EVAL_TAG=autonomy npm run eval:ci
EVAL_FAIL_REGRESS=0 npm run eval:ci   # report only
```

Full suite + trend:
```bash
npm run eval:suite
# writes eval/baselines/main.json + trend.jsonl
```

## Golden path

```bash
npm run dev-up
xclaw computer status
xclaw info
npm run eval:ci
```

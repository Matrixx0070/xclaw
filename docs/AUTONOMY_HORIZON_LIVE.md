# Live G10–G12 gate (API key optional)

## Goal

Run G10–G12 with a real provider when `XCLAW_API_KEY` / `XAI_API_KEY` is set; otherwise offline synthetic only.

## Design

- `xclaw eval autonomy --horizon g10,g11,g12 --live`
- Fail closed on live if key missing and `--require-live`
- Offline always available for CI

## Local today

- Offline G10/G11/G13 cases + synthetic G10 grader

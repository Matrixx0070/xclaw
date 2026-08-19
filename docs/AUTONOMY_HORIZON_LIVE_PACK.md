# Horizon pack v2 — live gates G10–G20

## Goal

Run the full long-horizon pack against a real provider when API key is set.

## Design

- `xclaw eval horizon --live --all` (G10–G20)
- Offline synthetics remain default for CI
- Fail-closed timeouts + cost caps on live

## Local today

- Offline G10–G20 cases + optional include flags; default suite remains G10–G14 (5 cases)

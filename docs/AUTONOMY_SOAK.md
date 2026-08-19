# Multi-trial soak for long-horizon cases

## Goal

Run each long-horizon autonomy case N times; fail on flake rate > budget.

## Design

- `xclaw eval autonomy --soak --trials 5 --horizon long`
- Aggregate completion, recovery, cost, canary fail rate

## Local today

- Live loop wires: costGov, high-risk receipt, canary

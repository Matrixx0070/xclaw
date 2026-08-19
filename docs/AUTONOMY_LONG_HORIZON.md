# Long-horizon multi-step eval suite

## Goal

Score multi-hour / multi-session autonomy, not only single-task A4 cases.

## Design

- Tasks: plan → tool chain → verify → recover from injected faults
- Metrics: completion, tool-first, recovery rate, cost/token, hallucination canary
- Modes: offline (synthetic), live (API), soak (N trials)
- Gate: `xclaw eval autonomy --horizon long --offline`

## Local today

- Unified `runAutonomyHarness` offline
- Loop guard + high-risk receipt + cost governor + canary

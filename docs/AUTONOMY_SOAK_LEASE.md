# Multi-node soak lease (Redis)

## Goal

Only one node resumes a soak job at a time.

## Design

- Redis key: `xclaw:soak:lease:{jobId}` SET NX PX 30000
- Heartbeat renew while running
- Fail-closed if lease held elsewhere

## Local today

- Durable local checkpoints under `.xclaw/soak/{jobId}/`

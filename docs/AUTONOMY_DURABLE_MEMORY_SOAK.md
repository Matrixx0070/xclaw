# Durable memory across soak resumes

## Goal

Resume multi-hour soak with checkpointed workspace + token ledger.

## Design

- Checkpoint dir: `.xclaw/soak/{jobId}/`
- Persist: turns, usedUsd, last tool receipt, open goals
- Resume: load checkpoint before next live turn; respect soak caps

## Local today

- Soak policy env caps + dry-run + cron template

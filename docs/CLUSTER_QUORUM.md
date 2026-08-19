# Quorum / witness for split-brain

## Goal

Prevent two coordinators accepting reserves after network partition.

## Design

1. **Witness** node holds last-writer lease generation number
2. Primary must fence with `generation++` on acquire
3. Followers reject responses with stale generation
4. On partition: minority side fails closed (no reserve)

## Local today

- Single coordinator URL + cluster auth
- Follower `COORDINATOR_UNREACHABLE` fail-closed
- File/Redis lease as primary election signal

# Fencing token on compact lease

## Goal

A paused holder must not compact after losing the lease.

## Design

- Each acquire returns `fence` (monotonic)
- Compact writes include fence
- Reject compact if fence < current

## Local today

- Redis SET NX PX + file lease

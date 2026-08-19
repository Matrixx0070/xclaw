# G18 OAuth token refresh mid-run

## Goal

Agent continues after access-token expiry via refresh rotation.

## Design

- Fixture: expired access + valid refresh
- Expect success artifact + no hard auth fail
- Tags: autonomy, horizon, g18, oauth

## Local today

- G17 overnight soak offline (optional in suite)

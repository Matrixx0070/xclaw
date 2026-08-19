# Scorecard Slack/webhook notify

## Goal

POST scorecard JSON when ok=false.

## Design

- Env: `XCLAW_SCORECARD_WEBHOOK`
- Payload: `{ok, missing, hmacFail, at}`
- No secrets in body

## Local today

- Nightly wrapper + evidence file + cron

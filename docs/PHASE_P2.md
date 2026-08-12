# Phase P2 complete (v2.9.0)

| Item | Status |
|------|--------|
| P2.1 Slack | Poll `conversations.history`; file downloads; thread replies |
| P2.2 Email | Pure Node IMAP UNSEEN + SMTP AUTH LOGIN reply |
| P2.3 Discord | Attachments → discord-media/; attach-only messages |
| P2.4 pptx templates | Curated pack under skills/bundled/pptx/templates |
| P2.5 Office helpers | docx/xlsx office py helpers already in bundle |

## Config

### Slack
```json
{
  "channels": {
    "slack": {
      "enabled": true,
      "botToken": "xoxb-...",
      "channelIds": ["C01234567"],
      "pollIntervalMs": 4000
    }
  }
}
```
Env: `SLACK_BOT_TOKEN`

### Email
```json
{
  "channels": {
    "email": {
      "enabled": true,
      "allowFrom": ["you@company.com"],
      "imap": { "host": "imap.example.com", "user": "...", "pass": "..." },
      "smtp": { "host": "smtp.example.com", "user": "...", "pass": "...", "from": "bot@example.com" }
    }
  }
}
```
Env: `EMAIL_IMAP_*`, `EMAIL_SMTP_*`, `EMAIL_FROM`

Full detail: [PHASES_P0_P4.md](./PHASES_P0_P4.md)

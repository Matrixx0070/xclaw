# Telegram P0 — webhook + inline approvals

## Webhook

```json
"channels": {
  "telegram": {
    "enabled": true,
    "token": "…",
    "transport": "webhook",
    "webhookUrl": "https://your.domain/channel/telegram/webhook",
    "webhookSecret": "long-random-secret",
    "ownerChatId": "123456789",
    "singleWriter": true
  }
}
```

Env: `XCLAW_TELEGRAM_WEBHOOK_URL`, `XCLAW_TELEGRAM_WEBHOOK_SECRET`, `XCLAW_TELEGRAM_OWNER_CHAT_ID`

Gateway route: `POST /channel/telegram/webhook`  
Header: `X-Telegram-Bot-Api-Secret-Token: <webhookSecret>`

On start with `transport=webhook`, XClaw calls `setWebhook` and does **not** long-poll.

## Single-writer

`~/.xclaw/locks/telegram-writer.lock` — only one process consumes updates (poll or webhook owner).

## Inline approvals

| Button | callback_data |
|--------|----------------|
| Pairing Approve/Deny | `xclaw:pair:approve:CODE` / `xclaw:pair:deny:CODE` |
| Tool Allow/Deny | `xclaw:apr:ok:PENDING_ID` / `xclaw:apr:no:PENDING_ID` |

Owner-only when `ownerChatId` is set. Pairing requests notify the owner with buttons. Tool approvals: call `channelManager.get("telegram").notifyOwnerApproval(item)` when a pending gate item is created (or use `/pending` + buttons from a future poller).

## Poll still default

`transport: "poll"` (default) clears webhook and uses `getUpdates`.

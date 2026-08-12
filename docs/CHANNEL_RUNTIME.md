# Multi-channel runtime (CL)

Shared inbound path used for tests and (optionally) channel adapters.

## Flow

```text
platform event
  → fromTelegramUpdate / fromSlackMessage / fromDiscordMessage / fromEmailMessage / fromWebChatMessage
  → normalizeInbound  (identity = channel:nativeId)
  → processInbound
       → /commands
       → rate limit
       → replyWithAgent({ userId, channel, chatId })
```

## Module

`src/channels/runtime.mjs`

Channel transport modules (poll, Socket Mode, IMAP) remain responsible for I/O;
`processInbound` owns the agent/command path so all channels share behavior.


## R2 — Live wiring

Transport modules (poll, Socket Mode, IMAP) still own I/O.
After policy/pairing/media download, they call:

```js
processInbound(inbound, { cfg, workingDir, rateLimiter, onEvent })
```

So command handling, rate limits, userId → vault, and agent loop share one path with tests.

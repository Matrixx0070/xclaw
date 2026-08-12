# Telegram P0 + P1

## P0 — Webhook + single-writer + inline approvals
See TELEGRAM_P0.md.

**Tool approval notify:** when the agent emits `security.approval_required`, Telegram notifies `ownerChatId` with Allow/Deny buttons.

## P1 — Partial text streaming

When `channels.telegram.stream.partialText` is true (default):

1. Agent loop uses provider **SSE** `chatStream` (`stream: true` on `/chat/completions`)
2. Each content delta → `model.delta` event
3. Streamer `setPartial(accumulated)` throttles `editMessageText`

Disable: `"stream": { "partialText": false }` or full `"stream": false`.

## P1 — Metrics (`GET /metrics`)

| Series | Labels |
|--------|--------|
| `xclaw_telegram_updates_total` | `kind=message\|callback_query` |
| `xclaw_telegram_edits_total` | `result=ok\|noop\|err` |
| `xclaw_telegram_denies_total` | `reason` |
| `xclaw_telegram_errors_total` | `phase` |
| `xclaw_telegram_callbacks_total` | `action` |
| `xclaw_telegram_stream_deltas_total` | — |

```bash
curl -fsS http://127.0.0.1:18790/metrics | grep xclaw_telegram
```

## P2 — Voice-note replies

```json
"voiceOut": {
  "enabled": true,
  "mode": "on_request",
  "maxChars": 400,
  "caption": true
}
```

- `on_request`: send voice when user uses `/voice` or sends a voice note
- `always`: voice note after every reply
- TTS: local `piper` / `espeak-ng` (`localSpeak`); ffmpeg converts to OGG when available

## P2 — Group / topic policy

```json
"groups": {
  "policy": "mention",
  "requireMention": true,
  "allowedGroupIds": null,
  "topics": {
    "12": { "requireMention": true, "allowFrom": ["111"] }
  }
}
```

| policy | Behavior |
|--------|----------|
| `mention` | Bot must be @mentioned or reply-to-bot |
| `allowlist` | Only listed group ids (+ mention rules) |
| `open` | All groups (topic can still require mention) |

Mention text is stripped before the agent sees the message.

## P3 — Structured inbound

Handled without requiring text/caption:

| Type | Agent sees |
|------|------------|
| **sticker** | `[Sticker 🚀] set=…` + file download + JSON meta |
| **location** | `lat/lon` (+ live period) |
| **venue** | title, address, coords |
| **contact** | name + phone |
| **poll** | question + options |
| **animation** | GIF metadata + file |
| **video_note** | circular video + file |
| **dice** | emoji + value |

Structured JSON is appended as `telegramStructured` for the agent; binary stickers/GIFs/video notes save under `telegram-media/`.

## P4 — Outbound structured media

Agent replies can embed:

````text
Here is the meeting point:

```telegram
{"type":"location","latitude":24.8607,"longitude":67.0011}
```
````

Fences are stripped from the text message; structured items are sent via Bot API.

| `type` | API method | Required fields |
|--------|------------|-----------------|
| `location` | `sendLocation` | latitude, longitude |
| `venue` | `sendVenue` | lat/lon, title, address |
| `contact` | `sendContact` | phone, first_name |
| `poll` | `sendPoll` | question, options (≥2) |
| `dice` | `sendDice` | optional emoji |
| `sticker` | `sendSticker` | file_id |
| `animation` / `photo` / `document` | corresponding send* | file_id |

Also accepts ````tg` fence and JSON arrays of payloads.
Metric: `xclaw_telegram_structured_out_total`.

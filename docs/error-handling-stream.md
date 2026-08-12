# Stream / resume error handling details

## Layers

| Layer | Module | Responsibility |
|-------|--------|----------------|
| Config | `src/config/validate.mjs` | Validate `stream.*` before runtime |
| Gateway | `stream-resume.mjs` + `index.mjs` | `stream_not_found`, buffer modes |
| Client | `stream-resume-client.mjs` | `ResumeError`, retryable vs fatal |
| CLI | `stream-run.mjs` | Exit codes, hints, `--json-error` |
| Telemetry | `stream-telemetry.mjs` | Counters + structured logs |

---

## Config errors (`validateConfig`)

Return shape:

```js
{
  ok: false,
  errors: ["stream.capacity: must be an integer 1–100000"],
  warnings: ["stream.ttlMs is 500ms (<1s) — …"],
  details: [
    {
      path: "stream.capacity",
      code: "STREAM_CAPACITY_RANGE",
      message: "must be an integer 1–100000",
      got: -1,
      hint: "Ring buffer size per streamId. Example: 500"
    }
  ]
}
```

| `details[].code` | Path | Meaning |
|------------------|------|---------|
| `STREAM_CAPACITY_RANGE` | `stream.capacity` | Not in 1…100000 |
| `STREAM_TTL_INVALID` | `stream.ttlMs` | Negative / non-numeric |
| `STREAM_HEARTBEAT_INVALID` | `stream.heartbeatMs` | Negative / non-numeric |
| `STREAM_BASE_MS_INVALID` | `stream.baseMs` | Invalid base |
| `STREAM_MAX_MS_INVALID` | `stream.maxMs` | Invalid max |
| `STREAM_BACKOFF_RANGE` | `stream.maxMs` | maxMs < baseMs |
| `STREAM_MAX_RESUME_CYCLES_INVALID` | `stream.maxResumeCycles` | Negative |

**Warnings (non-fatal):** very low `ttlMs`, very low `heartbeatMs`, huge `capacity`, unknown `backoff` name (normalized to `full`).

Load path (`loadConfig`): prints errors + hints; `opts.strict` throws with `err.details`.

Doctor: one `config.validate` error plus per-path `config.detail.*` rows.

---

## Runtime resume errors (`ResumeError`)

| Code | Retryable | CLI exit | Detail |
|------|-----------|----------|--------|
| `STREAM_NOT_FOUND` | no | 2 | Unknown `streamId` / GC’d log |
| `STREAM_EXPIRED` | no | 2 | Same family as not found |
| `AUTH` | no | 3 | HTTP 401 |
| `FORBIDDEN` | no | 4 | HTTP 403 |
| `BAD_REQUEST` | no | 5 | Missing message/goal / bad body |
| `MAX_RESUME_CYCLES` | no | 6 | Outer resume budget spent |
| `NETWORK` | yes | 7 | Transport failure |
| `HEARTBEAT_TIMEOUT` | yes | 7 | Silence past timeout |
| `SERVER` | yes | 7 | HTTP 5xx / transient |
| `ABORTED` | no | 130 | Signal / user interrupt |
| `UNKNOWN` | yes* | 1 | Unclassified |

`* UNKNOWN` is treated as retryable by default at the client; CLI still exits `1` if it surfaces as final failure without a more specific code.

### Payload (`--json-error`)

```json
{
  "ok": false,
  "error": true,
  "code": "STREAM_NOT_FOUND",
  "message": "Unknown streamId: agent_x",
  "retryable": false,
  "streamId": "agent_x",
  "lastEventId": "agent_x:3",
  "kind": "agent",
  "exitCode": 2,
  "hints": [
    "Stream buffer expired or gateway restarted — start a new run (omit --resume).",
    "TTL for finished streams is ~5 minutes; live runs are kept until markEnded."
  ]
}
```

---

## Gateway stream error events

NDJSON/SSE `event: error` bodies may include:

| Field | Meaning |
|-------|---------|
| `code` | e.g. `stream_not_found`, `message_required` |
| `error` | Human message |
| `streamId` | Requested id |
| `lastEventId` | Client cursor if any |
| `kind` | `agent` \| `swarm` \| `webchat` |
| `ok` | `false` |

Client maps these via `resumeErrorFromEvent()` → `ResumeError`.

---

## Handling checklist

1. **Config invalid at start** → fix `xclaw.json` / env; run `xclaw doctor`  
2. **Exit 2** → drop `--resume`, new run  
3. **Exit 7** → backoff + same `--resume` / `--last-event-id`  
4. **Exit 3/4** → gateway token / ACL  
5. **Exit 6** → raise `stream.maxResumeCycles` or wait  

See also: `docs/cli-run-exit-codes.md`, `docs/stream-config.md`, `docs/backoff-strategies.md`.

---

## Telegram progressive reply errors

Module: `src/channels/telegram/stream.mjs`  
Channel: `src/channels/telegram/index.mjs`

### Flow

```text
placeholder sendMessage("…")
  → onEvent tools / Thinking…  (throttled editMessageText)
  → finish(final text)         (force edit)
  → on failure: finish("Error: …") or sendMessage("Error: …")
```

### Example: handle edit failures and agent errors

```js
import {
  createTelegramStreamer,
  telegramStreamOptions,
} from "../src/channels/telegram/stream.mjs";

async function replyTelegramStreaming({ api, chatId, replyTo, runAgent }) {
  const conf = { stream: { enabled: true, minEditIntervalMs: 1200 } };
  const opts = telegramStreamOptions(conf);
  const streamer = opts.enabled
    ? createTelegramStreamer({
        api,
        chatId,
        replyToMessageId: replyTo,
        minEditIntervalMs: opts.minEditIntervalMs,
      })
    : null;

  try {
    if (streamer) await streamer.sendPlaceholder();

    const result = await runAgent({
      onEvent: (e) => {
        if (e.type === "tool" && e.phase === "start" && streamer) {
          streamer.onToolStart(e.name).catch((err) => {
            // Non-fatal: status edit failed; agent keeps running
            console.warn("[telegram] tool status edit failed:", err.message);
          });
        }
      },
    });

    if (streamer) {
      await streamer.finish(result.text || "(no response)");
    } else {
      await api("sendMessage", {
        chat_id: chatId,
        text: result.text || "(no response)",
        reply_to_message_id: replyTo,
      });
    }
  } catch (err) {
    const message = `Error: ${err.message || err}`;
    try {
      if (streamer) {
        // Prefer editing the placeholder so the chat stays tidy
        await streamer.finish(message);
      } else {
        await api("sendMessage", {
          chat_id: chatId,
          text: message,
          reply_to_message_id: replyTo,
        });
      }
    } catch (sendErr) {
      // Transport fully broken — log only; avoid throwing over the poll loop
      console.error("[telegram] failed to report error to chat:", sendErr.message);
    }
  } finally {
    streamer?.close?.();
  }
}
```

### Cases the streamer already absorbs

| Situation | Behavior |
|-----------|----------|
| `editMessageText` “message is not modified” | Ignore |
| Message too old / can’t edit | New `sendMessage` with same body |
| Rapid tool events | Coalesced by `minEditIntervalMs` |
| Placeholder `sendMessage` fails | Log warning; continue without stream id (finish may send new msg) |
| Agent throws | `finish("Error: …")` or plain `sendMessage` |

### Config off-switch

```json
"channels": {
  "telegram": {
    "stream": false
  }
}
```

Falls back to a single final `sendMessage` (no intermediate edits).

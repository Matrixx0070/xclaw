# Channel disconnect + SQLite backup / restore

XClaw channels are Telegram, Slack, Discord, email, and WebChat. There is no WeChat QR login and no Feishu connector. Session keep-alive is per-channel (poll, webhook, or WebSocket) — not a desktop QR session.

Pairing and route maps live on disk under `~/.xclaw`. Durable SQL is `node:sqlite` (WAL). Stop the gateway before copying database files.

Related: [TELEGRAM_P0.md](./TELEGRAM_P0.md) · [SLACK_SOCKET_MODE.md](./SLACK_SOCKET_MODE.md) · [CHANNEL_RUNTIME.md](./CHANNEL_RUNTIME.md) · [SECRETS.md](./SECRETS.md)

## Files that matter

| Path | What it holds |
|------|----------------|
| `~/.xclaw/xclaw.json` | Config (prefer env for secrets) |
| `~/.xclaw/sessions.json` | Session / binding route map |
| `~/.xclaw/pairing.json` | Live pairing store (Telegram / Discord still read this) |
| `~/.xclaw/state/control.sqlite` | Control plane (pairing tables, delivery queue, session heads) |
| `~/.xclaw/memory/main.sqlite` | Memory search index (FTS5; sqlite-vec is **not** loaded here) |
| `~/.xclaw/agents/<id>/agent.sqlite` | Per-agent store (created on first get, not at gateway start) |
| `~/.xclaw/locks/telegram-writer.lock` | Single-writer lock for Telegram poll / webhook owner |

Each `.sqlite` may have `-wal` and `-shm` sidecars. Copy **all three** or use `sqlite3 .backup`. A lock (gateway holds the file) is busy, not corruption.

## Stop / start before touching SQL

```bash
# Confirm the process, then stop it. Do not copy WAL databases while the gateway is open.
node bin/xclaw.mjs status --json
# SIGTERM the gateway process you started (or: xclaw stop-all for computer + sessions)
```

After restore:

```bash
node bin/xclaw.mjs doctor          # sql.control / sql.memory probes; exit 0=ok · 1=warnings · 2=errors
node bin/xclaw.mjs gateway
```

Doctor reports a busy file as a warning when the gateway still holds it. Corruption copies the file plus `-wal`/`-shm` to `*.corrupt.<stamp>` and refuses the open — it does not delete the original.

---

## Telegram

Tokens: `TELEGRAM_BOT_TOKEN` or `XCLAW_TELEGRAM_TOKEN` (or `channels.telegram.token`).

| Symptom | Cause | Recovery |
|---------|--------|----------|
| `409 Conflict` on `getUpdates` | Two pollers, or a leftover webhook | One writer only. Stop the extra process. Default transport is **poll**: start calls `deleteWebhook` then `getUpdates`. If you want webhook, set `transport: "webhook"` + `webhookUrl` / `XCLAW_TELEGRAM_WEBHOOK_URL` so start calls `setWebhook` and does **not** long-poll. |
| `running: false` with no crash | Another process holds `~/.xclaw/locks/telegram-writer.lock` | By design (standby). Do not restart-loop. Stop the owner, or leave this instance as standby. |
| Bot does not answer DMs | `dmPolicy` is `pairing` / `allowlist`; prod forbids `open` | Pair via the pairing reply, or set `allowFrom` / owner chat. Prod forces `open` → `allowlist` (if allowFrom set) or `pairing`. |
| Token rejected / `getMe` fails | Bad or revoked token | Rotate at [@BotFather](https://t.me/BotFather). `getMe` is retried 4× on start. Put the new token in env, not git. |
| Webhook 401 / ignored updates | Secret header mismatch | Header `X-Telegram-Bot-Api-Secret-Token` must match `webhookSecret` / `XCLAW_TELEGRAM_WEBHOOK_SECRET`. |

Webhook config sketch: [TELEGRAM_P0.md](./TELEGRAM_P0.md). Poll remains the default.

Re-auth: there is no QR login. Rotate the bot token, update env, restart the gateway. Pairing codes are in `pairing.json` / control-plane `pair_*` tables — restoring those files restores pending/done pairs.

---

## Slack

Tokens: `SLACK_BOT_TOKEN` / `XCLAW_SLACK_TOKEN`, and for Socket Mode `SLACK_APP_TOKEN` / `XCLAW_SLACK_APP_TOKEN`.

| Mode | Keep-alive | Recovery |
|------|------------|----------|
| **socket** (preferred) | App token + WebSocket. If **no frame** for `heartbeatMs` (default **90000**, env `XCLAW_SLACK_HEARTBEAT_MS`), XClaw logs `heartbeat timeout`, closes, reconnects via `apps.connections.open` with jittered backoff. | Check `channelManager.status()` → slack `wsMetrics` (`reconnects`, `heartbeatTimeouts`, `idleMs`). Rotate bot/app tokens in the Slack app if REST 401. |
| **poll** | `conversations.history` on `channelIds` | Confirm `channelIds` and `channels:history` / `groups:history` scopes. |

`heartbeatMs: 0` disables the idle timer. Subscribe **message.channels** (or groups) and **app_mention**. Detail: [SLACK_SOCKET_MODE.md](./SLACK_SOCKET_MODE.md).

---

## Discord

Token: `DISCORD_BOT_TOKEN` or `XCLAW_DISCORD_TOKEN`. Message Content Intent must be on in the Developer Portal.

| Gateway event | Behavior |
|---------------|----------|
| opcode **7** (Reconnect) | Close the socket; reconnect. |
| opcode **9** (Invalid session) | Clear `sessionId`, re-identify after 2s. |
| WebSocket **close** | Reconnect after **5s** unless stopped. |

Re-auth: rotate the bot token, update env, restart. Pairing uses the same pairing store as Telegram. Discord `/ask` does not mint `persistRun` — named `chatId` already persists via `replyWithAgent`.

---

## Email

IMAP poll + SMTP send (pure Node). Env: `EMAIL_IMAP_HOST` / `PORT` / `USER` / `PASS`, `EMAIL_SMTP_HOST` / `PORT` / `USER` / `PASS`, `EMAIL_FROM`.

| Symptom | Recovery |
|---------|----------|
| Auth fail | Rotate mailbox password / app password; IMAP and SMTP user/pass are independent. |
| No inbound | Confirm `mailbox` (default `INBOX`), UNSEEN mail, and `allowFrom` if set. Default poll ≥ 5s (config default 30s). |
| TLS | IMAP default 993, SMTP default 465. Set `tls: false` only on a trusted internal relay. |

There is no OAuth session file for email — credentials are env / `xclaw.json`.

---

## WebChat

Local UI at `http://127.0.0.1:18790/chat/`. No third-party session. If the page is empty after a restore, check `sessions.json` and that the gateway token still matches `XCLAW_GATEWAY_TOKEN`.

---

## SQLite backup

Stop the gateway first. Then either copy the trio or use the SQLite backup API (safe even if you forgot to stop, but stop anyway).

```bash
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DEST="$HOME/xclaw-backup-$STAMP"
mkdir -p "$DEST"

# Copy file + WAL + SHM when present
copy_sql() {
  local src="$1" name="$2"
  if [ -f "$src" ]; then
    cp -a "$src" "$DEST/$name"
    [ -f "$src-wal" ] && cp -a "$src-wal" "$DEST/$name-wal"
    [ -f "$src-shm" ] && cp -a "$src-shm" "$DEST/$name-shm"
  fi
}

copy_sql "$HOME/.xclaw/state/control.sqlite" control.sqlite
copy_sql "$HOME/.xclaw/memory/main.sqlite" main.sqlite
for f in "$HOME"/.xclaw/agents/*/agent.sqlite; do
  [ -f "$f" ] || continue
  id=$(basename "$(dirname "$f")")
  mkdir -p "$DEST/agents/$id"
  copy_sql "$f" "agents/$id/agent.sqlite"
done

cp -a "$HOME/.xclaw/sessions.json" "$DEST/" 2>/dev/null || true
cp -a "$HOME/.xclaw/pairing.json" "$DEST/" 2>/dev/null || true
# Do not copy xclaw.json if it contains live tokens; prefer env.

# Alternative: checkpointed copy (requires sqlite3 CLI)
# sqlite3 "$HOME/.xclaw/state/control.sqlite" ".backup '$DEST/control.sqlite'"
```

sqlite-vec is **not** in these files. The default memory index never opens with `allowExtension`. A host-built extension is only loaded when `memory.vec === true` and `$XCLAW_SQLITE_VEC` (or `native/sqlite-vec`) points at a real library — that binary is not shipped.

## SQLite restore

1. Stop the gateway.
2. If doctor already quarantined a file, the original is still in place and a sibling `*.corrupt.<stamp>` holds the copy. Decide which to keep.
3. Restore the `.sqlite` **and** `-wal`/`-shm` from the same stamp. Mixing a new main file with an old WAL loses or corrupts the last transactions.
4. Restore `sessions.json` / `pairing.json` next to them.
5. `node bin/xclaw.mjs doctor` then start the gateway.

Peek rule: a file that is not `SQLite format 3\0` is refused before open so SQLite cannot unlink a hot WAL. Do not "fix" a mismatch by deleting `-wal` unless you accept losing uncheckpointed writes.

## What this runbook is not

- Not WeChat QR re-login.
- Not Feishu / Lark session recovery.
- Not Electron `.exe` / `.dmg` user-data repair.
- Not a Docker volume dump of an OpenClaw desktop profile.

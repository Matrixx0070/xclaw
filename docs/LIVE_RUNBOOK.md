# XClaw live runbook

Minimal path to run real goals with tools (lab profile).

## 1. Native computer (recommended)

**Default engine is native (thin).** lab/dev profiles and DEFAULT_CONFIG use native; **prod** profile still selects bundle. Soft-migrate upgrades older user configs that froze `engine:bundle` under lab.

```bash
export XCLAW_COMPUTER_ENGINE=native
export XCLAW_PROFILE=lab
export XAI_API_KEY=xai-...   # or OPENAI_ / ANTHROPIC_

# Start thin computer (bash/files/browser_tab/computer_act)
node src/computer/thin-server.mjs &
# health → engine thin-native, tools include xclaw_computer_act
curl -s http://127.0.0.1:4243/health
```

Prefer **native/thin** over the 16MB bundle for day-to-day agent work (cleaner tool schemas, `computer_act` maintained modules).

## 2. Optional CDP (GUI navigate/click/screenshot)

Chrome needs a writable profile dir (locks). Prefer `/dev/shm` if the workspace disallows `SingletonLock`:

```bash
mkdir -p /dev/shm/xclaw-chrome
google-chrome-stable --headless=new --no-sandbox --disable-gpu \
  --remote-debugging-port=9225 \
  --user-data-dir=/dev/shm/xclaw-chrome about:blank &

export XCLAW_CDP_URL=http://127.0.0.1:9225
curl -s "$XCLAW_CDP_URL/json/version"
```

Agent tools: `xclaw_computer_act` (`navigate` / `click` / `type` / `screenshot`) after tools-first + observe policy.

## 3. Run an agent goal

```bash
node bin/xclaw.mjs agent "Write /tmp/ok.txt with OK then read it back"
# or API:
# runAgent({ cfg, message: goal }) → { ok, text, finalText, toolTrace, stopReason }
```

`runAgentLoop` / `runAgent` return **`text`** and **`finalText`** (same string).

## 4. Doctor

```bash
node bin/xclaw.mjs doctor          # includes cua.* checks
node scripts/cua-doctor.mjs       # CDP + desktop only
```

## 5. Ladder smoke (what we verified)

| ID | Goal class | Tools |
|----|------------|-------|
| A1 | file write/read | file_* |
| A2 | multi-file + bash + report | bash + file_* |
| A3 | web research brief | web_search, web_fetch, file_* |
| A4 | CDP navigate | computer_act, browser_tab |

## 6. Fail-closed notes

- Desktop GUI act: off unless `XCLAW_DESKTOP_GUI=1`
- No CDP → `computer_act` actuation codes (`CUA_ACT_REQUIRES_BUNDLE` / CDP_*)
- Bash tool `timeout` is **seconds**, max 120 (not ms)

## Bash tool codes

See [BASH_CODES.md](./BASH_CODES.md) and [BASH_BACKGROUND.md](./BASH_BACKGROUND.md).

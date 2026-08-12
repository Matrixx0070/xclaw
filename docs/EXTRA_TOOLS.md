# Extra tools (UI parity)

XClaw agent loop includes tools matching common agent UIs:

| Tool | Purpose | Implementation |
|------|---------|----------------|
| `glob` | Find files by pattern | ripgrep `--files` + recursive walk |
| `grep` | Search file contents | ripgrep (fallback `grep -R`) |
| `web_fetch` | Fetch URL → text | `fetch`, HTML lightly stripped |
| `web_search` | Web search results | DuckDuckGo Instant Answer + HTML |

## Alongside computer tools

```
xclaw_bash, xclaw_file_read, xclaw_file_write, xclaw_file_edit,
xclaw_browser_tab, xclaw_browser_network_details,
glob, grep, web_fetch, web_search,
xclaw_spawn_subagent
```

These four run in the **gateway/agent process** (not the computer server).

## Security

Default `safeAuto` includes `glob`, `grep`, `web_fetch`, `web_search` so they do not require human approval under the `risky` policy.

# XClaw MCP wiring

XClaw already includes MCP client/server modules:

| Surface | Path |
|---------|------|
| Client | `src/mcp/client.mjs` |
| Server | `src/mcp/server.mjs` |
| Stdio | `src/mcp/stdio.mjs` |
| Gateway | `POST /mcp`, `GET /mcp/tools`, `POST /mcp/call` |
| Config | `cfg.mcp.servers` in `~/.xclaw/xclaw.json` |

```json
{
  "mcp": {
    "servers": [
      { "name": "example", "command": "npx", "args": ["-y", "some-mcp-server"] }
    ]
  }
}
```

Connected tools: `src/tools/connected-tools.mjs` can search MCP tools when configured.

Prefer configuring servers in config over inventing a parallel MCP stack.

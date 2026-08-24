# MCP Integration

The Swarm supports the **Model Context Protocol (MCP)** for connecting to external tool servers.

## What is MCP?

MCP is a protocol for LLM clients to discover and call tools from external servers. The Swarm's MCP Gateway connects to MCP servers and "promotes" their tools into the swarm's tool registry.

## Configuration

Add MCP servers to `xclaw-swarm.json`:

```json
{
  "swarm": {
    "plugins": {
      "mcpServers": [
        {
          "id": "filesystem",
          "name": "Filesystem MCP",
          "command": "npx",
          "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/docs"],
          "env": {},
          "alwaysExpose": true,
          "timeout": 30000
        },
        {
          "id": "github",
          "name": "GitHub MCP",
          "command": "npx",
          "args": ["-y", "@modelcontextprotocol/server-github"],
          "env": {
            "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
          },
          "alwaysExpose": ["search_code", "get_file_contents"]
        }
      ]
    }
  }
}
```

## Connection Pool

The `McpConnectionPool` manages persistent connections:

```javascript
import { McpConnectionPool } from "@xclaw/swarm";

const pool = new McpConnectionPool(10); // max 10 concurrent connections
const conn = await pool.acquire(serverConfig);
// ... use conn ...
pool.release(conn);
```

## Tool Promotion

Tools from MCP servers are promoted into the swarm registry:

```javascript
import { McpToolPromoter } from "@xclaw/swarm";

const promoter = new McpToolPromoter(registry);
await promoter.promote(mcpTool, "filesystem", sessionId);
```

Promoted tools behave like native swarm tools:
- Same schema format
- Same execute interface
- Same approval flow

## Eager vs Lazy Loading

- **Eager** (`alwaysExpose: true`): All tools available immediately
- **Lazy** (`alwaysExpose: false`): Tools fetched on first use
- **Selective** (`alwaysExpose: ["tool1", "tool2"]`): Only listed tools

## Security

- MCP servers run as subprocesses with stdio transport
- Environment variables are sanitized
- Tool execution respects the same approval policy as native tools
- MCP servers can be disconnected and reconnected without restarting the swarm

## Troubleshooting

```bash
# Check MCP connections
node bin/xclaw.mjs mcp status

# Reconnect a server
node bin/xclaw.mjs mcp reconnect filesystem

# List promoted tools
node bin/xclaw.mjs mcp list
```

## Writing an MCP Server for Swarm

Any MCP-compliant server works. To write one:

```javascript
// my-mcp-server.mjs
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new Server({
  name: "my-server",
  version: "1.0.0",
}, {
  capabilities: { tools: {} }
});

server.setRequestHandler("tools/list", async () => ({
  tools: [{
    name: "my_tool",
    description: "Does something",
    inputSchema: { type: "object", properties: { input: { type: "string" } } }
  }]
}));

server.setRequestHandler("tools/call", async (req) => {
  if (req.params.name === "my_tool") {
    return { content: [{ type: "text", text: "Result" }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

Then add to `xclaw-swarm.json`:

```json
{
  "id": "my-server",
  "command": "node",
  "args": ["my-mcp-server.mjs"]
}
```

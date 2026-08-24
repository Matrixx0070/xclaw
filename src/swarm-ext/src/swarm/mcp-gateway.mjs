/**
 * MCP Gateway — Model Context Protocol server integration
 * Connects to external MCP servers and promotes their tools into the swarm
 * Based on SwarmClaw's MCP integration pattern
 */
import { spawn } from "child_process";
import { getConfig } from "./config.mjs";

export class MCPGateway {
  constructor() {
    this.servers = new Map();
    this.connections = new Map();
    this.tools = new Map();
    this.config = getConfig().swarm.plugins;
  }

  async connect(serverConfig) {
    const { id, command, args = [], env = {} } = serverConfig;

    console.log(`[swarm-mcp] Connecting to ${id}: ${command} ${args.join(" ")}`);

    const proc = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const connection = {
      id,
      process: proc,
      tools: [],
      connected: false,
      messageId: 0,
      pending: new Map(),
    };

    // Handle stdout
    let buffer = "";
    proc.stdout.on("data", (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop(); // Keep incomplete line

      for (const line of lines) {
        if (line.trim()) {
          this._handleMessage(connection, line);
        }
      }
    });

    proc.stderr.on("data", (data) => {
      console.error(`[swarm-mcp] ${id} stderr:`, data.toString().trim());
    });

    proc.on("close", (code) => {
      console.log(`[swarm-mcp] ${id} exited with code ${code}`);
      connection.connected = false;
      this.connections.delete(id);
    });

    // Initialize
    await this._sendRequest(connection, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "xclaw-swarm", version: "0.1.0" },
    });

    // List tools
    const toolsResponse = await this._sendRequest(connection, "tools/list", {});
    connection.tools = toolsResponse.tools || [];
    connection.connected = true;

    this.connections.set(id, connection);

    // Register tools
    for (const tool of connection.tools) {
      this.tools.set(tool.name, { ...tool, serverId: id });
    }

    console.log(`[swarm-mcp] ${id} connected with ${connection.tools.length} tools`);
    return connection;
  }

  async _sendRequest(connection, method, params) {
    const id = ++connection.messageId;
    const message = { jsonrpc: "2.0", id, method, params };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        connection.pending.delete(id);
        reject(new Error(`MCP request timeout: ${method}`));
      }, 30000);

      connection.pending.set(id, (response) => {
        clearTimeout(timeout);
        if (response.error) {
          reject(new Error(response.error.message));
        } else {
          resolve(response.result);
        }
      });

      connection.process.stdin.write(JSON.stringify(message) + "\n");
    });
  }

  _handleMessage(connection, line) {
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined && connection.pending.has(msg.id)) {
        const handler = connection.pending.get(msg.id);
        connection.pending.delete(msg.id);
        handler(msg);
      }
    } catch (e) {
      console.warn("[swarm-mcp] Invalid JSON:", line.slice(0, 100));
    }
  }

  async callTool(serverId, toolName, params) {
    const connection = this.connections.get(serverId);
    if (!connection) throw new Error(`MCP server ${serverId} not connected`);

    const result = await this._sendRequest(connection, "tools/call", {
      name: toolName,
      arguments: params,
    });

    return result;
  }

  async disconnect(serverId) {
    const connection = this.connections.get(serverId);
    if (!connection) return;

    connection.process.kill();
    this.connections.delete(serverId);

    // Remove tools
    for (const [name, tool] of this.tools) {
      if (tool.serverId === serverId) {
        this.tools.delete(name);
      }
    }

    console.log(`[swarm-mcp] Disconnected ${serverId}`);
  }

  async connectAll() {
    const servers = this.config.mcpServers || [];
    const results = [];
    for (const server of servers) {
      try {
        const conn = await this.connect(server);
        results.push({ id: server.id, success: true, tools: conn.tools.length });
      } catch (e) {
        results.push({ id: server.id, success: false, error: e.message });
      }
    }
    return results;
  }

  getTools() {
    return Array.from(this.tools.values());
  }

  getTool(name) {
    return this.tools.get(name);
  }
}

export class McpConnectionPool {
  constructor(maxConnections = 10) {
    this.maxConnections = maxConnections;
    this.active = new Map();
    this.available = [];
  }

  async acquire(serverConfig) {
    // Check existing
    if (this.active.has(serverConfig.id)) {
      return this.active.get(serverConfig.id);
    }

    // Check available
    const existing = this.available.find(c => c.id === serverConfig.id);
    if (existing) {
      this.available = this.available.filter(c => c.id !== serverConfig.id);
      this.active.set(serverConfig.id, existing);
      return existing;
    }

    // Create new
    if (this.active.size >= this.maxConnections) {
      throw new Error("MCP connection pool exhausted");
    }

    const gateway = new MCPGateway();
    const conn = await gateway.connect(serverConfig);
    this.active.set(serverConfig.id, conn);
    return conn;
  }

  release(connection) {
    this.active.delete(connection.id);
    this.available.push(connection);

    // Trim available pool
    if (this.available.length > this.maxConnections) {
      const toClose = this.available.shift();
      toClose.process.kill();
    }
  }

  async closeAll() {
    for (const [, conn] of this.active) {
      conn.process.kill();
    }
    for (const conn of this.available) {
      conn.process.kill();
    }
    this.active.clear();
    this.available = [];
  }
}

export class McpToolPromoter {
  constructor(registry) {
    this.registry = registry;
    this.promoted = new Map();
  }

  async promote(mcpTool, serverId, sessionId) {
    const tool = {
      name: mcpTool.name,
      description: mcpTool.description || "",
      parameters: mcpTool.inputSchema || {},
      serverId,
      sessionId,
      promotedAt: new Date().toISOString(),
      async execute(params) {
        const gateway = new MCPGateway();
        return await gateway.callTool(serverId, mcpTool.name, params);
      },
      getSchema() {
        return {
          type: "function",
          function: {
            name: this.name,
            description: this.description,
            parameters: this.parameters,
          },
        };
      },
    };

    this.registry.registerMcpTool(tool);
    this.promoted.set(mcpTool.name, tool);
    console.log(`[swarm-mcp] Promoted tool: ${mcpTool.name} from ${serverId}`);
    return tool;
  }

  async promoteAll(serverId, sessionId) {
    const gateway = new MCPGateway();
    const tools = gateway.getTools().filter(t => t.serverId === serverId);
    const promoted = [];
    for (const tool of tools) {
      promoted.push(await this.promote(tool, serverId, sessionId));
    }
    return promoted;
  }

  demote(toolName) {
    this.registry.unregisterMcpTool(toolName);
    this.promoted.delete(toolName);
  }
}

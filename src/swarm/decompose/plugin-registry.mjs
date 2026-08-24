/**
 * Plugin Registry — Central registry for all tools (built-in + plugins + MCP)
 * Unified interface for tool discovery and execution
 */
import { PluginLoader } from "./plugin-loader.mjs";
import { getConfig } from "./config.mjs";

export class PluginRegistry {
  constructor() {
    this.tools = new Map();
    this.builtins = new Map();
    this.plugins = new Map();
    this.mcpTools = new Map();
    this.loader = new PluginLoader();
  }

  // === BUILT-IN TOOLS ===
  registerBuiltin(tool) {
    this.builtins.set(tool.name, tool);
    this.tools.set(tool.name, tool);
  }

  // === PLUGIN TOOLS ===
  async loadPlugins() {
    const plugins = await this.loader.loadAll();
    for (const [name, tool] of this.loader.loadedTools) {
      this.plugins.set(name, tool);
      this.tools.set(name, tool);
    }
    return plugins;
  }

  // === MCP TOOLS ===
  registerMcpTool(tool) {
    this.mcpTools.set(tool.name, tool);
    this.tools.set(tool.name, tool);
  }

  unregisterMcpTool(name) {
    this.mcpTools.delete(name);
    this.tools.delete(name);
  }

  // === UNIFIED INTERFACE ===
  get(name) {
    return this.tools.get(name);
  }

  has(name) {
    return this.tools.has(name);
  }

  getSchemas() {
    return Array.from(this.tools.values())
      .map(t => t.getSchema?.() || this._defaultSchema(t))
      .filter(Boolean);
  }

  _defaultSchema(tool) {
    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description || "",
        parameters: {
          type: "object",
          properties: tool.parameters || {},
          required: Object.keys(tool.parameters || {}).filter(k => tool.parameters[k]?.required),
        },
      },
    };
  }

  async execute(name, params) {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, error: `Tool '${name}' not found` };
    }
    try {
      const result = await tool.execute(params);
      return result;
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  list() {
    return Array.from(this.tools.keys());
  }

  listBySource() {
    return {
      builtin: Array.from(this.builtins.keys()),
      plugins: Array.from(this.plugins.keys()),
      mcp: Array.from(this.mcpTools.keys()),
    };
  }

  getStats() {
    return {
      total: this.tools.size,
      builtin: this.builtins.size,
      plugins: this.plugins.size,
      mcp: this.mcpTools.size,
    };
  }
}

let _registry = null;

export function getRegistry() {
  if (!_registry) {
    _registry = new PluginRegistry();
  }
  return _registry;
}

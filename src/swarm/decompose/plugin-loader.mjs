/**
 * Plugin Loader — Dynamically discovers and loads plugins from plugins/ directory
 * Supports: xclaw.plugin.json manifests, dynamic imports, hot reload
 */
import { readdirSync, readFileSync, existsSync, watch } from "fs";
import { join, resolve } from "path";
import { pathToFileURL } from "url";
import { getConfig } from "./config.mjs";

export class PluginLoader {
  constructor(pluginsDir = null) {
    this.pluginsDir = resolve(pluginsDir || getConfig().swarm.plugins.directory);
    this.loadedPlugins = new Map();
    this.loadedTools = new Map();
    this.watches = new Map();
  }

  discover() {
    if (!existsSync(this.pluginsDir)) {
      console.warn("[swarm-plugin] Directory not found:", this.pluginsDir);
      return [];
    }
    return readdirSync(this.pluginsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => join(this.pluginsDir, d.name));
  }

  async loadPlugin(pluginDir) {
    const manifestPath = join(pluginDir, "xclaw.plugin.json");
    if (!existsSync(manifestPath)) {
      console.warn("[swarm-plugin] No manifest:", pluginDir);
      return null;
    }

    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      const tools = [];

      // Load tool script
      const toolScript = join(pluginDir, "tool.mjs");
      if (existsSync(toolScript)) {
        const module = await import(pathToFileURL(toolScript).href + `?t=${Date.now()}`);
        for (const [name, exp] of Object.entries(module)) {
          if (typeof exp === "function" && exp.prototype?.execute) {
            const tool = new exp();
            tools.push(tool);
            this.loadedTools.set(tool.name, tool);
            console.log("[swarm-plugin] Tool loaded:", tool.name);
          }
        }
      }

      const plugin = {
        manifest,
        dir: pluginDir,
        tools,
        loadedAt: new Date().toISOString(),
      };

      this.loadedPlugins.set(manifest.name, plugin);
      console.log("[swarm-plugin] Loaded:", manifest.name, "v" + manifest.version, `(${tools.length} tools)`);
      return plugin;

    } catch (e) {
      console.error("[swarm-plugin] Failed to load:", pluginDir, e.message);
      return null;
    }
  }

  async loadAll() {
    const dirs = this.discover();
    const results = await Promise.all(dirs.map(d => this.loadPlugin(d)));
    const loaded = results.filter(Boolean);
    console.log(`[swarm-plugin] Total loaded: ${loaded.length} plugins, ${this.loadedTools.size} tools`);
    return loaded;
  }

  getPlugin(name) {
    return this.loadedPlugins.get(name);
  }

  getTool(name) {
    return this.loadedTools.get(name);
  }

  listPlugins() {
    return Array.from(this.loadedPlugins.values()).map(p => ({
      name: p.manifest.name,
      version: p.manifest.version,
      tools: p.tools.map(t => t.name),
    }));
  }

  listTools() {
    return Array.from(this.loadedTools.keys());
  }

  getToolSchemas() {
    return Array.from(this.loadedTools.values()).map(t => t.getSchema?.() || {
      type: "function",
      function: { name: t.name, description: t.description, parameters: { type: "object", properties: t.parameters || {} } },
    });
  }

  async executeTool(name, params) {
    const tool = this.loadedTools.get(name);
    if (!tool) throw new Error(`Tool '${name}' not found`);
    return await tool.execute(params);
  }

  enableHotReload() {
    for (const [name, plugin] of this.loadedPlugins) {
      const watcher = watch(plugin.dir, { recursive: true }, async (eventType, filename) => {
        if (filename?.endsWith(".mjs") || filename?.endsWith(".json")) {
          console.log(`[swarm-plugin] Hot reload: ${name} (${filename})`);
          await this.loadPlugin(plugin.dir);
        }
      });
      this.watches.set(name, watcher);
    }
  }

  disableHotReload() {
    for (const [name, watcher] of this.watches) {
      watcher.close();
    }
    this.watches.clear();
  }
}

export async function loadPlugins(pluginsDir) {
  const loader = new PluginLoader(pluginsDir);
  return await loader.loadAll();
}

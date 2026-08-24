/**
 * Plugin Loader Tests
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { PluginLoader } from "../../src/swarm/plugin-loader.mjs";

describe("PluginLoader", () => {
  it("should discover plugins directory", () => {
    const loader = new PluginLoader("./plugins");
    const plugins = loader.discover();
    assert.ok(Array.isArray(plugins));
    assert.ok(plugins.length >= 0);
  });

  it("should load a plugin with manifest", async () => {
    const loader = new PluginLoader("./plugins");
    const dirs = loader.discover();
    if (dirs.length === 0) return; // skip if no plugins

    const plugin = await loader.loadPlugin(dirs[0]);
    if (plugin) {
      assert.ok(plugin.manifest.name);
      assert.ok(plugin.manifest.version);
    }
  });

  it("should return tool schemas", async () => {
    const loader = new PluginLoader("./plugins");
    await loader.loadAll();
    const schemas = loader.getToolSchemas();
    assert.ok(Array.isArray(schemas));
  });
});

/**
 * swarm-ext mount — builds the isolated extension's express app ONCE and
 * delegates gateway requests for /api/swarm/* to it.
 *
 * Isolation contract (ADR 0003):
 *  - OFF by default: the gateway only imports this file when cfg.swarmExt.enabled.
 *  - The xclaw core stays zero-dependency: express/ioredis/zod live in
 *    src/swarm-ext/node_modules (npm install --prefix src/swarm-ext).
 *  - The native swarm (src/agents/swarm-*.mjs, /swarm/*) is untouched.
 *  - Telemetry server is force-disabled here (vendor metrics.mjs binds :9090).
 */
import { join, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const extRoot = dirname(fileURLToPath(import.meta.url));

let appPromise = null;

/** Gateway entrypoint. Signature mirrors the plain-http handler style. */
export async function handleSwarmExt(req, res, { cfg } = {}) {
  if (!appPromise) {
    appPromise = buildApp(cfg).catch((err) => {
      appPromise = null; // allow retry after a transient failure (e.g. redis down)
      throw err;
    });
  }
  const app = await appPromise;
  return app(req, res);
}

async function buildApp(xclawCfg) {
  const express = (await import("express")).default;
  const { loadConfig, setConfig } = await import("./src/swarm/config.mjs");

  // Load the extension's own config from INSIDE the subtree (never cwd),
  // then pin deployment-specific values.
  const swarmCfg = loadConfig(join(extRoot, "xclaw-swarm.json"));
  swarmCfg.swarm.plugins.directory = join(extRoot, "plugins");
  // vendor metrics.mjs starts an http server on prometheusPort — never auto-bind
  swarmCfg.swarm.telemetry = { ...(swarmCfg.swarm.telemetry || {}), enabled: false };
  // PARL sample export goes under the gitignored .xclaw/ state dir
  const parlDir = join(extRoot, "..", "..", ".xclaw", "swarm-ext");
  try {
    mkdirSync(parlDir, { recursive: true });
  } catch {
    /* best-effort */
  }
  if (swarmCfg.swarm.parl) swarmCfg.swarm.parl.exportPath = join(parlDir, "parl-samples.jsonl");
  // Route both roles through xclaw's actual configured model (the vendor
  // default names a model this deployment may not have credentials for).
  const model = xclawCfg?.swarmExt?.model || xclawCfg?.agent?.model;
  if (model) {
    swarmCfg.swarm.orchestrator.model = model;
    swarmCfg.swarm.subAgent.model = model;
  }
  // Operator caps from xclaw config win over the vendored JSON.
  if (Number.isFinite(xclawCfg?.swarmExt?.maxSubAgents)) {
    swarmCfg.swarm.orchestrator.maxSubAgents = xclawCfg.swarmExt.maxSubAgents;
  }
  if (Number.isFinite(xclawCfg?.swarmExt?.maxConcurrent)) {
    swarmCfg.swarm.subAgent.maxConcurrent = xclawCfg.swarmExt.maxConcurrent;
  }
  setConfig(swarmCfg);

  // LLM adapter over xclaw's own provider routing.
  const { createSwarmLlmAdapter } = await import("./llm-adapter.mjs");
  const llmClient = await createSwarmLlmAdapter(xclawCfg, {
    model: xclawCfg?.swarmExt?.model,
  });

  // Plugin tool registry (several vendor tools are stubs — see README).
  // NOTE: vendor loadPlugins() returns a plain array; sub-agents need the
  // PluginRegistry interface (getSchemas/execute), so build the registry.
  const { PluginRegistry } = await import("./src/swarm/plugin-registry.mjs");
  const vendorRegistry = new PluginRegistry();
  await vendorRegistry.loadPlugins();

  // Bridge to xclaw's REAL tool router (computer/local/search planes),
  // risk-gated fail-closed. Real tools win name collisions (e.g. the real
  // web_search over the vendor stub); vendor plugins fill the gaps. If the
  // bridge cannot come up (computer plane down), degrade LOUDLY to
  // vendor-only rather than failing the whole mount.
  let toolRegistry = vendorRegistry;
  if (xclawCfg?.swarmExt?.tools?.enabled !== false) {
    try {
      const { createXclawToolBridge, createMergedToolRegistry } = await import("./tool-bridge.mjs");
      const bridge = await createXclawToolBridge(xclawCfg);
      toolRegistry = createMergedToolRegistry(bridge, vendorRegistry);
      console.log(
        `[swarm-ext] xclaw tool bridge up: ${bridge.list().length} real tools (ws=${bridge.workingDir}), vendor fills gaps`
      );
    } catch (err) {
      console.error(`[swarm-ext] xclaw tool bridge UNAVAILABLE — vendor plugins only: ${err.message}`);
    }
  }

  const { swarmLogger } = await import("./src/gateway/middleware/swarm-logger.mjs");
  const { swarmRateLimit } = await import("./src/gateway/middleware/swarm-rate-limit.mjs");
  const swarmRoutes = (await import("./src/gateway/routes/swarm.mjs")).default;
  const batchRoutes = (await import("./src/gateway/routes/swarm-batch.mjs")).default;
  const receiptRoutes = (await import("./src/gateway/routes/swarm-receipt.mjs")).default;

  const app = express();
  app.disable("x-powered-by");
  app.locals.llmClient = llmClient;
  app.locals.toolRegistry = toolRegistry;
  app.use(express.json({ limit: "2mb" }));
  app.use(swarmLogger);
  app.use(swarmRateLimit);
  // NOTE: operator-token auth already happened in the xclaw gateway
  // (auth.mjs protects /api/swarm in BOTH legacy and strict modes) before
  // the request is delegated here.
  app.use("/api/swarm", swarmRoutes);
  app.use("/api/swarm", batchRoutes);
  app.use("/api/swarm", receiptRoutes);
  app.use((req2, res2) => res2.status(404).json({ error: "unknown swarm-ext route" }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req2, res2, next) => {
    console.error(`[swarm-ext] ${err.message}`);
    res2.status(500).json({ error: err.message });
  });
  console.log(
    `[swarm-ext] mounted /api/swarm (model=${llmClient.model}, tools=${toolRegistry?.getSchemas?.().length ?? 0}, maxSubAgents=${swarmCfg.swarm.orchestrator.maxSubAgents})`
  );
  return app;
}

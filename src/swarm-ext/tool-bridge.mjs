/**
 * tool-bridge — exposes xclaw's REAL tool router to swarm-ext sub-agents.
 *
 * Implements the vendor ToolRegistry interface (getSchemas / execute / has /
 * list) over xclaw's tool planes:
 *   computer — xclaw_bash / xclaw_file_* via the computer plane client
 *   local    — glob / grep / web_fetch / file_type / markitdown / …
 *   search   — web_search (allowlisted-HTTP search plane)
 *
 * SECURITY MODEL (sub-agents are autonomous — nothing can pend for a human):
 *   every execute() runs xclaw's assessRisk() first and FAILS CLOSED above
 *   the configured tier. Default: tiers "safe"+"low" auto-run (reads,
 *   provably read-only exec, workspace-scoped writes); "risky"/"critical"
 *   (egress exec, outside-workspace writes, irreversible commands) are
 *   DENIED with a typed error the sub-agent can see. web_search / web_fetch
 *   are name-allowlisted research primitives (their tool-family regex would
 *   otherwise classify them egress→risky) — override via
 *   cfg.swarmExt.tools.alwaysAllow.
 *
 * Dependency-free w.r.t. the extension (imports only zero-dep xclaw core),
 * and every collaborator is injectable for tests.
 */
import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";

const EXECISH_RE = /bash|exec|shell|terminal/i;

/** Curated default tool exposure for sub-agents (∩ actually-advertised). */
export const DEFAULT_ALLOW = [
  // computer plane
  "xclaw_bash",
  "xclaw_file_read",
  "xclaw_file_write",
  "xclaw_file_edit",
  "xclaw_file_list",
  // local plane
  "glob",
  "grep",
  "file_type",
  "markitdown",
  // research (see alwaysAllow note above)
  "web_search",
  "web_fetch",
  // media — real xAI images API via the credential store (replaces the
  // vendor image-generation stub, which fabricated URLs)
  "generate_image",
];

export const DEFAULT_ALWAYS_ALLOW = ["web_search", "web_fetch"];

function schemaName(s) {
  return s?.function?.name || s?.name || "";
}

/**
 * Build the bridge. All heavy collaborators are injectable (tests pass
 * fakes); production callers pass only (cfg).
 */
export async function createXclawToolBridge(cfg = {}, overrides = {}) {
  const toolsCfg = cfg.swarmExt?.tools || {};
  const allow = new Set(
    Array.isArray(toolsCfg.allow) && toolsCfg.allow.length ? toolsCfg.allow : DEFAULT_ALLOW
  );
  const alwaysAllow = new Set(
    Array.isArray(toolsCfg.alwaysAllow) ? toolsCfg.alwaysAllow : DEFAULT_ALWAYS_ALLOW
  );
  const maxTier = String(toolsCfg.autoApproveMaxTier || "low");

  const workingDir =
    overrides.workingDir ||
    toolsCfg.workingDir ||
    join(homedir(), ".xclaw", "workspaces", "swarm-ext");
  try {
    mkdirSync(workingDir, { recursive: true });
  } catch {
    /* best-effort; risk scoping still works */
  }

  // --- collaborators (real by default, injectable for tests) ---
  let computer = overrides.computer;
  let sessionId = overrides.sessionId || null;
  if (computer === undefined) {
    const { ensureComputer } = await import("../computer/ensure.mjs");
    const { createComputerClient } = await import("../agent/computer-client.mjs");
    const ready = await ensureComputer(cfg, { log: false });
    if (!ready.ok) {
      throw new Error(`computer plane unavailable for swarm-ext tool bridge: ${ready.error || ready.url}`);
    }
    computer = createComputerClient(cfg);
    sessionId = await computer.createSession(workingDir);
  }

  let localTools = overrides.localTools;
  if (localTools === undefined) {
    const { createAllLocalTools } = await import("../tools/registry.mjs");
    localTools = createAllLocalTools({ workingDir, cfg, computer, sessionId });
  }

  const { toOpenAITools, formatToolResult } = await import("../agent/computer-client.mjs");
  const { localToolsAsOpenAI } = await import("../tools/registry.mjs");
  const { createToolRouter } = await import("../tools/router.mjs");
  const { assessRisk, tierRank } =
    overrides.risk || (await import("../security/risk.mjs"));

  // Probe the engine's advertised bash schema BEFORE building the router —
  // the frozen C4 bundle's strict zod schemas reject unknown keys, so the
  // router must strip injected cwd/systemRunPlan when the engine doesn't
  // declare them (same probe the agent loop runs; skipping it made the live
  // engine fail every call with "Unrecognized key(s): 'cwd'", 2026-08-24).
  const rawComputerTools = computer?.listTools ? await computer.listTools(sessionId) : [];
  const bashProps =
    rawComputerTools.find((t) => t.name === "xclaw_bash")?.inputSchema?.properties || {};
  const computerAcceptsCwd = Boolean(bashProps.cwd);
  const computerAcceptsRunPlan = Boolean(bashProps.systemRunPlan);

  const router =
    overrides.router ||
    createToolRouter({
      computer,
      sessionId,
      localTools,
      cfg,
      workingDir,
      computerAcceptsCwd,
      computerAcceptsRunPlan,
    });

  // --- advertised schemas: (computer ∪ local) ∩ allow, deduped ---
  const computerSchemas = toOpenAITools(rawComputerTools);
  const localSchemas = localToolsAsOpenAI(localTools || []);
  const seen = new Set();
  const schemas = [];
  for (const s of [...computerSchemas, ...localSchemas]) {
    const n = schemaName(s);
    if (!n || seen.has(n) || !allow.has(n)) continue;
    seen.add(n);
    schemas.push(s);
  }
  const names = new Set(schemas.map(schemaName));

  async function execute(name, params) {
    if (!names.has(name)) {
      return { success: false, error: `Tool '${name}' not exposed to swarm-ext` };
    }
    let args = params && typeof params === "object" ? { ...params } : {};
    // Pin exec cwd to the bridge workspace (same pattern as the agent loop's
    // authArgs) so risk scoping and execution see the same root.
    if (EXECISH_RE.test(name) && !args.cwd && !args.workingDir) {
      args = { ...args, cwd: workingDir };
    }

    // Risk gate — fail closed, never pend.
    if (!alwaysAllow.has(name)) {
      let risk;
      try {
        risk = assessRisk({ tool: name, args, workingDir, cfg });
      } catch (e) {
        return { success: false, error: `risk assessment failed (fail-closed): ${e.message}` };
      }
      if (tierRank(risk.tier) > tierRank(maxTier)) {
        const why = (risk.reasons || []).slice(0, 3).join("; ");
        return {
          success: false,
          blocked: true,
          error: `blocked by swarm-ext risk policy: tier=${risk.tier} > ${maxTier}${why ? ` (${why})` : ""}`,
        };
      }
    }

    const out = await router.dispatch({ name, args });
    if (!out.ok) {
      return {
        success: false,
        blocked: Boolean(out.blocked),
        error: out.error || formatToolResult(out.result) || "tool failed",
      };
    }
    let data;
    try {
      data = formatToolResult(out.result);
    } catch {
      data = out.result;
    }
    if (data === undefined || data === null || data === "") data = out.result;
    return { success: true, data, plane: out.plane, durationMs: out.durationMs };
  }

  return {
    kind: "xclaw-tool-bridge",
    workingDir,
    sessionId,
    getSchemas: () => schemas,
    has: (name) => names.has(name),
    list: () => [...names],
    execute,
    async close() {
      try {
        if (sessionId && computer?.destroySession) await computer.destroySession(sessionId);
      } catch {
        /* best-effort */
      }
    },
  };
}

/**
 * Merge two registries behind the vendor interface. `primary` (real xclaw
 * tools) wins name collisions — e.g. real web_search over the vendor stub.
 */
export function createMergedToolRegistry(primary, fallback) {
  if (!primary) return fallback;
  if (!fallback) return primary;
  const primaryNames = new Set(primary.getSchemas().map(schemaName));
  return {
    kind: "merged-tool-registry",
    getSchemas() {
      const out = [...primary.getSchemas()];
      for (const s of fallback.getSchemas()) {
        if (!primaryNames.has(schemaName(s))) out.push(s);
      }
      return out;
    },
    has(name) {
      return primaryNames.has(name) || (fallback.has ? fallback.has(name) : false);
    },
    list() {
      return this.getSchemas().map(schemaName);
    },
    async execute(name, params) {
      if (primaryNames.has(name)) return primary.execute(name, params);
      return fallback.execute(name, params);
    },
  };
}

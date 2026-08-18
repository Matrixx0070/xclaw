import { sanitizeToolArgs } from "../agent/computer-client.mjs";
/**
 * T1 — Tool Router: single dispatch path to planes.
 *
 * Security (approve / plan revalidate) stays in the agent loop BEFORE dispatch.
 * Router only routes + records plane/duration.
 */
import {
  getPlane,
  getConcurrencyClass,
  classifyTool,
  partitionByConcurrency,
  isComputerOnlyTool,
} from "./planes.mjs";
import { executeLocalTool, localToolNames } from "./registry.mjs";
import { runWebSearch, isSearchPlaneTool } from "../planes/search.mjs";
import {
  assertPlanAtSpawn,
  getSpawnEnforceMode,
} from "../security/spawn-enforce.mjs";

/**
 * @param {object} ctx
 * @param {object} [ctx.computer] — { callTool(sessionId, name, args) }
 * @param {string} [ctx.sessionId]
 * @param {object[]} [ctx.localTools]
 * @param {Record<string, Function>} [ctx.agentHandlers] — name → async (args) => result
 * @param {object} [ctx.cfg]
 * @param {string} [ctx.workingDir]
 * @param {Function} [ctx.beforeComputer] — optional async (name, args) => { args?, skip?, result? }
 * @param {boolean} [ctx.computerAcceptsRunPlan] — whether the computer engine's
 *   advertised xclaw_bash schema declares systemRunPlan. Opaque engines (the CDP
 *   bundle) strictly validate input and reject unknown keys, so when false the
 *   router enforces the frozen plan itself and strips the key before forwarding.
 */
export function createToolRouter(ctx = {}) {
  const {
    computer = null,
    sessionId = "default",
    localTools = [],
    agentHandlers = {},
    cfg = {},
    workingDir = process.cwd(),
    beforeComputer = null,
    computerAcceptsRunPlan = true,
    computerAcceptsCwd = true,
  } = ctx;

  const localNames = new Set(
    typeof localToolNames === "function"
      ? localToolNames(localTools)
      : (localTools || []).map((t) => t.name).filter(Boolean)
  );

  /**
   * @param {object} req
   * @param {string} req.name
   * @param {object} [req.args]
   * @param {string} [req.callId]
   * @param {object} [req.plan]
   * @param {AbortSignal} [req.signal]
   */
  async function dispatch(req = {}) {
    const name = String(req.name || "").trim();
    const callId = req.callId || `call-${Date.now()}`;
    let args = req.args && typeof req.args === "object" ? { ...req.args } : {};
    args = sanitizeToolArgs(name, args);
    // Carry frozen plan for computer bash spawn enforce
    if (req.plan && !args.systemRunPlan) {
      args.systemRunPlan = req.plan;
    }
    const plane = getPlane(name);
    const started = Date.now();

    if (req.signal?.aborted) {
      return {
        callId,
        name,
        plane,
        ok: false,
        blocked: true,
        error: "aborted",
        durationMs: 0,
      };
    }

    try {
      let result;

      if (plane === "agent" || agentHandlers[name]) {
        const handler = agentHandlers[name];
        if (!handler) {
          return {
            callId,
            name,
            plane: "agent",
            ok: false,
            error: `No agent handler for ${name}`,
            durationMs: Date.now() - started,
          };
        }
        result = await handler(args);
      } else if (plane === "computer" || isComputerOnlyTool(name)) {
        // T3: heavy tools (bash/files/browser) NEVER fall back to in-process local
        if (!computer?.callTool) {
          return {
            callId,
            name,
            plane: "computer",
            ok: false,
            blocked: true,
            error:
              "computer plane unavailable — start computer (xclaw gateway / xclaw computer). Heavy tools cannot run in-process.",
            result: {
              isError: true,
              content: [
                {
                  type: "text",
                  text: "computer plane unavailable for " + name,
                },
              ],
            },
            durationMs: Date.now() - started,
          };
        }
        // Engines that don't declare systemRunPlan in their tool schema
        // (the strict-zod CDP bundle) would reject the whole call on the
        // injected key. Run the same spawn-time plan gate the module engine
        // runs, then strip the key before forwarding.
        if (args.systemRunPlan && !computerAcceptsRunPlan) {
          const plan = args.systemRunPlan;
          delete args.systemRunPlan;
          const check = assertPlanAtSpawn({
            plan,
            command: args.command,
            cwd: args.cwd || workingDir,
            mode: getSpawnEnforceMode(cfg),
          });
          if (!check.ok) {
            const msg = check.error || "spawn enforce denied";
            return {
              callId,
              name,
              plane: "computer",
              ok: false,
              blocked: true,
              error: msg,
              result: {
                isError: true,
                content: [{ type: "text", text: msg }],
              },
              durationMs: Date.now() - started,
            };
          }
          if (check.command) args.command = check.command;
        }
        // Same strict-schema guard for the injected cwd/workingDir pin: the
        // frozen C4 bundle rejects unknown keys, and its session already runs
        // in the createSession(workingDir) directory — stripping loses nothing.
        if (!computerAcceptsCwd) {
          if ("cwd" in args) delete args.cwd;
          if ("workingDir" in args) delete args.workingDir;
        }
        if (typeof beforeComputer === "function") {
          const gate = await beforeComputer(name, args);
          if (gate?.result !== undefined) {
            result = gate.result;
          } else if (gate?.skip) {
            result = { ok: false, error: gate.error || "computer skipped" };
          } else {
            result = await computer.callTool(
              sessionId,
              name,
              gate?.args || args
            );
          }
        } else {
          result = await computer.callTool(sessionId, name, args);
        }
      } else if (plane === "search" || isSearchPlaneTool(name)) {
        // T4: dedicated search plane — allowlisted HTTP only, never shell
        result = await runWebSearch(args);
      } else if (plane === "local") {
        if (localNames.has(name)) {
          result = await executeLocalTool(localTools, name, args);
          if (result == null) throw new Error(`Unknown local tool: ${name}`);
        } else {
          throw new Error(`No adapter for ${name} (plane=${plane})`);
        }
      } else if (plane === "mcp") {
        if (localNames.has(name)) {
          result = await executeLocalTool(localTools, name, args);
          if (result == null) throw new Error(`Unknown MCP tool: ${name}`);
        } else {
          throw new Error(`No MCP adapter for ${name}`);
        }
      } else {
        // unknown non-computer: local only (do not invent computer routing for unknowns)
        if (localNames.has(name)) {
          result = await executeLocalTool(localTools, name, args);
        } else {
          throw new Error(`Unknown tool: ${name}`);
        }
      }

      const isErr =
        result?.isError === true ||
        result?.ok === false ||
        result?.blocked === true;

      return {
        callId,
        name,
        plane,
        ok: !isErr,
        result,
        blocked: Boolean(result?.blocked),
        durationMs: Date.now() - started,
      };
    } catch (err) {
      return {
        callId,
        name,
        plane,
        ok: false,
        error: err?.message || String(err),
        result: {
          isError: true,
          content: [{ type: "text", text: err?.message || String(err) }],
        },
        durationMs: Date.now() - started,
      };
    }
  }

  return {
    dispatch,
    getPlane,
    getConcurrencyClass,
    classifyTool,
    partitionByConcurrency,
    isComputerOnlyTool,
    classify: classifyTool,
  };
}

export default { createToolRouter };

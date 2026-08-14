/**
 * xclaw_repo_intel — the persistent repo-intelligence tool (slice B1).
 * Exposes the incremental index to EVERY agent run: compounding brief,
 * ranked task context, symbol lookup, lexical search.
 */
import { openIntelStore } from "./intel-store.mjs";

export function createRepoIntelTool({ cfg, workingDir }) {
  return {
    name: "xclaw_repo_intel",
    description:
      "Repo intelligence over a persistent incremental index: action 'brief' (compounded repo overview: central modules, hot files, verify commands, recent missions), 'context' (ranked task context for a query), 'symbols' (find a symbol definition), 'search' (lexical search). Prefer this over ad-hoc grepping to orient in a repository.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["brief", "context", "symbols", "search"],
          description: "What to fetch",
        },
        query: {
          type: "string",
          description: "Task/query text (context, symbols, search)",
        },
      },
      required: ["action"],
    },
    async execute(args = {}) {
      const store = await openIntelStore(cfg, workingDir || process.cwd());
      const action = args.action || "brief";
      if (action === "brief") {
        const text = await store.brief({ regenerate: true });
        return { ok: true, brief: text };
      }
      if (action === "context") {
        if (!args.query) return { ok: false, error: "query required" };
        const out = await store.query(args.query, { withBrief: false });
        return { ok: true, context: out.contextText.slice(0, 20_000), stats: out.stats };
      }
      if (action === "symbols") {
        if (!args.query) return { ok: false, error: "query required" };
        return { ok: true, symbols: await store.symbols(args.query) };
      }
      if (action === "search") {
        if (!args.query) return { ok: false, error: "query required" };
        return { ok: true, hits: await store.search(args.query, { limit: 30 }) };
      }
      return { ok: false, error: `unknown action ${action}` };
    },
  };
}

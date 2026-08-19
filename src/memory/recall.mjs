/**
 * Retrieval over durable workspace memory (and optional swarm receipts).
 * Keyword / token scoring — no embedding dependency required for v1.
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  listMemory,
  memoryPaths,
  appendMemory,
  loadDurableMemoryFile,
} from "./durable.mjs";
import { expandRecallHits } from "./recall-provenance.mjs";

function tokenize(q) {
  return String(q || "")
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);
}

function scoreText(text, tokens) {
  const hay = String(text || "").toLowerCase();
  if (!hay || !tokens.length) return 0;
  let s = 0;
  for (const t of tokens) {
    if (hay.includes(t)) s += 1 + Math.min(2, t.length / 8);
  }
  return s;
}

function eventBlob(ev) {
  return [
    ev.type,
    ev.summary,
    ev.goal,
    ev.status,
    ev.error,
    ev.proposal,
    ev.jobId,
    JSON.stringify(ev).slice(0, 2000),
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Search durable events.jsonl for a workspace.
 *
 * @param {object} cfg
 * @param {string} workspacePath
 * @param {object} opts
 * @param {string} opts.query
 * @param {number} [opts.limit=8]
 * @param {number} [opts.scan=200]
 */
export async function recallMemory(cfg, workspacePath, opts = {}) {
  const query = String(opts.query || "").trim();
  const limit = Math.min(30, Math.max(1, opts.limit ?? 8));
  const scan = Math.min(500, Math.max(limit, opts.scan ?? 200));
  const tokens = tokenize(query);

  const events = await listMemory(cfg, workspacePath, { limit: scan });
  const scored = events
    .map((ev) => ({
      ev,
      score: scoreText(eventBlob(ev), tokens) || (query ? 0 : 0.1),
    }))
    .filter((x) => (tokens.length ? x.score > 0 : true))
    .sort((a, b) => b.score - a.score || String(b.ev.at).localeCompare(String(a.ev.at)))
    .slice(0, limit);

  const paths = memoryPaths(cfg, workspacePath);
  const expanded = expandRecallHits(scored, events, opts.provenance || {});
  return {
    workspace: paths.workspace,
    memoryKey: paths.key,
    query,
    hits: expanded.map(({ ev, score, provenance }) => ({
      score: Math.round(score * 100) / 100,
      at: ev.at,
      type: ev.type,
      summary: ev.summary || ev.goal || ev.text || null,
      goal: ev.goal || null,
      jobId: ev.jobId || null,
      status: ev.status || null,
      sourceIds: ev.sourceIds || ev.meta?.sourceIds || null,
      provenance: provenance
        ? {
            ok: provenance.ok,
            missing: provenance.missing,
            sources: (provenance.sources || []).map((s) => ({
              id: s.id,
              text: String(s.text || s.summary || "").slice(0, 240),
            })),
          }
        : null,
    })),
    hitCount: scored.length,
  };
}

/**
 * Best-effort scan of recent swarm receipt summaries under ~/.xclaw/swarms
 */
export async function recallSwarmReceipts(cfg, opts = {}) {
  const query = String(opts.query || "").trim();
  const tokens = tokenize(query);
  const limit = Math.min(20, opts.limit ?? 5);
  const root =
    cfg?.paths?.swarmsDir ||
    path.join(cfg?.paths?.configDir || path.join(os.homedir(), ".xclaw"), "swarms");

  let runDirs = [];
  try {
    const runs = path.join(root, "runs");
    const names = await fs.readdir(runs).catch(() => []);
    runDirs = names.slice(-40).map((n) => path.join(runs, n));
  } catch {
    return { hits: [], hitCount: 0 };
  }

  const hits = [];
  for (const dir of runDirs.reverse()) {
    for (const fname of ["receipt-summary.json", "receiptSummary.json", "summary.json"]) {
      const fp = path.join(dir, fname);
      try {
        const raw = await fs.readFile(fp, "utf8");
        const score = scoreText(raw, tokens);
        if (tokens.length && score <= 0) continue;
        let parsed = null;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = { raw: raw.slice(0, 400) };
        }
        hits.push({
          score,
          path: fp,
          runDir: dir,
          summary: parsed,
        });
      } catch {
        /* */
      }
    }
    if (hits.length >= limit * 3) break;
  }

  hits.sort((a, b) => b.score - a.score);
  return {
    query,
    hits: hits.slice(0, limit),
    hitCount: Math.min(limit, hits.length),
  };
}

/**
 * Combined recall: memory events + optional receipts + MEMORY.md snippet.
 */
export async function recallAll(cfg, workspacePath, opts = {}) {
  const mem = await recallMemory(cfg, workspacePath, opts);
  let receipts = { hits: [], hitCount: 0 };
  if (opts.includeReceipts !== false) {
    try {
      receipts = await recallSwarmReceipts(cfg, opts);
    } catch {
      /* */
    }
  }
  let mdSnippet = null;
  try {
    const md = await loadDurableMemoryFile(cfg, workspacePath);
    if (md?.body) {
      const tokens = tokenize(opts.query);
      if (!tokens.length || scoreText(md.body, tokens) > 0) {
        mdSnippet = md.body.slice(0, 1500);
      }
    }
  } catch {
    /* */
  }

  return {
    ...mem,
    receipts: receipts.hits,
    memoryMd: mdSnippet,
  };
}

/**
 * OpenAI-style tool descriptor + execute for the agent loop.
 */
export function createRecallTool({ cfg, workingDir }) {
  return {
    name: "xclaw_recall",
    description:
      "Search durable workspace memory and recent swarm receipts for past goals, outcomes, and notes. Use before repeating work or when the user asks what happened earlier.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (keywords, goal fragment, error text)",
        },
        limit: {
          type: "number",
          description: "Max memory hits (default 8)",
        },
        includeReceipts: {
          type: "boolean",
          description: "Also search swarm receipt summaries (default true)",
        },
      },
      required: ["query"],
    },
    async execute(args = {}) {
      const result = await recallAll(cfg, workingDir || process.cwd(), {
        query: args.query,
        limit: args.limit,
        includeReceipts: args.includeReceipts,
      });
      return {
        ok: true,
        ...result,
      };
    },
  };
}

/**
 * Convenience: store a free-form note into durable memory.
 */
export async function rememberNote(cfg, workspacePath, summary, extra = {}) {
  return appendMemory(cfg, workspacePath, {
    type: "note",
    summary: String(summary || "").slice(0, 500),
    ...extra,
  });
}

export default {
  recallMemory,
  recallSwarmReceipts,
  recallAll,
  createRecallTool,
  rememberNote,
};

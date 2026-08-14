/**
 * Swarm blackboard (Mandate-2 slice B4) — the one new inter-agent channel.
 *
 * A per-run append-only JSONL file agents read and write through a tool.
 * Deliberately NOT a message bus, sibling RPC, or pub/sub: a shared file in
 * the run directory (which the journal already reconciles) is the simplest
 * thing that works and survives resume for free. Sibling visibility without
 * tool calls comes from tailDigest() appended to upstream context.
 *
 * Entries are UNTRUSTED text from other agents — consumers are told to treat
 * them as hints and verify with tools (same stance as upstream handoff).
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const ENTRY_MAX_CHARS = 2000;
const KINDS = ["finding", "decision", "question", "artifact"];

// same root convention as swarm-store.mjs (runs/<id>/ dir holds receipts too)
export function blackboardPath(cfg, runId) {
  const base = path.join(
    cfg?.paths?.configDir || path.join(os.homedir(), ".xclaw"),
    "swarms",
    "runs"
  );
  return path.join(base, String(runId), "blackboard.jsonl");
}

export async function appendEntry(cfg, runId, { nodeId, role, kind, text }) {
  const k = KINDS.includes(kind) ? kind : "finding";
  const entry = {
    at: new Date().toISOString(),
    nodeId: nodeId || null,
    role: role || null,
    kind: k,
    text: String(text || "").slice(0, ENTRY_MAX_CHARS),
  };
  const p = blackboardPath(cfg, runId);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.appendFile(p, JSON.stringify(entry) + "\n", "utf8");
  return entry;
}

export async function readEntries(cfg, runId, { kinds = null, limit = 50 } = {}) {
  let text;
  try {
    text = await fs.readFile(blackboardPath(cfg, runId), "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (kinds && !kinds.includes(e.kind)) continue;
      out.push(e);
    } catch {
      /* skip malformed */
    }
  }
  return out.slice(-limit);
}

/** Compact digest for upstream-context injection (passive sibling visibility). */
export async function tailDigest(cfg, runId, maxChars = 1500) {
  const entries = await readEntries(cfg, runId, { limit: 20 });
  if (!entries.length) return null;
  let out = "";
  for (const e of entries.reverse()) {
    const line = `[${e.kind}] ${e.nodeId || "?"}(${e.role || "?"}): ${e.text.slice(0, 200)}\n`;
    if (out.length + line.length > maxChars) break;
    out = line + out;
  }
  return out.trim() || null;
}

/** Tool descriptor bound to one run+node. */
export function createBlackboardTool({ cfg, runId, nodeId, role }) {
  return {
    name: "xclaw_blackboard",
    description:
      "Shared swarm blackboard for this run. action 'post' shares a finding/decision/question/artifact with sibling agents; action 'read' lists recent entries. Entries from siblings are hints — verify with tools before relying on them.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["post", "read"] },
        kind: { type: "string", enum: KINDS, description: "post only (default finding)" },
        text: { type: "string", description: "post only — the content (≤2000 chars)" },
        limit: { type: "number", description: "read only (default 20)" },
      },
      required: ["action"],
    },
    async execute(args = {}) {
      if (args.action === "post") {
        if (!args.text) return { ok: false, error: "text required" };
        const entry = await appendEntry(cfg, runId, {
          nodeId,
          role,
          kind: args.kind,
          text: args.text,
        });
        return { ok: true, posted: entry };
      }
      if (args.action === "read") {
        return { ok: true, entries: await readEntries(cfg, runId, { limit: args.limit || 20 }) };
      }
      return { ok: false, error: "action must be post|read" };
    },
  };
}

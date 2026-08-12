/**
 * Swarm resume journal — append-only NDJSON per run.
 *
 * One line per event: a `run_start` header (with a graph hash so a journal
 * can never be replayed against a different graph), `node_start` at dispatch,
 * and `node_result` at every terminal node transition. Written with
 * fs.appendFile through a serializing chain (single-writer NDJSON); reads
 * tolerate a torn trailing line from a crash mid-append.
 *
 * The journal is advisory: a write failure warns (once) and never fails the
 * run. Resume (swarm-run.mjs resumeSwarmRun) replays terminal ok results into
 * the wave scheduler's state maps and re-runs only what remains.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

function runsDir(cfg) {
  return path.join(
    cfg?.paths?.configDir || path.join(os.homedir(), ".xclaw"),
    "swarms",
    "runs"
  );
}

export function journalPath(cfg, runId) {
  return path.join(runsDir(cfg), `${runId}.journal`);
}

/**
 * Stable hash over the semantic graph (id/task/role/dependsOn) + goal.
 * Node status/attempts/etc. deliberately excluded — the hash identifies the
 * graph, not its progress.
 */
export function computeGraphHash(goal, nodes = []) {
  const canon = {
    goal: String(goal || ""),
    nodes: nodes.map((n) => ({
      id: n.id,
      task: n.task,
      role: n.role,
      dependsOn: [...(n.dependsOn || [])],
    })),
  };
  return crypto.createHash("sha256").update(JSON.stringify(canon)).digest("hex");
}

/** Drop the potentially huge toolTrace and cap text before journaling. */
export function slimResultForJournal(r) {
  if (!r || typeof r !== "object") return r;
  const { toolTrace, ...rest } = r;
  if (typeof rest.text === "string" && rest.text.length > 50_000) {
    rest.text = rest.text.slice(0, 50_000);
  }
  return rest;
}

/**
 * Serialized appender for one run's journal. append() never rejects; the
 * first write failure triggers onWarn once and later writes keep trying.
 */
export function createRunJournal(cfg, runId, { onWarn } = {}) {
  const fp = journalPath(cfg, runId);
  let chain = Promise.resolve();
  let warned = false;
  const append = (entry) => {
    const line = JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n";
    chain = chain.then(async () => {
      try {
        await fs.mkdir(path.dirname(fp), { recursive: true });
        await fs.appendFile(fp, line);
      } catch (e) {
        if (!warned) {
          warned = true;
          try {
            onWarn?.(e);
          } catch {
            /* advisory */
          }
        }
      }
    });
    return chain;
  };
  return { path: fp, append, flush: () => chain };
}

/**
 * Read a journal into parsed entries. Returns null when the file is absent.
 * Unparseable lines are skipped (a torn trailing line is the expected crash
 * artifact; anything else is treated the same — the journal is advisory).
 */
export async function readJournal(cfg, runId) {
  let raw;
  try {
    raw = await fs.readFile(journalPath(cfg, runId), "utf8");
  } catch {
    return null;
  }
  const entries = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      /* torn/corrupt line — skip */
    }
  }
  return entries;
}

export default {
  journalPath,
  computeGraphHash,
  slimResultForJournal,
  createRunJournal,
  readJournal,
};

/**
 * Enqueue multiple jobs from a JSON array or JSONL file.
 */
import fs from "node:fs/promises";
import { enqueueJob, startQueueWorker } from "./queue.mjs";

/**
 * @param {object} cfg
 * @param {string} filePath
 * @returns {Promise<{ enqueued: object[], errors: string[] }>}
 */
export async function enqueueFromFile(cfg, filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  let items = [];
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    items = JSON.parse(trimmed);
  } else {
    for (const line of trimmed.split("\n")) {
      if (!line.trim()) continue;
      items.push(JSON.parse(line));
    }
  }
  if (!Array.isArray(items)) throw new Error("batch file must be JSON array or JSONL");

  startQueueWorker(cfg);
  const enqueued = [];
  const errors = [];
  for (const it of items) {
    const goal = it.goal || it.message || it.prompt;
    if (!goal) {
      errors.push("missing goal in item");
      continue;
    }
    try {
      const rec = await enqueueJob(cfg, {
        goal,
        verify: it.verify || [],
        maxTurns: it.maxTurns,
        priority: it.priority ?? 0,
      });
      enqueued.push(rec);
    } catch (err) {
      errors.push(err.message || String(err));
    }
  }
  return { enqueued, errors, count: enqueued.length };
}

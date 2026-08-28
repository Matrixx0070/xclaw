/**
 * Enqueue multiple jobs from a JSON array or JSONL file.
 *
 * The gateway owns the queue, so this asks the owner rather than writing to the
 * queue directory itself — see runQueueControl(). Two things went wrong while
 * this file hand-rolled its own enqueue:
 *
 *   1. It forwarded goal|verify|maxTurns|priority only, so a batch item with
 *      `harness: true` arrived as a plain job: it KEPT its verify steps and
 *      lost every flag that makes them enforced (measured on the live gateway:
 *      `{"harness":true,"class":"interactive"}` in, `harness:false,
 *      class:"batch", maxAttempts:1` stored). The accepted shape now comes from
 *      pickEnqueueRequest(), the same one POST /queue uses.
 *   2. enqueueJob()'s kick() fires in the CALLING process, so a job written by
 *      the CLI kicked a worker that died 0.1s later. Measured live against an
 *      idle gateway: still "queued" 24s after `xclaw queue batch`.
 */
import fs from "node:fs/promises";
import { enqueueJob, pickEnqueueRequest } from "./queue.mjs";
import { runQueueControl } from "../cli/queue-cli.mjs";

/**
 * @param {string} raw JSON array or JSONL
 * @returns {object[]}
 */
export function parseBatchFile(raw) {
  const trimmed = String(raw).trim();
  if (trimmed.startsWith("[")) return JSON.parse(trimmed);
  const items = [];
  for (const line of trimmed.split("\n")) {
    if (!line.trim()) continue;
    items.push(JSON.parse(line));
  }
  return items;
}

/**
 * @param {object} cfg
 * @param {string} filePath
 * @param {{ fetchImpl?: Function }} [deps]
 * @returns {Promise<{ enqueued: object[], errors: string[], count: number, note: string|null }>}
 */
export async function enqueueFromFile(cfg, filePath, deps = {}) {
  const items = parseBatchFile(await fs.readFile(filePath, "utf8"));

  const enqueued = [];
  const errors = [];
  let note = null;
  for (const it of items) {
    const goal = it.goal || it.message || it.prompt;
    if (!goal) {
      errors.push("missing goal in item");
      continue;
    }
    try {
      // Admission (queue full, paused) rejects one item, not the batch.
      const out = await runQueueControl(cfg, "add", pickEnqueueRequest({ ...it, goal }), {
        fetchImpl: deps.fetchImpl,
        enqueueLocal: enqueueJob,
      });
      // No !out.ok branch: "add" with a local fallback either succeeds or
      // throws (pinned in queue-cli-owner.test.mjs), and the catch below
      // records the throw as this item's error.
      if (out.note) note = out.note;
      enqueued.push(out.result);
    } catch (err) {
      errors.push(err.message || String(err));
    }
  }
  return { enqueued, errors, count: enqueued.length, note };
}

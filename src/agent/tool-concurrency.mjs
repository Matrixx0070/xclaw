/**
 * Tool concurrency — T2 aligned with planes.mjs.
 *
 * Read-only / idempotent tools may run concurrently (capped by maxParallel).
 * Mutating / exec / browser tools stay serial.
 */
import {
  getConcurrencyClass,
  PARALLEL_SAFE as PLANE_PARALLEL_SAFE,
} from "../tools/planes.mjs";

/** Extra force-serial (agent meta + swarm) beyond plane defaults */
const FORCE_SERIAL = new Set([
  "xclaw_bash",
  "bash",
  "shell",
  "exec",
  "xclaw_exec",
  "run_terminal",
  "xclaw_file_write",
  "file_write",
  "write_file",
  "xclaw_file_edit",
  "file_edit",
  "edit_file",
  "xclaw_browser_tab",
  "browser_tab",
  "xclaw_spawn_subagent",
  "xclaw_swarm_run",
  "xclaw_swarm_merge_approve",
  "xclaw_swarm_merge_reject",
]);

const PARALLEL_SAFE = new Set([
  ...PLANE_PARALLEL_SAFE,
  "list_files",
  "xclaw_swarm_merge_status",
]);

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isParallelSafeTool(name) {
  const n = String(name || "").toLowerCase();
  if (FORCE_SERIAL.has(n)) return false;
  if (PARALLEL_SAFE.has(n)) return true;
  // Defer to plane classification
  if (getConcurrencyClass(n) === "parallel-safe") return true;
  return false;
}

/**
 * Partition tool_calls into batches: consecutive parallel-safe tools share a batch.
 * @param {Array<{ function?: { name?: string }, name?: string }>} calls
 * @returns {Array<{ parallel: boolean, calls: typeof calls }>}
 */
export function partitionToolCalls(calls = []) {
  const batches = [];
  for (const call of calls) {
    const name = call?.function?.name || call?.name || "";
    const parallel = isParallelSafeTool(name);
    const last = batches[batches.length - 1];
    if (last && last.parallel === parallel && parallel) {
      last.calls.push(call);
    } else {
      batches.push({ parallel, calls: [call] });
    }
  }
  return batches;
}

/**
 * Split a parallel batch into chunks of at most maxParallel.
 * @param {Array} calls
 * @param {number} maxParallel
 * @returns {Array<Array>}
 */
export function chunkParallelCalls(calls = [], maxParallel = 4) {
  const n = Math.max(1, Number(maxParallel) || 4);
  if (calls.length <= n) return [calls];
  const chunks = [];
  for (let i = 0; i < calls.length; i += n) {
    chunks.push(calls.slice(i, i + n));
  }
  return chunks;
}

/**
 * Resolve max parallel tools from cfg/env.
 * @param {object} [cfg]
 * @returns {number}
 */
export function resolveMaxParallel(cfg = {}) {
  const env = Number(process.env.XCLAW_TOOLS_MAX_PARALLEL);
  if (Number.isFinite(env) && env > 0) return Math.min(32, env);
  const c = Number(cfg?.tools?.maxParallel ?? cfg?.agent?.maxParallelTools);
  if (Number.isFinite(c) && c > 0) return Math.min(32, c);
  return 4;
}

/**
 * Run processFn over partitioned batches with parallel cap + abort.
 * @param {Array} calls
 * @param {object} opts
 * @param {(call: any) => Promise<any>} opts.processFn
 * @param {AbortSignal} [opts.signal]
 * @param {object} [opts.cfg]
 * @param {(ev: object) => void} [opts.onEvent]
 * @returns {Promise<{ stop: boolean }>}
 */
export async function runToolBatches(calls, opts = {}) {
  const {
    processFn,
    signal = null,
    cfg = {},
    onEvent = () => {},
  } = opts;
  if (typeof processFn !== "function") {
    throw new Error("runToolBatches requires processFn");
  }

  const maxParallel = resolveMaxParallel(cfg);
  const batches = partitionToolCalls(calls);
  onEvent({
    type: "tools",
    phase: "batch_plan",
    maxParallel,
    batches: batches.map((b) => ({
      parallel: b.parallel,
      count: b.calls.length,
      names: b.calls.map((c) => c.function?.name || c.name),
    })),
  });

  let stop = false;
  for (const batch of batches) {
    if (signal?.aborted) throw new Error("aborted");
    if (stop) break;

    if (batch.parallel && batch.calls.length > 1) {
      const chunks = chunkParallelCalls(batch.calls, maxParallel);
      for (const chunk of chunks) {
        if (signal?.aborted) throw new Error("aborted");
        if (stop) break;
        onEvent({
          type: "tools",
          phase: "parallel",
          count: chunk.length,
          maxParallel,
          names: chunk.map((c) => c.function?.name || c.name),
        });
        const results = await Promise.all(chunk.map((c) => processFn(c)));
        if (results.some((r) => r === "stop")) stop = true;
      }
    } else {
      for (const c of batch.calls) {
        if (signal?.aborted) throw new Error("aborted");
        if (stop) break;
        const r = await processFn(c);
        if (r === "stop") {
          stop = true;
          break;
        }
      }
    }
  }
  return { stop };
}

export default {
  isParallelSafeTool,
  partitionToolCalls,
  chunkParallelCalls,
  resolveMaxParallel,
  runToolBatches,
  PARALLEL_SAFE,
  FORCE_SERIAL,
};

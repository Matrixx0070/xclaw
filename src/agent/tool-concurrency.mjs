/**
 * Tool concurrency classification for parallel batches.
 *
 * Read-only / idempotent tools may run concurrently.
 * Mutating / exec / browser tools stay serial (order + approval safety).
 */

const PARALLEL_SAFE = new Set([
  "xclaw_file_read",
  "file_read",
  "read_file",
  "xclaw_file_list",
  "list_dir",
  "list_files",
  "xclaw_recall",
  "xclaw_swarm_merge_status",
]);

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
  "xclaw_browser_tab",
  "browser_tab",
  "xclaw_spawn_subagent",
  "xclaw_swarm_run",
  "xclaw_swarm_merge_approve",
  "xclaw_swarm_merge_reject",
]);

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isParallelSafeTool(name) {
  const n = String(name || "").toLowerCase();
  if (FORCE_SERIAL.has(n)) return false;
  if (PARALLEL_SAFE.has(n)) return true;
  // default serial — safer for unknown tools
  return false;
}

/**
 * Partition tool_calls into batches: consecutive parallel-safe tools share a batch.
 * @param {Array<{ function?: { name?: string } }>} calls
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

export default { isParallelSafeTool, partitionToolCalls, PARALLEL_SAFE, FORCE_SERIAL };

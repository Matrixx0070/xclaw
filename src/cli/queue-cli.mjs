/**
 * The queue subcommands that change what the worker does.
 *
 * Extracted from the switch in bin/xclaw.mjs so the decision can be tested at
 * all: a `case` block inside a 2000-line binary is untestable by construction,
 * and the behaviour it hid was that `xclaw queue pause` mutated a singleton in
 * its own process and printed it as though the gateway had obeyed.
 *
 * The rule the whole module encodes: the running gateway owns the worker. The
 * CLI asks it. If it cannot reach it, it says so and fails — it never performs
 * a local mutation that will vanish when this process exits three
 * milliseconds later.
 */
import { gatewayPost } from "./gateway-client.mjs";

/**
 * @param {object} cfg
 * @param {"pause"|"resume"|"add"} sub
 * @param {{goal?: string}} payload
 * @param {{fetchImpl?: Function, enqueueLocal?: Function}} deps
 * @returns {Promise<{ok: boolean, via?: "gateway"|"local", result?: any, note?: string, error?: string, exitCode?: number}>}
 */
export async function runQueueControl(cfg, sub, payload = {}, deps = {}) {
  const { fetchImpl = fetch, enqueueLocal = null } = deps;

  if (sub === "pause" || sub === "resume") {
    const r = await gatewayPost(cfg, `/queue/${sub}`, {}, { fetchImpl });
    if (!r.ok) {
      // Deliberately no local fallback. pauseQueue() here would return
      // {paused:true} from this process's own singleton and exit — which is
      // exactly the bug: an operator's stop that reads as delivered and isn't.
      return {
        ok: false,
        exitCode: 1,
        error: `${r.error} — cannot ${sub} the queue: no gateway is running to ${sub}`,
      };
    }
    return { ok: true, via: "gateway", result: r.body };
  }

  if (sub === "add") {
    // The whole payload crosses, not just the goal: `xclaw goal --harness`
    // sets grounding flags the owner must honour, and a field dropped in
    // transit turns a verified job into an unverified one that still reports
    // success. POST /queue accepts exactly what enqueueJob accepts.
    const r = await gatewayPost(cfg, "/queue", payload, { fetchImpl });
    // The gateway's POST /queue enqueues AND kicks its own worker. Enqueueing
    // from here instead only writes a file: the gateway arms its worker at
    // boot and re-arms it only while items remain, so a job appearing on disk
    // while it is idle is never picked up (measured: still "queued" after 1s).
    if (r.ok) return { ok: true, via: "gateway", result: r.body };
    if (!enqueueLocal) return { ok: false, exitCode: 1, error: r.error };
    const item = await enqueueLocal(cfg, payload);
    return {
      ok: true,
      via: "local",
      result: item,
      note: "queued to disk, but no gateway is running — it will start when the gateway does",
    };
  }

  return { ok: false, exitCode: 1, error: `unknown queue control: ${sub}` };
}

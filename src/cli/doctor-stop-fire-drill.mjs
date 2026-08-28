/**
 * Doctor: run single-port stop fire-drill (HTTP/WS/TLS/authMethod).
 *
 * This probe used to hand the drill `opts.root || process.cwd()`. The drill's
 * one on-disk step then looked for `<cwd>/src/gateway/tls.mjs`, which exists
 * only when the operator happens to be standing in a source checkout. From an
 * installed CLI the row read:
 *
 *   [WARN] ops.stop_fire_drill: stop fire-drill failed: tls_parity
 *
 * — or, under a prod/strict/requireAuth profile, the same line as an ERROR. A
 * red alarm on the kill-switch, raised by the working directory rather than by
 * anything wrong with the gateway. The drill now resolves that file relative to
 * its own module, so there is no root to pass.
 *
 * The message carries each failed step's reason too. `failed: tls_parity` alone
 * cannot distinguish "the TLS listener does not route /stop" — a real parity
 * breach — from "that file could not be read", and those want different
 * reactions from whoever is reading the row at 3am.
 */

/** "tls_parity(markers_absent), paths" — names alone hide why. */
export function describeFailedSteps(steps = [], failed = []) {
  const byName = new Map((steps || []).map((s) => [s?.name, s]));
  const parts = (failed || []).map((name) => {
    const reason = byName.get(name)?.reason;
    return reason ? `${name}(${reason})` : name;
  });
  return parts.join(",") || "unknown";
}

export async function pushStopFireDrillChecks(push, cfg = {}) {
  try {
    const { runStopFireDrill } = await import("../eval/stop-fire-drill.mjs");
    const r = await runStopFireDrill();
    if (r.ok) {
      push(
        "ops.stop_fire_drill",
        "ok",
        `stop fire-drill passed (${(r.steps || []).length} steps)`,
        { failed: [], steps: (r.steps || []).map((s) => s.name) }
      );
      return { status: "ok", ...r };
    }
    const prod =
      cfg.profile === "prod" ||
      cfg.profile === "strict" ||
      cfg.gateway?.requireAuth === true;
    const status = prod ? "error" : "warn";
    push(
      "ops.stop_fire_drill",
      status,
      `stop fire-drill failed: ${describeFailedSteps(r.steps, r.failed)}`,
      { failed: r.failed || [], steps: r.steps }
    );
    return { status, ...r };
  } catch (e) {
    push("ops.stop_fire_drill", "warn", e.message || String(e));
    return { status: "warn", error: e.message || String(e) };
  }
}

export default { pushStopFireDrillChecks, describeFailedSteps };

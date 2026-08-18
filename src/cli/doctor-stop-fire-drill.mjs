/**
 * Doctor: run single-port stop fire-drill (HTTP/WS/TLS/authMethod).
 */
export async function pushStopFireDrillChecks(push, cfg = {}, opts = {}) {
  try {
    const { runStopFireDrill } = await import("../eval/stop-fire-drill.mjs");
    const root = opts.root || process.cwd();
    const r = await runStopFireDrill({ root });
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
      `stop fire-drill failed: ${(r.failed || []).join(",") || "unknown"}`,
      { failed: r.failed || [], steps: r.steps }
    );
    return { status, ...r };
  } catch (e) {
    push("ops.stop_fire_drill", "warn", e.message || String(e));
    return { status: "warn", error: e.message || String(e) };
  }
}

export default { pushStopFireDrillChecks };

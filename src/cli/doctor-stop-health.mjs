/**
 * Doctor: stop kill-switch readiness (same as GET /health.stop).
 */
export async function pushStopHealthChecks(push, cfg = {}) {
  try {
    const { stopAuthReadiness } = await import("../gateway/stop-health.mjs");
    const r = stopAuthReadiness(cfg);
    const prod =
      cfg.profile === "prod" ||
      cfg.profile === "strict" ||
      cfg.gateway?.requireAuth === true;
    let status = "ok";
    if (!r.ready) status = prod ? "error" : "warn";
    else if (r.auth === "lab" && prod) status = "error";
    else if (r.hmac === "missing") status = prod ? "error" : "warn";
    push(
      "ops.stop_health",
      status,
      `stop auth=${r.auth} hmac=${r.hmac} ready=${r.ready}`,
      r
    );
    return { status, ...r };
  } catch (e) {
    push("ops.stop_health", "warn", e.message || String(e));
    return { status: "warn" };
  }
}

export default { pushStopHealthChecks };

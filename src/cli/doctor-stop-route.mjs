/**
 * Doctor: POST /stop helper + optional live probe.
 */
import { isStopPath } from "../gateway/stop-route.mjs";

export function stopRouteMounted(src = "") {
  return (
    src.includes("handleStopAll") ||
    src.includes("isStopPath") ||
    src.includes("/sessions/stop-all")
  );
}

export async function pushStopRouteChecks(push, cfg = {}) {
  let helperOk = false;
  try {
    const mod = await import("../gateway/stop-route.mjs");
    helperOk = typeof mod.handleStopAll === "function" && typeof mod.isStopPath === "function";
    if (helperOk && !isStopPath("/stop")) helperOk = false;
  } catch (e) {
    push("gateway.stopRoute", "warn", e.message || String(e), { helperOk: false });
    return { helperOk: false };
  }

  let mounted = helperOk;
  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const gw = path.join(process.cwd(), "src/gateway/index.mjs");
    if (fs.existsSync(gw)) {
      mounted = stopRouteMounted(fs.readFileSync(gw, "utf8"));
    }
  } catch {
    /* */
  }

  const status = helperOk ? (mounted ? "ok" : "warn") : "error";
  push(
    "gateway.stopRoute",
    status,
    helperOk
      ? mounted
        ? "POST /stop helper + gateway mount markers present"
        : "POST /stop helper present; gateway mount not detected (apply stop-route wire)"
      : "POST /stop helper missing",
    { helperOk, mounted, paths: ["/stop", "/xclaw/stop", "/sessions/stop-all"] }
  );
  return { helperOk, mounted };
}

export default { pushStopRouteChecks, stopRouteMounted };

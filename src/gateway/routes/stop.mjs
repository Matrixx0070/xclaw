/**
 * POST /stop — kill-switch on the main gateway router.
 */
import { handleStopAll, isStopPath } from "../stop-route.mjs";
import { isSinglePortStopPath } from "../stop-proxy.mjs";

export async function tryHandleStopRoute({ p, method, req, res, cfg, readBody }) {
  const path = p || "";
  if (!isStopPath(path) && !isSinglePortStopPath(path)) return false;
  if (String(method || req.method || "").toUpperCase() !== "POST") {
    res.writeHead(405, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "method_not_allowed", allow: "POST" }));
    return true;
  }
  // handleStopAll reads req.body only. The router parses bodies separately, so
  // without this the body is always {} and `dryRun: true` was ignored — a
  // dry-run kill-switch probe actually aborted every live session.
  const hasBody =
    req.body && typeof req.body === "object" && Object.keys(req.body).length > 0;
  if (!hasBody && typeof readBody === "function") {
    try {
      req.body = (await readBody(req)) || {};
    } catch {
      req.body = {};
    }
  }
  await handleStopAll(req, res, { cfg });
  return true;
}

export default { tryHandleStopRoute };

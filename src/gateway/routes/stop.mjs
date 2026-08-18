/**
 * POST /stop — kill-switch on the main gateway router.
 */
import { handleStopAll, isStopPath } from "../stop-route.mjs";
import { isSinglePortStopPath } from "../stop-proxy.mjs";

export async function tryHandleStopRoute({ p, method, req, res, cfg }) {
  const path = p || "";
  if (!isStopPath(path) && !isSinglePortStopPath(path)) return false;
  if (String(method || req.method || "").toUpperCase() !== "POST") {
    res.writeHead(405, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "method_not_allowed", allow: "POST" }));
    return true;
  }
  await handleStopAll(req, res, { cfg });
  return true;
}

export default { tryHandleStopRoute };

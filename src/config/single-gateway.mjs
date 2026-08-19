/**
 * Single-gateway is the default; cluster is opt-in.
 */
export function isSingleGateway(cfg = {}) {
  if (cfg?.cluster?.enabled === true) return false;
  if (cfg?.gateway?.mode === "cluster") return false;
  if (process.env.XCLAW_CLUSTER === "1") return false;
  return true;
}

export function resolveGatewayMode(cfg = {}) {
  return isSingleGateway(cfg) ? "single" : "cluster";
}

export default { isSingleGateway, resolveGatewayMode };

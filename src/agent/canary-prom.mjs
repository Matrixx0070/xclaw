import { renderCanaryMetrics } from "./canary-metrics.mjs";
import { renderTokenCacheMetrics } from "./token-cache-metrics.mjs";

export function renderAgentCoreProm() {
  return (
    renderCanaryMetrics() +
    (typeof renderTokenCacheMetrics === "function" ? renderTokenCacheMetrics() : "")
  );
}

export default { renderAgentCoreProm };

/**
 * The ONE way to build a configured provider from cfg.
 *
 * Provider construction is two steps — resolve the route (which picks the
 * provider family, model, baseUrl and credential), then build a client from
 * that route. Callers that skip step one get an unauthenticated OpenAI client
 * defaulting to gpt-4o-mini, which fails with HTTP 401 at first use. That is
 * exactly how post-mission reflection shipped broken in v3.179.0: it called
 * `createProvider(cfg)`, passing the config where the options bag was expected.
 *
 * Leaf module on purpose: `agent/provider.mjs` cannot host this, because
 * `providers/router.mjs` -> `providers/failover-router.mjs` imports back into
 * it and the cycle would put `createProvider` in the TDZ on the hot path.
 */
import { createProvider } from "./provider.mjs";
import { resolveProviderRouteAsync } from "../providers/router.mjs";

/**
 * Resolve the configured route and build its provider.
 *
 * @param {object} cfg full xclaw config
 * @param {object} [extra] per-caller client options (onRetry, convId,
 *   sessionId, conversationId, ...) merged over the routed defaults
 * @returns {Promise<{provider: object, route: object}>}
 */
export async function createRoutedProvider(cfg, extra = {}) {
  const route = await resolveProviderRouteAsync(cfg, {
    model: process.env.XCLAW_MODEL || cfg?.agent?.model,
    provider: process.env.XCLAW_PROVIDER || cfg?.agent?.provider,
  });
  const provider = createProvider({
    apiKey:
      route.apiKey ||
      cfg?.agent?.apiKey ||
      process.env.OPENAI_API_KEY ||
      process.env.XCLAW_API_KEY ||
      process.env.ANTHROPIC_API_KEY ||
      process.env.CLAUDE_CODE_OAUTH_TOKEN ||
      process.env.ANTHROPIC_AUTH_TOKEN,
    baseUrl: cfg?.agent?.baseUrl || process.env.XCLAW_API_BASE || route.baseUrl,
    model:
      route.model || process.env.XCLAW_MODEL || cfg?.agent?.model || "gpt-4o-mini",
    provider: route.provider,
    api: route.api,
    cfg,
    ...extra,
  });
  provider.providerName = route.provider;
  return { provider, route };
}

export default { createRoutedProvider };

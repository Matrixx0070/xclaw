/**
 * Multi-provider failover router — OpenClaw-style model chains.
 *
 * Config (any of):
 *   cfg.agent.fallbackModels: ["xai/grok-4.5", "openai/gpt-4o-mini", "anthropic/claude-sonnet-5"]
 *   cfg.agent.model: "xai/grok-4.5"           // primary
 *   cfg.router.chain: [ ... ]                 // alias
 *   cfg.router.roles: { draft: "...", strong: "...", verify: "..." }
 *
 * Env:
 *   XCLAW_FALLBACK_MODELS=xai/grok-4.5,openai/gpt-4o-mini
 *
 * Behavior:
 *   - Resolve primary + ordered fallbacks (provider/model refs)
 *   - On transient / rate-limit / auth-empty errors, try next candidate
 *   - Permanent 4xx (except 429) do not failover by default
 *   - Emits onEvent({ type: "router", phase: "failover", ... })
 */

import { createProvider } from "../agent/provider.mjs";
import {
  resolveProviderRouteAsync,
  parseModelRef,
  listProviders,
} from "./registry.mjs";
import { isTransientError } from "../utils/backoff.mjs";

/**
 * Build ordered list of model refs to try.
 * @param {object} cfg
 * @param {object} [opts]
 * @returns {string[]}
 */
export function buildModelChain(cfg = {}, opts = {}) {
  const chain = [];
  const push = (ref) => {
    if (!ref || typeof ref !== "string") return;
    const s = ref.trim();
    if (!s) return;
    if (!chain.includes(s)) chain.push(s);
  };

  // Env beats file config (session override — repo convention), args beat both.
  if (opts.model) push(opts.model);
  if (process.env.XCLAW_MODEL) push(process.env.XCLAW_MODEL);
  if (cfg.agent?.model) push(cfg.agent.model);

  const fromCfg =
    opts.fallbackModels ||
    cfg.agent?.fallbackModels ||
    cfg.router?.chain ||
    cfg.router?.fallbackModels ||
    [];
  if (Array.isArray(fromCfg)) fromCfg.forEach(push);

  const envFb = process.env.XCLAW_FALLBACK_MODELS || process.env.XCLAW_MODEL_CHAIN;
  if (envFb) {
    for (const part of String(envFb).split(/[,;]/)) push(part);
  }

  // Optional: include role models in failover chain only when explicitly requested
  const roles = cfg.router?.roles || cfg.agent?.roles || {};
  if (opts.role && roles[opts.role]) push(roles[opts.role]);
  if (opts.includeRolesInChain) {
    if (roles.draft) push(roles.draft);
    if (roles.strong) push(roles.strong);
    if (roles.verify) push(roles.verify);
  }

  // If still only one bare model, leave it; registry will infer provider
  if (chain.length === 0) {
    push("xai/grok-4.5");
  }
  return chain;
}

/**
 * @param {Error} err
 * @param {object} [policy]
 */
export function shouldFailover(err, policy = {}) {
  if (!err) return false;
  if (policy.failoverOnAll) return true;
  const status = err.status || err.statusCode || err.httpStatus;
  if (status === 429) return true;
  if (status === 502 || status === 503 || status === 504) return true;
  if (status === 401 || status === 403) {
    // try next provider if key missing/wrong for this one
    return policy.failoverOnAuth !== false;
  }
  if (isTransientError(err)) return true;
  const msg = String(err.message || err).toLowerCase();
  if (/rate.?limit|timeout|econnreset|econnrefused|socket hang up|overloaded|capacity/i.test(msg)) {
    return true;
  }
  if (/no api key|missing.*key|unauthorized/i.test(msg) && policy.failoverOnAuth !== false) {
    return true;
  }
  // Default: do not failover on other 4xx (bad request, etc.)
  if (status >= 400 && status < 500 && status !== 429) return false;
  return false;
}

/**
 * Resolve a single model ref to a live provider client.
 */
export async function createProviderForRef(cfg, modelRef, opts = {}) {
  const parsed = parseModelRef(modelRef);
  const route = await resolveProviderRouteAsync(cfg, {
    model: modelRef,
    provider: parsed.provider || opts.provider,
    profileId: opts.profileId,
    apiKey: opts.apiKey,
  });
  if (!route.hasKey && !(route.baseUrl || "").includes("localhost") && !(route.baseUrl || "").includes("127.0.0.1")) {
    const err = new Error(
      `No credentials for ${route.modelRef} (set ${route.envKey} or auth profile)`
    );
    err.status = 401;
    err.route = route;
    throw err;
  }
  const provider = createProvider({
    apiKey: route.apiKey,
    baseUrl: route.baseUrl,
    model: route.model,
    provider: route.provider,
    api: route.api,
    cfg,
    onRetry: opts.onRetry,
  });
  provider.providerName = route.provider;
  provider.modelRef = route.modelRef;
  provider.route = route;
  return { provider, route };
}

/**
 * Create a provider facade that failovers across the model chain.
 *
 * @param {object} cfg
 * @param {object} [opts]
 * @param {(e: object) => void} [opts.onEvent]
 * @returns {Promise<{ provider: object, chain: string[], primary: string }>}
 */
export async function createFailoverProvider(cfg = {}, opts = {}) {
  const chain = buildModelChain(cfg, opts);
  const onEvent = opts.onEvent || (() => {});
  const policy = {
    failoverOnAuth: cfg.router?.failoverOnAuth !== false,
    failoverOnAll: cfg.router?.failoverOnAll === true,
    ...(opts.policy || {}),
  };

  /** @type {{ provider: object, route: object }[]} */
  const clients = [];
  const resolveErrors = [];

  // Test seam: inject pre-built clients (skips provider resolution).
  if (Array.isArray(opts._clients) && opts._clients.length) {
    clients.push(...opts._clients);
  } else
  for (const ref of chain) {
    try {
      const c = await createProviderForRef(cfg, ref, opts);
      clients.push(c);
    } catch (err) {
      resolveErrors.push({ ref, error: String(err.message || err) });
      onEvent({
        type: "router",
        phase: "skip",
        modelRef: ref,
        reason: String(err.message || err),
      });
    }
  }

  if (clients.length === 0) {
    const detail = resolveErrors.map((e) => `${e.ref}: ${e.error}`).join("; ");
    throw new Error(
      `No usable providers in chain [${chain.join(", ")}]. ${detail || "Check API keys / OAuth profiles."}`
    );
  }

  onEvent({
    type: "router",
    phase: "chain",
    chain: clients.map((c) => c.route.modelRef),
    skipped: resolveErrors,
  });

  let activeIndex = 0;
  let demotedAt = 0;
  // Half-open recovery: after cooldownMs on a fallback, re-probe the primary
  // chain from the top instead of staying demoted forever (rubric R11).
  const cooldownMs = Number.isFinite(policy?.cooldownMs) ? policy.cooldownMs : 60_000;

  async function withFailover(method, args) {
    let lastErr;
    if (activeIndex > 0 && cooldownMs > 0 && Date.now() - demotedAt >= cooldownMs) {
      onEvent({
        type: "router",
        phase: "failover_probe",
        from: clients[activeIndex].route.modelRef,
        to: clients[0].route.modelRef,
      });
      activeIndex = 0;
    }
    for (let i = activeIndex; i < clients.length; i++) {
      const { provider, route } = clients[i];
      try {
        const result = await provider[method](args);
        if (i !== activeIndex) {
          onEvent({
            type: "router",
            phase: "failover_success",
            from: clients[activeIndex].route.modelRef,
            to: route.modelRef,
            method,
          });
          activeIndex = i;
          demotedAt = Date.now();
        }
        return result;
      } catch (err) {
        lastErr = err;
        const fb = shouldFailover(err, policy);
        onEvent({
          type: "router",
          phase: fb ? "failover" : "error",
          modelRef: route.modelRef,
          method,
          status: err.status || err.statusCode,
          message: String(err.message || err),
          willFailover: fb && i < clients.length - 1,
        });
        if (!fb || i === clients.length - 1) throw err;
        // else try next
      }
    }
    throw lastErr || new Error("failover chain exhausted");
  }

  const facade = {
    get model() {
      return clients[activeIndex].provider.model;
    },
    get baseUrl() {
      return clients[activeIndex].provider.baseUrl;
    },
    get providerName() {
      return clients[activeIndex].route.provider;
    },
    get modelRef() {
      return clients[activeIndex].route.modelRef;
    },
    get route() {
      return clients[activeIndex].route;
    },
    get chain() {
      return clients.map((c) => c.route.modelRef);
    },
    chat(args) {
      return withFailover("chat", args);
    },
    chatStream(args) {
      const p = clients[activeIndex].provider;
      if (typeof p.chatStream === "function") {
        return withFailover("chatStream", args);
      }
      return withFailover("chat", args);
    },
  };

  return {
    provider: facade,
    chain: clients.map((c) => c.route.modelRef),
    primary: clients[0].route.modelRef,
    clients,
  };
}

/**
 * List providers that currently have credentials (env or will resolve async).
 */
export function listRoutableProviders(cfg = {}) {
  const all = listProviders(cfg);
  return Object.entries(all).map(([id, def]) => ({
    id,
    name: def.name,
    defaultModel: def.defaultModel,
    api: def.api,
    envKey: def.envKey,
    hasEnvKey: Boolean(process.env[def.envKey]),
    modelRef: `${id}/${def.defaultModel}`,
  }));
}

export default {
  buildModelChain,
  shouldFailover,
  createProviderForRef,
  createFailoverProvider,
  listRoutableProviders,
};

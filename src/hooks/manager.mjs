/**
 * Hook system — dynamic registration + execution of custom functions at key
 * points in the agent lifecycle.
 *
 * Categories (execution points in src/agent/loop.mjs):
 *   pre_process  — before the conversation is assembled; may rewrite the
 *                  incoming message, or (system tier) abort the run
 *   on_request   — before every model request (each turn)
 *   on_response  — after every model response
 *   post_process — after the final text is produced; may transform it
 *   on_error     — when the loop fails (before the error propagates)
 *
 * Permission tiers (capability, not identity):
 *   system  — full context (cfg included, live messages array on request
 *             hooks), may mutate any whitelisted field AND abort a run
 *   trusted — redacted context (no cfg/secrets), may mutate whitelisted
 *             fields (message/text), cannot abort
 *   user    — read-only sanitized context; return value is ignored
 *
 * Config (cfg.hooks):
 *   enabled: false            — kill-switch for the whole system (default on)
 *   categories: {pre_process: false, …} — disable per category
 *   timeoutMs: 2000           — per-hook budget; slow hooks are cut off
 *   log: true                 — emit hook:executed log lines
 *   modules: [{path, tier?}]  — ESM modules loaded at first use; each exports
 *                               register(manager). Registrations are CAPPED at
 *                               the tier the OPERATOR assigned in config
 *                               (default "user") — a module cannot self-elevate.
 *
 * Every hook failure is contained: logged, reported in results, never thrown
 * into the agent. executeAll never rejects.
 */

export const HOOK_CATEGORIES = [
  "pre_process",
  "post_process",
  "on_error",
  "on_request",
  "on_response",
];

export const HOOK_TIERS = ["system", "trusted", "user"];
const TIER_RANK = { system: 3, trusted: 2, user: 1 };

const DEFAULT_TIMEOUT_MS = 2000;
const HISTORY_LIMIT = 200;

/** Strip secret-bearing / oversized values from a hook context per tier. */
function contextForTier(context, tier) {
  if (tier === "system") return context; // full access, live references
  const { cfg, messages, ...rest } = context;
  if (tier === "trusted") return rest;
  // user: read-only snapshot — break references so mutation can't leak in
  const out = {};
  for (const [k, v] of Object.entries(rest)) {
    if (typeof v === "string") out[k] = v.length > 2000 ? v.slice(0, 2000) : v;
    else if (v == null || typeof v === "number" || typeof v === "boolean") out[k] = v;
    else {
      try {
        out[k] = JSON.parse(JSON.stringify(v));
      } catch {
        /* unserializable — omit */
      }
    }
  }
  return out;
}

export class HookManager {
  /**
   * @param {object} [opts]
   * @param {object} [opts.cfg]      — full config; cfg.hooks drives gating
   * @param {Function} [opts.logger] — (entry) => void; default console when
   *                                   cfg.hooks.log !== false
   */
  constructor(opts = {}) {
    this.cfg = opts.cfg || {};
    this._seq = 0;
    /** @type {Map<string, Array<{id,name,tier,fn,registeredAt}>>} */
    this._hooks = new Map(HOOK_CATEGORIES.map((c) => [c, []]));
    this._history = [];
    this._modulesLoaded = null; // promise once loading starts
    const wantLog = this.cfg.hooks?.log !== false;
    this._logger =
      opts.logger ||
      ((entry) => {
        if (wantLog) console.log(`[xclaw:hooks] ${JSON.stringify(entry)}`);
      });
  }

  get timeoutMs() {
    const t = Number(this.cfg.hooks?.timeoutMs);
    return Number.isFinite(t) && t > 0 ? t : DEFAULT_TIMEOUT_MS;
  }

  /** Global + per-category enablement (config-driven, checked at run time). */
  enabled(category) {
    if (this.cfg.hooks?.enabled === false) return false;
    if (category && this.cfg.hooks?.categories?.[category] === false) return false;
    return true;
  }

  /**
   * Register a hook.
   * @param {string} category — one of HOOK_CATEGORIES
   * @param {Function} fn — (context) => void|object|Promise. Return values
   *   from system/trusted hooks merge into mutable fields; user returns are
   *   ignored.
   * @param {{name?: string, tier?: string, maxTier?: string}} [opts]
   *   maxTier caps the effective tier (used by the module loader so a config
   *   entry, not the module itself, decides trust).
   * @returns {string} hook id (for removeHook)
   */
  registerHook(category, fn, opts = {}) {
    if (!HOOK_CATEGORIES.includes(category)) {
      throw new Error(
        `unknown hook category "${category}" (valid: ${HOOK_CATEGORIES.join(", ")})`
      );
    }
    if (typeof fn !== "function") {
      throw new Error(`hook must be callable, got ${typeof fn}`);
    }
    if (fn.length > 1) {
      throw new Error(
        `hook "${opts.name || fn.name || "anonymous"}" must accept a single context argument (arity ${fn.length})`
      );
    }
    let tier = opts.tier || "user";
    if (!HOOK_TIERS.includes(tier)) {
      throw new Error(`unknown tier "${tier}" (valid: ${HOOK_TIERS.join(", ")})`);
    }
    if (opts.maxTier && TIER_RANK[tier] > TIER_RANK[opts.maxTier]) {
      // never allow escalation past the cap; clamp and log
      this._log({ event: "tier_clamped", name: opts.name, requested: tier, capped: opts.maxTier });
      tier = opts.maxTier;
    }
    const id = `hk_${++this._seq}`;
    const name = String(opts.name || fn.name || id).slice(0, 80);
    this._hooks.get(category).push({ id, name, tier, fn, registeredAt: Date.now() });
    this._log({ event: "registered", category, name, tier, id });
    return id;
  }

  /** Remove by id, or by category+name. Returns count removed. */
  removeHook(idOrCategory, name) {
    let removed = 0;
    for (const [cat, list] of this._hooks) {
      const before = list.length;
      const keep = list.filter((h) =>
        name != null ? !(cat === idOrCategory && h.name === name) : h.id !== idOrCategory
      );
      removed += before - keep.length;
      this._hooks.set(cat, keep);
    }
    if (removed) this._log({ event: "removed", target: name ? `${idOrCategory}/${name}` : idOrCategory, removed });
    return removed;
  }

  /** List registered hooks (no fn refs). */
  listHooks(category) {
    const out = [];
    for (const [cat, list] of this._hooks) {
      if (category && cat !== category) continue;
      for (const h of list) out.push({ id: h.id, category: cat, name: h.name, tier: h.tier });
    }
    return out;
  }

  clear() {
    for (const c of HOOK_CATEGORIES) this._hooks.set(c, []);
  }

  /** Execution log (ring buffer, newest last). */
  history(limit = 50) {
    return this._history.slice(-limit);
  }

  _log(entry) {
    const rec = { at: new Date().toISOString(), ...entry };
    this._history.push(rec);
    while (this._history.length > HISTORY_LIMIT) this._history.shift();
    try {
      this._logger(rec);
    } catch {
      /* logger failures never propagate */
    }
  }

  /**
   * Execute all hooks of a category, in registration order.
   * @param {string} category
   * @param {object} context — shared payload; whitelisted fields may be
   *   mutated by system/trusted hooks via returned objects
   * @param {{mutable?: string[]}} [opts]
   * @returns {Promise<{context: object, abort: string|null, results: Array}>}
   *   NEVER rejects — hook failures land in results[i].error.
   */
  async executeAll(category, context = {}, opts = {}) {
    const results = [];
    let abort = null;
    if (!this.enabled(category)) {
      return { context, abort, results, skipped: "disabled" };
    }
    await this._ensureModules();
    const mutable = opts.mutable || [];
    for (const hook of this._hooks.get(category) || []) {
      const t0 = Date.now();
      const rec = { category, name: hook.name, tier: hook.tier, ok: true, ms: 0 };
      try {
        const view = contextForTier(context, hook.tier);
        let timer;
        const ret = await Promise.race([
          Promise.resolve(hook.fn(view)),
          new Promise((_, rej) => {
            timer = setTimeout(
              () => rej(new Error(`hook timed out after ${this.timeoutMs}ms`)),
              this.timeoutMs
            );
          }),
        ]).finally(() => clearTimeout(timer));

        if (ret && typeof ret === "object" && hook.tier !== "user") {
          // abort is system-only; trusted attempts are logged and ignored
          if (ret.abort != null) {
            if (hook.tier === "system") {
              abort = String(ret.abort);
              rec.aborted = true;
            } else {
              rec.abortIgnored = true;
            }
          }
          const mutated = [];
          for (const field of mutable) {
            if (field in ret && ret[field] !== undefined && field !== "abort") {
              context[field] = ret[field];
              mutated.push(field);
            }
          }
          if (mutated.length) rec.mutated = mutated;
        }
      } catch (err) {
        rec.ok = false;
        rec.error = String(err?.message || err);
      }
      rec.ms = Date.now() - t0;
      results.push(rec);
      this._log({ event: "executed", ...rec });
      if (abort) break; // a system abort stops the chain
    }
    return { context, abort, results };
  }

  /** Load cfg.hooks.modules once (operator-declared, tier-capped). */
  _ensureModules() {
    if (this._modulesLoaded) return this._modulesLoaded;
    const modules = this.cfg.hooks?.modules || [];
    this._modulesLoaded = (async () => {
      for (const entry of modules) {
        const spec = typeof entry === "string" ? { path: entry } : entry || {};
        if (!spec.path) continue;
        const maxTier = HOOK_TIERS.includes(spec.tier) ? spec.tier : "user";
        try {
          const mod = await import(spec.path);
          const register = mod.register || mod.default;
          if (typeof register !== "function") {
            throw new Error("module exports no register(manager) function");
          }
          // capped facade: whatever the module asks for is clamped to maxTier
          register({
            registerHook: (cat, fn, o = {}) =>
              this.registerHook(cat, fn, { ...o, maxTier }),
          });
          this._log({ event: "module_loaded", path: spec.path, maxTier });
        } catch (err) {
          this._log({
            event: "module_error",
            path: spec.path,
            error: String(err?.message || err),
          });
        }
      }
    })();
    return this._modulesLoaded;
  }
}

export function createHookManager(opts = {}) {
  return new HookManager(opts);
}

/** Shared instance (per process), rebuilt when cfg identity changes. */
let _shared = null;
let _sharedCfg = null;
export function getSharedHookManager(cfg = {}) {
  if (!_shared || _sharedCfg !== cfg) {
    _shared = new HookManager({ cfg });
    _sharedCfg = cfg;
  }
  return _shared;
}
export function resetSharedHookManager(cfg = {}) {
  _shared = new HookManager({ cfg });
  _sharedCfg = cfg;
  return _shared;
}

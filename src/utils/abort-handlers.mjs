/**
 * Custom AbortSignal handlers — ordered cleanup when a signal fires.
 *
 * Features:
 *   - Register multiple handlers per signal (LIFO or FIFO)
 *   - Once / multi-fire protection
 *   - Async handlers with optional timeout
 *   - Nested scopes (parent abort → child abort)
 *   - Safe: handler errors don't block other handlers
 *
 * Usage:
 *   const stop = onAbort(signal, () => closeDb());
 *   // later: stop() to unregister
 *
 *   await withAbortScope(signal, async (scope) => {
 *     scope.onAbort(() => worker.kill());
 *     await work();
 *   });
 */

function isAbortErrorLocal(err, signal) {
  if (signal?.aborted) return true;
  if (!err) return false;
  if (err.name === "AbortError") return true;
  const msg = String(err.message || err);
  return /abort/i.test(msg);
}

/**
 * @typedef {object} AbortHandlerOptions
 * @property {boolean} [once=true] — remove after first run
 * @property {'lifo'|'fifo'} [order='lifo'] — only used when registering into a Scope
 * @property {string} [label] — for diagnostics
 * @property {number} [timeoutMs] — max time for async handler
 */

/**
 * Normalize abort reason to Error.
 * @param {any} reason
 * @returns {Error}
 */
export function toAbortError(reason) {
  if (reason instanceof Error) return reason;
  if (reason == null) return new Error("aborted");
  return new Error(typeof reason === "string" ? reason : String(reason));
}

/**
 * Create an already-aborted signal (spec: AbortSignal.abort(reason)).
 * Prefers native AbortSignal.abort when available.
 *
 * @param {any} [reason]
 * @returns {AbortSignal}
 *
 * @example
 * const signal = abortSignal(new Error("cancelled"));
 * signal.aborted // true
 * signal.reason  // Error
 */
export function abortSignal(reason) {
  const r = reason === undefined ? new Error("aborted") : reason;
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.abort === "function") {
    try {
      return AbortSignal.abort(r);
    } catch {
      /* fall through — some environments reject non-DOMException reasons */
    }
  }
  const controller = new AbortController();
  try {
    controller.abort(toAbortError(r));
  } catch {
    try {
      controller.abort();
    } catch {
      /* */
    }
  }
  return controller.signal;
}

/**
 * Abort a controller with a normalized Error reason.
 * Safe no-op if already aborted or controller is null.
 *
 * @param {AbortController | null | undefined} controller
 * @param {any} [reason]
 * @returns {boolean} true if abort was invoked
 */
export function abort(controller, reason) {
  if (!controller || controller.signal?.aborted) return false;
  try {
    controller.abort(toAbortError(reason ?? "aborted"));
    return true;
  } catch {
    try {
      controller.abort();
      return true;
    } catch {
      return false;
    }
  }
}


/**
 * Register a handler on an AbortSignal.
 * If already aborted, runs handler immediately (microtask for sync parity).
 *
 * @param {AbortSignal} signal
 * @param {(info: { reason: any, signal: AbortSignal }) => void | Promise<void>} handler
 * @param {AbortHandlerOptions} [opts]
 * @returns {() => void} unsubscribe
 */
export function onAbort(signal, handler, opts = {}) {
  if (!signal || typeof handler !== "function") {
    return () => {};
  }
  const once = opts.once !== false;
  const label = opts.label || "abort-handler";
  const timeoutMs =
    Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 0;

  let active = true;
  let ran = false;

  const run = async () => {
    if (!active) return;
    if (once && ran) return;
    ran = true;
    const reason = signal.reason;
    try {
      const ret = handler({ reason, signal, label });
      if (ret && typeof ret.then === "function") {
        if (timeoutMs > 0) {
          await Promise.race([
            ret,
            new Promise((_, rej) =>
              setTimeout(
                () => rej(new Error(`abort handler timeout: ${label}`)),
                timeoutMs
              )
            ),
          ]);
        } else {
          await ret;
        }
      }
    } catch (e) {
      console.warn(
        `[xclaw:abort] handler "${label}" failed:`,
        e?.message || e
      );
    }
    if (once) {
      cleanup();
    }
  };

  const onSignal = () => {
    void run();
  };

  function cleanup() {
    if (!active) return;
    active = false;
    try {
      signal.removeEventListener("abort", onSignal);
    } catch {
      /* */
    }
  }

  if (signal.aborted) {
    // Defer so callers can finish setup (register sibling handlers first)
    queueMicrotask(() => {
      if (active) void run();
    });
  } else {
    signal.addEventListener("abort", onSignal, { once });
  }

  return cleanup;
}

/**
 * Abort scope: collect handlers, run on abort in LIFO order by default.
 */
export class AbortScope {
  /**
   * @param {AbortSignal} [signal]
   * @param {{ order?: 'lifo'|'fifo', parent?: AbortScope }} [opts]
   */
  constructor(signal, opts = {}) {
    this.signal = signal || null;
    this.order = opts.order === "fifo" ? "fifo" : "lifo";
    /** @type {{ handler: Function, label: string, timeoutMs: number }[]} */
    this._handlers = [];
    this._unsubSignal = null;
    this._fired = false;
    this._parentUnsub = null;

    if (signal) {
      this._unsubSignal = onAbort(signal, (info) => this._fire(info), {
        once: true,
        label: "AbortScope",
      });
    }
    if (opts.parent instanceof AbortScope) {
      this._parentUnsub = opts.parent.onAbort(() => {
        this.abort(new Error("parent_scope_aborted"));
      }, { label: "child-of-parent" });
    }
  }

  /**
   * Register cleanup. Returns unsubscribe.
   * @param {(info: object) => void | Promise<void>} handler
   * @param {AbortHandlerOptions} [opts]
   */
  onAbort(handler, opts = {}) {
    const entry = {
      handler,
      label: opts.label || "scope-handler",
      timeoutMs: Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 0,
    };
    this._handlers.push(entry);
    return () => {
      const i = this._handlers.indexOf(entry);
      if (i >= 0) this._handlers.splice(i, 1);
    };
  }

  /**
   * Manually abort this scope (also aborts linked controller if set).
   * @param {any} reason
   */
  abort(reason) {
    if (this._controller && !this._controller.signal.aborted) {
      try {
        this._controller.abort(toAbortError(reason));
      } catch {
        this._controller.abort();
      }
    } else {
      void this._fire({ reason, signal: this.signal });
    }
  }

  /**
   * Attach an AbortController owned by this scope.
   * @param {AbortController} [controller]
   * @returns {AbortController}
   */
  ownController(controller) {
    this._controller = controller || new AbortController();
    this.signal = this._controller.signal;
    if (this._unsubSignal) this._unsubSignal();
    this._unsubSignal = onAbort(
      this.signal,
      (info) => this._fire(info),
      { once: true, label: "AbortScope.own" }
    );
    return this._controller;
  }

  async _fire(info) {
    if (this._fired) return;
    this._fired = true;
    const list =
      this.order === "fifo"
        ? [...this._handlers]
        : [...this._handlers].reverse();
    this._handlers.length = 0;

    for (const entry of list) {
      try {
        const ret = entry.handler({
          ...info,
          label: entry.label,
        });
        if (ret && typeof ret.then === "function") {
          if (entry.timeoutMs > 0) {
            await Promise.race([
              ret,
              new Promise((_, rej) =>
                setTimeout(
                  () =>
                    rej(new Error(`abort handler timeout: ${entry.label}`)),
                  entry.timeoutMs
                )
              ),
            ]);
          } else {
            await ret;
          }
        }
      } catch (e) {
        console.warn(
          `[xclaw:abort] scope handler "${entry.label}" failed:`,
          e?.message || e
        );
      }
    }
  }

  /** Detach listeners without firing */
  dispose() {
    if (this._unsubSignal) this._unsubSignal();
    if (this._parentUnsub) this._parentUnsub();
    this._handlers.length = 0;
  }
}

/**
 * Run async work with an abort scope. Handlers fire on signal abort or throw of abort error.
 * Always disposes the scope.
 *
 * @template T
 * @param {AbortSignal | null} signal
 * @param {(scope: AbortScope) => Promise<T>} fn
 * @param {{ order?: 'lifo'|'fifo' }} [opts]
 * @returns {Promise<T>}
 */
export async function withAbortScope(signal, fn, opts = {}) {
  const scope = new AbortScope(signal || undefined, opts);
  try {
    return await fn(scope);
  } catch (err) {
    if (isAbortErrorLocal(err, signal) || signal?.aborted) {
      await scope._fire({ reason: signal?.reason || err, signal });
    }
    throw err;
  } finally {
    scope.dispose();
  }
}

/**
 * Link child controller to parent signal (parent abort → child abort).
 * @param {AbortSignal} parent
 * @param {AbortController} child
 * @param {string} [reason]
 * @returns {() => void} unlink
 */
export function linkAbort(parent, child, reason = "parent_aborted") {
  if (!parent || !child) return () => {};
  if (parent.aborted) {
    try {
      child.abort(toAbortError(parent.reason || reason));
    } catch {
      child.abort();
    }
    return () => {};
  }
  return onAbort(
    parent,
    ({ reason: r }) => {
      if (!child.signal.aborted) {
        try {
          child.abort(toAbortError(r || reason));
        } catch {
          child.abort();
        }
      }
    },
    { once: true, label: "linkAbort" }
  );
}

/**
 * Safe abort with original reason (spec passes reason through as-is).
 * @param {AbortController} controller
 * @param {any} reason
 */
function abortWithReason(controller, reason) {
  if (!controller || controller.signal.aborted) return;
  try {
    if (reason === undefined) {
      controller.abort();
    } else {
      controller.abort(reason);
    }
  } catch {
    try {
      controller.abort();
    } catch {
      /* */
    }
  }
}

/**
 * Spec-aligned AbortSignal.any(iterable) implementation.
 * Returns only an AbortSignal (same shape as the platform static method).
 *
 * Rules (DOM):
 *  - Empty iterable → signal that never aborts
 *  - Any input already aborted → return already-aborted signal with that reason
 *  - Otherwise abort when the first input aborts; copy that reason
 *
 * @param {Iterable<AbortSignal>} [iterable]
 * @returns {AbortSignal}
 */
export function abortSignalAny(iterable = []) {
  const list = [];
  try {
    for (const s of iterable || []) {
      if (s != null) list.push(s);
    }
  } catch {
    throw new TypeError("abortSignalAny: iterable required");
  }

  // Prefer native
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function") {
    try {
      return AbortSignal.any(list);
    } catch {
      /* polyfill below */
    }
  }

  // Empty → never aborts
  if (list.length === 0) {
    return new AbortController().signal;
  }

  // Already aborted → snapshot reason
  for (const s of list) {
    if (s.aborted) {
      const c = new AbortController();
      abortWithReason(c, s.reason);
      return c.signal;
    }
  }

  // Single signal: still wrap so dispose/lifetime is independent of the source
  // (spec creates a new dependent signal; returning identity is an allowed optimization
  // but wrapping is safer for listener cleanup bookkeeping).
  const controller = new AbortController();
  const unsubs = [];

  const onOneAbort = (reason) => {
    if (controller.signal.aborted) return;
    abortWithReason(controller, reason);
    // detach remaining listeners
    for (const u of unsubs) {
      try {
        u();
      } catch {
        /* */
      }
    }
    unsubs.length = 0;
  };

  for (const s of list) {
    if (typeof s.addEventListener !== "function") {
      throw new TypeError("abortSignalAny: all entries must be AbortSignals");
    }
    const handler = () => onOneAbort(s.reason);
    s.addEventListener("abort", handler, { once: true });
    unsubs.push(() => {
      try {
        s.removeEventListener("abort", handler);
      } catch {
        /* */
      }
    });
  }

  // Attach weak cleanup marker for optional dispose via anySignal wrapper
  controller.signal.__xclawAnyUnsubs = unsubs;

  return controller.signal;
}

/**
 * Combine signals with optional dispose (library-friendly wrapper).
 * @param {AbortSignal[]} signals
 * @returns {{ signal: AbortSignal, controller: AbortController | null, native: boolean, dispose: () => void }}
 */
export function anySignal(signals = []) {
  const list = (signals || []).filter(Boolean);

  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function" && list.length >= 0) {
    try {
      const signal = AbortSignal.any(list);
      return { signal, controller: null, native: true, dispose: () => {} };
    } catch {
      /* polyfill */
    }
  }

  const signal = abortSignalAny(list);
  const unsubs = signal.__xclawAnyUnsubs || [];
  return {
    signal,
    controller: null,
    native: false,
    dispose: () => {
      for (const u of unsubs) {
        try {
          u();
        } catch {
          /* */
        }
      }
      unsubs.length = 0;
    },
  };
}

/**
 * Install AbortSignal.any polyfill on the global if missing.
 * @returns {boolean} true if installed (was missing)
 */
export function installAbortSignalAny() {
  if (typeof AbortSignal === "undefined") return false;
  if (typeof AbortSignal.any === "function") return false;
  AbortSignal.any = function any(iterable) {
    return abortSignalAny(iterable);
  };
  return true;
}

/**
 * Timeout signal — native AbortSignal.timeout when available.
 * @param {number} ms
 * @returns {{ signal: AbortSignal, dispose: () => void, native: boolean }}
 */
/**
 * Build a TimeoutError reason (DOMException when available).
 * @param {number} ms
 * @returns {Error|DOMException}
 */
export function createTimeoutError(ms) {
  const msg =
    ms != null
      ? `The operation was aborted due to timeout after ${ms}ms`
      : "The operation was aborted due to timeout";
  if (typeof DOMException === "function") {
    try {
      return new DOMException(msg, "TimeoutError");
    } catch {
      /* some environments reject non-standard names */
    }
  }
  return Object.assign(new Error(msg), { name: "TimeoutError", code: 23 });
}

/**
 * Spec-aligned AbortSignal.timeout(ms).
 * Returns only an AbortSignal.
 *
 * - Prefer native AbortSignal.timeout
 * - Polyfill: setTimeout → abort(TimeoutError); timer.unref when available
 * - ms === 0 → abort ASAP (spec)
 * - invalid ms → TypeError
 *
 * @param {number} ms
 * @returns {AbortSignal}
 */
export function abortSignalTimeout(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) {
    throw new TypeError(
      `abortSignalTimeout: ms must be in [0, Number.MAX_SAFE_INTEGER], got ${ms}`
    );
  }

  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    try {
      return AbortSignal.timeout(n);
    } catch {
      /* polyfill */
    }
  }

  const controller = new AbortController();
  const fire = () => {
    if (!controller.signal.aborted) {
      try {
        controller.abort(createTimeoutError(n));
      } catch {
        try {
          controller.abort();
        } catch {
          /* */
        }
      }
    }
  };

  if (n === 0) {
    // ASAP — queueMicrotask keeps ordering predictable vs sync callers
    queueMicrotask(fire);
  } else {
    const timer = setTimeout(fire, n);
    if (typeof timer.unref === "function") timer.unref();
    // stash for optional dispose via timeoutSignal wrapper
    controller.signal.__xclawTimeoutId = timer;
  }

  return controller.signal;
}

/**
 * Library wrapper around abortSignalTimeout with dispose (clears polyfill timer).
 * @param {number} ms
 * @returns {{ signal: AbortSignal, dispose: () => void, native: boolean, controller?: AbortController }}
 */
export function timeoutSignal(ms) {
  const n = Number(ms);

  // Preserve previous "no timeout" behavior for non-positive when used as optional helper
  // (createNestedSignal passes only timeoutMs > 0). Explicit 0 still times out via abortSignalTimeout.
  if (!(n > 0) && n !== 0) {
    return { signal: new AbortController().signal, dispose: () => {}, native: false };
  }

  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" && n > 0) {
    try {
      return { signal: AbortSignal.timeout(n), dispose: () => {}, native: true };
    } catch {
      /* polyfill */
    }
  }

  try {
    const signal = abortSignalTimeout(n);
    const timer = signal.__xclawTimeoutId;
    return {
      signal,
      native: false,
      dispose: () => {
        if (timer) clearTimeout(timer);
      },
    };
  } catch (e) {
    // invalid ms — never-abort signal for soft helper path
    return { signal: new AbortController().signal, dispose: () => {}, native: false };
  }
}

/**
 * Install AbortSignal.timeout on the global if missing.
 * @returns {boolean} true if installed
 */
export function installAbortSignalTimeout() {
  if (typeof AbortSignal === "undefined") return false;
  if (typeof AbortSignal.timeout === "function") return false;
  AbortSignal.timeout = function timeout(ms) {
    return abortSignalTimeout(ms);
  };
  return true;
}

/**
 * Nested signal: child aborts when parent aborts and/or timeout elapses.
 * Local abort does NOT abort the parent.
 *
 * @param {AbortSignal | null | undefined} parent
 * @param {{
 *   timeoutMs?: number,
 *   reason?: string,
 *   controller?: AbortController,
 * }} [opts]
 * @returns {{
 *   signal: AbortSignal,
 *   controller: AbortController,
 *   dispose: () => void,
 *   parent: AbortSignal | null,
 *   sources: string[],
 * }}
 *
 * @example
 * const nest = createNestedSignal(reqSignal, { timeoutMs: 30_000 });
 * try {
 *   await work({ signal: nest.signal });
 * } finally {
 *   nest.dispose();
 * }
 */
export function createNestedSignal(parent, opts = {}) {
  const controller = opts.controller || new AbortController();
  const sources = ["local"];
  const disposers = [];

  // Link parent → child (not the reverse)
  if (parent) {
    sources.push("parent");
    disposers.push(linkAbort(parent, controller, opts.reason || "parent_aborted"));
  }

  // Optional timeout as additional source
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 0;
  if (timeoutMs > 0) {
    sources.push("timeout");
    const to = timeoutSignal(timeoutMs);
    disposers.push(
      linkAbort(to.signal, controller, `timeout after ${timeoutMs}ms`),
      to.dispose
    );
  }

  // If parent already aborted, child is aborted via linkAbort; ensure reason
  if (parent?.aborted && !controller.signal.aborted) {
    try {
      controller.abort(toAbortError(parent.reason || opts.reason || "parent_aborted"));
    } catch {
      controller.abort();
    }
  }

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const d of disposers) {
      try {
        d();
      } catch {
        /* */
      }
    }
  };

  return {
    signal: controller.signal,
    controller,
    dispose,
    parent: parent || null,
    sources,
    /** Convenience: abort only the nested controller */
    abort(reason) {
      if (!controller.signal.aborted) {
        try {
          controller.abort(toAbortError(reason || "nested_abort"));
        } catch {
          controller.abort();
        }
      }
    },
  };
}

/**
 * Nested AbortScope: scope whose signal is nested under a parent.
 * @param {AbortSignal | null} parent
 * @param {{ timeoutMs?: number, order?: 'lifo'|'fifo' }} [opts]
 */
export function createNestedScope(parent, opts = {}) {
  const nest = createNestedSignal(parent, { timeoutMs: opts.timeoutMs });
  const scope = new AbortScope(nest.signal, { order: opts.order });
  scope.ownController(nest.controller);
  const prevDispose = scope.dispose.bind(scope);
  scope.dispose = () => {
    prevDispose();
    nest.dispose();
  };
  scope.nested = nest;
  return scope;
}

export default {
  onAbort,
  AbortScope,
  withAbortScope,
  linkAbort,
  anySignal,
  abortSignalAny,
  installAbortSignalAny,
  timeoutSignal,
  abortSignalTimeout,
  createTimeoutError,
  installAbortSignalTimeout,
  createNestedSignal,
  createNestedScope,
  toAbortError,
  abortSignal,
  abort,
};

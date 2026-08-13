/**
 * Example hooks — one per permission tier. Register them all with
 * registerExampleHooks(manager), or cherry-pick.
 *
 * These double as living documentation for what each tier can (and cannot)
 * do; the hooks test suite executes them.
 */

/**
 * SYSTEM tier — redact credential-shaped strings from the agent's final
 * output before it reaches any channel. Needs post_process mutation rights
 * and is trusted with the full context.
 */
export function redactSecretsHook(context) {
  const text = context.text || "";
  const redacted = text
    .replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, "sk-ant-[REDACTED]")
    .replace(/xai-[A-Za-z0-9]{8,}/g, "xai-[REDACTED]")
    .replace(/xclaw_[A-Za-z0-9]{16,}/g, "xclaw_[REDACTED]")
    .replace(/gh[pousr]_[A-Za-z0-9]{20,}/g, "gh_[REDACTED]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]{16,}=*/g, "$1[REDACTED]");
  return redacted !== text ? { text: redacted } : undefined;
}

/**
 * TRUSTED tier — annotate the incoming message with the current date/time so
 * the model always knows "now" without a tool call. May rewrite the message
 * but sees no cfg/secrets and cannot abort the run.
 */
export function timestampContextHook(context) {
  const msg = context.message || "";
  if (!msg || msg.includes("[context:")) return undefined;
  return { message: `${msg}\n\n[context: current time is ${new Date().toISOString()}]` };
}

/**
 * USER tier — pure observer: measures model round-trips. Its return value is
 * ignored by design; it sees a sanitized read-only context copy.
 */
export function createTimingLoggerHook(sink = console) {
  const started = new Map();
  return {
    onRequest(context) {
      started.set(context.turn, Date.now());
    },
    onResponse(context) {
      const t0 = started.get(context.turn);
      if (t0 != null) {
        started.delete(context.turn);
        sink.log?.(
          `[hook:timing] turn ${context.turn} model round-trip ${Date.now() - t0}ms (finish=${context.finishReason || "?"})`
        );
      }
    },
  };
}

/** Register all examples with their intended tiers. */
export function registerExampleHooks(manager, { sink } = {}) {
  const timing = createTimingLoggerHook(sink);
  return [
    manager.registerHook("post_process", redactSecretsHook, {
      name: "redact-secrets",
      tier: "system",
    }),
    manager.registerHook("pre_process", timestampContextHook, {
      name: "timestamp-context",
      tier: "trusted",
    }),
    manager.registerHook("on_request", timing.onRequest, {
      name: "timing-logger",
      tier: "user",
    }),
    manager.registerHook("on_response", timing.onResponse, {
      name: "timing-logger",
      tier: "user",
    }),
  ];
}

/**
 * Bind safety: the gateway must never listen beyond loopback without auth.
 *
 * Loopback (127.x / ::1 / localhost) may run tokenless (low-setup lab).
 * Any other bind requires a gateway token, unless the operator explicitly
 * opts out with XCLAW_GATEWAY_ALLOW_OPEN=1 (trusted private networks).
 */

const LOOPBACK_RE = /^(127\.|::1$|localhost$)/i;

export function isLoopbackHost(host) {
  return LOOPBACK_RE.test(String(host || "").trim());
}

/**
 * @param {object} cfg loaded config
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function assertBindSafety(cfg = {}) {
  const host = cfg?.gateway?.host || "127.0.0.1";
  if (isLoopbackHost(host)) return { ok: true };
  const token = cfg?.gateway?.token || process.env.XCLAW_GATEWAY_TOKEN || null;
  if (token) return { ok: true };
  const allowOpen = ["1", "true", "yes"].includes(
    String(process.env.XCLAW_GATEWAY_ALLOW_OPEN || "").toLowerCase()
  );
  if (allowOpen) return { ok: true };
  return {
    ok: false,
    error:
      `refusing to bind gateway on ${host} without auth. ` +
      `Set XCLAW_GATEWAY_TOKEN (e.g. openssl rand -hex 32) or gateway.token in config, ` +
      `or export XCLAW_GATEWAY_ALLOW_OPEN=1 to run open on a trusted network.`,
  };
}

export default { isLoopbackHost, assertBindSafety };

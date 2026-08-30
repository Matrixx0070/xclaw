/**
 * The CLI's connection to a running gateway.
 *
 * The CLI process and the gateway process share the queue *directory*, but not
 * the queue *worker* — that is a module-level singleton, and a singleton is
 * per-process. Any CLI command that means "change what the worker is doing"
 * has to travel over HTTP or it changes nothing.
 *
 * The base-URL shape (`cfg.gateway.host || 127.0.0.1`, `cfg.gateway.port ||
 * 18790`) is currently open-coded in eight other places; this module is the
 * one copy the queue path uses. Migrating the rest is a separate cleanup.
 */

/** @returns {string} e.g. "http://127.0.0.1:18790" */
export function gatewayBaseUrl(cfg = {}) {
  const host = cfg.gateway?.host || "127.0.0.1";
  const port = cfg.gateway?.port || 18790;
  return `http://${host}:${port}`;
}

/**
 * POST to the gateway. Never throws: a caller that cannot reach the owner must
 * be able to say so, and saying so is the whole point of this module.
 *
 * Default timeoutMs is 4000 (queue pause/resume). Do not change it — agent/job
 * handoff passes HANDOFF_TIMEOUT_MS explicitly.
 *
 * @returns {Promise<{ok: boolean, status?: number, body?: any, error?: string}>}
 */
export async function gatewayPost(cfg = {}, path = "/", body = {}, opts = {}) {
  return gatewayRequest(cfg, path, { ...opts, method: "POST", body: body ?? {} });
}

/**
 * GET from the gateway. Never throws. Default timeout is short (probe, not a
 * running agent). Do not reuse this default for agent/job handoff.
 *
 * @returns {Promise<{ok: boolean, status?: number, body?: any, error?: string}>}
 */
export async function gatewayGet(cfg = {}, path = "/", opts = {}) {
  const { timeoutMs = 3000, ...rest } = opts;
  return gatewayRequest(cfg, path, { ...rest, method: "GET", timeoutMs });
}

async function gatewayRequest(cfg = {}, path = "/", opts = {}) {
  const { fetchImpl = fetch, timeoutMs = 4000, method = "POST", body } = opts;
  const token = cfg.gateway?.token || null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const headers = {};
    if (method !== "GET") headers["content-type"] = "application/json";
    if (token) headers.authorization = `Bearer ${token}`;
    const init = { method, signal: ac.signal, headers };
    if (method !== "GET") init.body = JSON.stringify(body ?? {});
    const res = await fetchImpl(`${gatewayBaseUrl(cfg)}${path}`, init);
    const parsed = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, status: res.status, body: parsed, error: `gateway returned ${res.status}` };
    }
    return { ok: true, status: res.status, body: parsed };
  } catch (err) {
    return { ok: false, error: `gateway unreachable: ${String(err?.message || err)}` };
  } finally {
    clearTimeout(timer);
  }
}

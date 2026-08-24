/**
 * Shared HTTP helper for swarm-ext data plugins — REAL API calls only.
 *
 * Every plugin constructor accepts { fetchImpl } so tests inject a fake and
 * CI never touches the network.
 *
 * UA note: SEC's WAF rejects any User-Agent containing a URL (tested
 * 2026-08-24: "+https://..." forms get 403, plain descriptive forms get 200),
 * so the UA is a plain product string with no URL.
 */
export const PLUGIN_UA = "Mozilla/5.0 (compatible; xclaw-swarm research tool)";

export function makeHttp(fetchImpl) {
  const f = fetchImpl || ((...a) => globalThis.fetch(...a));
  return async function getJson(url, { headers = {}, timeoutMs = 25_000 } = {}) {
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await f(url, {
        headers: { "User-Agent": PLUGIN_UA, Accept: "application/json", ...headers },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
      });
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      if (res.ok) {
        if (json === null) throw new Error(`non-JSON response from ${new URL(url).host}`);
        return json;
      }
      const detail = json?.error?.message || json?.message || text.slice(0, 200);
      lastErr = new Error(`HTTP ${res.status} from ${new URL(url).host}: ${detail}`);
      // Retry once on rate-limit / transient upstream errors, honoring
      // Retry-After (capped) — Semantic Scholar's shared pool 429s freely.
      if ((res.status === 429 || res.status === 503) && attempt === 0) {
        const ra = Number(res.headers?.get?.("retry-after")) || 2;
        await new Promise((r) => setTimeout(r, Math.min(ra, 8) * 1000));
        continue;
      }
      break;
    }
    throw lastErr;
  };
}

/** Bound arrays so tool output stays LLM-context-sized. */
export function capList(arr, n) {
  if (!Array.isArray(arr)) return arr;
  return arr.length > n ? arr.slice(0, n) : arr;
}

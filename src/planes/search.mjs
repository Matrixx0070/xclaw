/**
 * T4 — Search plane: allowlisted HTTP search only (no shell).
 *
 * Providers (first available):
 *   1. BRAVE_API_KEY / XCLAW_BRAVE_API_KEY → Brave Search API
 *   2. Fallback: DuckDuckGo lite HTML (no key)
 *
 * Egress: only hosts in SEARCH_ALLOW_HOSTS — independent of bash egress.
 */
import { getPlane } from "../tools/planes.mjs";

export const SEARCH_ALLOW_HOSTS = [
  "api.search.brave.com",
  "html.duckduckgo.com",
  "duckduckgo.com",
  "api.duckduckgo.com",
];

/**
 * @param {string} url
 * @returns {boolean}
 */
export function isSearchHostAllowed(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return SEARCH_ALLOW_HOSTS.some(
      (h) => host === h || host.endsWith("." + h)
    );
  } catch {
    return false;
  }
}

/**
 * @param {string} url
 * @param {object} [opts]
 */
async function allowedFetch(url, opts = {}) {
  if (!isSearchHostAllowed(url)) {
    throw new Error(`search plane egress denied for host: ${url}`);
  }
  const ctrl = new AbortController();
  const ms = Math.min(30_000, Number(opts.timeoutMs) || 15_000);
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: opts.signal || ctrl.signal,
      headers: {
        "user-agent": "XClawSearchPlane/1.0",
        ...(opts.headers || {}),
      },
    });
    return res;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Brave web search.
 * @param {string} query
 * @param {number} limit
 */
async function braveSearch(query, limit = 5) {
  const key =
    process.env.XCLAW_BRAVE_API_KEY ||
    process.env.BRAVE_API_KEY ||
    "";
  if (!key) return null;
  const u = new URL("https://api.search.brave.com/res/v1/web/search");
  u.searchParams.set("q", query);
  u.searchParams.set("count", String(Math.min(20, Math.max(1, limit))));
  const res = await allowedFetch(u.toString(), {
    headers: { Accept: "application/json", "X-Subscription-Token": key },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Brave search HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const results = (data.web?.results || []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.description || r.extra_snippets?.[0] || "",
  }));
  return { provider: "brave", query, results };
}

/**
 * DuckDuckGo lite HTML scrape (no API key). Best-effort.
 * @param {string} query
 * @param {number} limit
 */
async function ddgSearch(query, limit = 5) {
  const u = new URL("https://html.duckduckgo.com/html/");
  u.searchParams.set("q", query);
  const res = await allowedFetch(u.toString(), {
    method: "GET",
    headers: { accept: "text/html" },
  });
  if (!res.ok) {
    throw new Error(`DuckDuckGo HTTP ${res.status}`);
  }
  const html = await res.text();
  const results = [];
  // result links: <a rel="nofollow" class="result__a" href="...">title</a>
  const re =
    /class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]*)</gi;
  let m;
  while ((m = re.exec(html)) && results.length < limit) {
    let href = m[1];
    // DDG redirect URLs
    try {
      const ru = new URL(href, "https://duckduckgo.com");
      if (ru.hostname.includes("duckduckgo") && ru.searchParams.get("uddg")) {
        href = decodeURIComponent(ru.searchParams.get("uddg"));
      }
    } catch {
      /* keep href */
    }
    results.push({
      title: m[2].trim(),
      url: href,
      snippet: "",
    });
  }
  return { provider: "duckduckgo", query, results };
}

/**
 * Execute web search on the search plane.
 * @param {object} args
 * @param {string} args.query
 * @param {number} [args.limit]
 * @returns {Promise<object>}
 */
export async function runWebSearch(args = {}) {
  const query = String(args.query || args.q || args.input || "").trim();
  if (!query) {
    return {
      ok: false,
      isError: true,
      content: [{ type: "text", text: "query is required" }],
    };
  }
  const limit = Math.min(20, Math.max(1, Number(args.limit) || 5));

  let out = null;
  let err = null;
  try {
    out = await braveSearch(query, limit);
  } catch (e) {
    err = e;
  }
  if (!out) {
    try {
      out = await ddgSearch(query, limit);
    } catch (e) {
      err = e;
    }
  }
  if (!out) {
    return {
      ok: false,
      isError: true,
      content: [
        {
          type: "text",
          text: `search plane failed: ${err?.message || "no provider"}`,
        },
      ],
    };
  }

  const lines = out.results.map(
    (r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet || ""}`.trimEnd()
  );
  const text =
    `Search (${out.provider}) for: ${query}\n\n` +
    (lines.join("\n\n") || "(no results)");

  return {
    ok: true,
    provider: out.provider,
    query: out.query,
    results: out.results,
    content: [{ type: "text", text }],
  };
}

/**
 * Whether this tool name is handled by the search plane.
 * @param {string} name
 */
export function isSearchPlaneTool(name) {
  const n = String(name || "").toLowerCase();
  return getPlane(n) === "search" || n === "web_search" || n === "xclaw_web_search";
}

/**
 * OpenAI-style tool descriptors for agent registration.
 */
export function searchPlaneToolsAsOpenAI() {
  return [
    {
      type: "function",
      function: {
        name: "web_search",
        description:
          "Search the public web (search plane: allowlisted hosts only, no shell). Returns titles, URLs, snippets.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            limit: { type: "number", description: "Max results (default 5)" },
          },
          required: ["query"],
        },
      },
    },
  ];
}

export default {
  SEARCH_ALLOW_HOSTS,
  isSearchHostAllowed,
  runWebSearch,
  isSearchPlaneTool,
  searchPlaneToolsAsOpenAI,
};

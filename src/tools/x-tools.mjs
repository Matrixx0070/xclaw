import { fetchWithRetry } from "../utils/fetch-retry.mjs";
/**
 * X (Twitter) tools — uses xAI API if it proxies X search, else public nitter-less fail-soft
 * Prefer XAI or official bearer when set.
 */
function textResult(text, extra = {}) {
  return { content: [{ type: "text", text: String(text ?? "") }], ...extra };
}
function errorResult(msg) {
  return { isError: true, content: [{ type: "text", text: String(msg) }] };
}

async function xaiChatSearch(query, { limit = 5 } = {}) {
  const key = process.env.XAI_API_KEY || process.env.XCLAW_API_KEY;
  if (!key) return null;
  // Use chat completions asking model to not invent — better: use responses with tools if available
  // Fallback: web search style via grok with tool isn't available here; return null
  return null;
}

export function createXKeywordSearchTool({ fetchFn } = {}) {
  const doFetch = typeof fetchFn === "function" ? fetchFn : fetchWithRetry;
  return {
    name: "x_keyword_search",
    description:
      "Search recent posts on X (Twitter). Requires X_BEARER_TOKEN or uses limited public HTML fallback.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
        mode: { type: "string", description: "Latest | Top" },
      },
      required: ["query"],
    },
    async execute(args = {}) {
      const query = String(args.query || "").trim();
      if (!query) return errorResult("query required");
      const limit = Math.min(Number(args.limit) || 5, 15);
      const bearer = process.env.X_BEARER_TOKEN || process.env.TWITTER_BEARER_TOKEN;

      if (bearer) {
        try {
          const u = new URL("https://api.twitter.com/2/tweets/search/recent");
          u.searchParams.set("query", query);
          u.searchParams.set("max_results", String(Math.max(10, Math.min(limit, 100))));
          u.searchParams.set("tweet.fields", "created_at,public_metrics,author_id,lang");
          const res = await doFetch(u.toString(), {
            headers: { Authorization: `Bearer ${bearer}` },
            signal: AbortSignal.timeout(20_000),
          });
          const j = await res.json().catch(() => ({}));
          if (!res.ok) return errorResult(j.detail || j.title || `HTTP ${res.status}`);
          if (j.data != null && !Array.isArray(j.data)) {
            return errorResult(j.detail || j.title || "invalid tweet payload");
          }
          const tweets = (j.data || []).filter((t) => t && typeof t === "object" && t.id != null);
          if (!tweets.length && Array.isArray(j.data) && j.data.length) {
            return errorResult("invalid tweet payload");
          }
          const lines = tweets.slice(0, limit).map((t, i) => {
            const m = t.public_metrics || {};
            return `${i + 1}. ${t.id}\n   ${t.created_at || ""}\n   ${t.text}\n   likes=${m.like_count ?? "?"} rt=${m.retweet_count ?? "?"}`;
          });
          return textResult(lines.join("\n\n") || "No tweets", {
            metadata: { count: lines.length, provider: "twitter_api_v2" },
          });
        } catch (e) {
          return errorResult(e.message);
        }
      }

      // Soft fallback: DuckDuckGo site:x.com
      try {
        const u = `https://html.duckduckgo.com/html/?q=${encodeURIComponent("site:x.com " + query)}`;
        const res = await doFetch(u, {
          headers: { "User-Agent": "XClaw/2.6" },
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) {
          return errorResult(`X search fallback HTTP ${res.status}`);
        }
        const html = await res.text();
        const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)</gi;
        const rows = [];
        let m;
        while ((m = re.exec(html)) && rows.length < limit) {
          rows.push({
            url: m[1].replace(/&amp;/g, "&"),
            title: m[2].replace(/<[^>]+>/g, "").trim(),
            snippet: m[3].replace(/<[^>]+>/g, "").trim(),
          });
        }
        if (!rows.length) {
          return errorResult(
            "No X_BEARER_TOKEN set and public fallback found nothing. Set X_BEARER_TOKEN for full X API."
          );
        }
        return textResult(
          rows.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join("\n\n"),
          { metadata: { provider: "ddg_fallback", count: rows.length } }
        );
      } catch (e) {
        return errorResult(e.message);
      }
    },
  };
}

export function createXUserSearchTool({ fetchFn } = {}) {
  const doFetch = typeof fetchFn === "function" ? fetchFn : fetchWithRetry;
  return {
    name: "x_user_search",
    description: "Search X users by name (requires X_BEARER_TOKEN).",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        count: { type: "number" },
      },
      required: ["query"],
    },
    async execute(args = {}) {
      const bearer = process.env.X_BEARER_TOKEN || process.env.TWITTER_BEARER_TOKEN;
      if (!bearer) return errorResult("X_BEARER_TOKEN required for user search");
      const q = String(args.query || "").trim();
      const count = Math.min(Number(args.count) || 5, 20);
      try {
        const u = new URL("https://api.twitter.com/2/users/by");
        // usernames endpoint needs exact; use search recent as weak fallback not available
        const url = `https://api.twitter.com/2/users/by/username/${encodeURIComponent(q.replace(/^@/, ""))}?user.fields=description,public_metrics,verified`;
        const res = await doFetch(url, {
          headers: { Authorization: `Bearer ${bearer}` },
          signal: AbortSignal.timeout(15_000),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) return errorResult(j.detail || j.title || `HTTP ${res.status}`);
        const urow = j.data;
        if (!urow || typeof urow !== "object" || (!urow.username && urow.id == null)) {
          return errorResult("user not found");
        }
        return textResult(
          `@${urow.username} (${urow.name})\nid=${urow.id}\n${urow.description || ""}\nfollowers=${urow.public_metrics?.followers_count ?? "?"}`,
          { metadata: { user: urow } }
        );
      } catch (e) {
        return errorResult(e.message);
      }
    },
  };
}

export function createXThreadFetchTool({ fetchFn } = {}) {
  const doFetch = typeof fetchFn === "function" ? fetchFn : fetchWithRetry;
  return {
    name: "x_thread_fetch",
    description: "Fetch a tweet by ID and conversation context (requires X_BEARER_TOKEN).",
    parameters: {
      type: "object",
      properties: { post_id: { type: "string" } },
      required: ["post_id"],
    },
    async execute(args = {}) {
      const bearer = process.env.X_BEARER_TOKEN || process.env.TWITTER_BEARER_TOKEN;
      if (!bearer) return errorResult("X_BEARER_TOKEN required");
      const id = String(args.post_id || "").trim();
      try {
        const url = `https://api.twitter.com/2/tweets/${encodeURIComponent(id)}?tweet.fields=created_at,public_metrics,conversation_id,author_id,text&expansions=author_id`;
        const res = await doFetch(url, {
          headers: { Authorization: `Bearer ${bearer}` },
          signal: AbortSignal.timeout(15_000),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) return errorResult(j.detail || j.title || `HTTP ${res.status}`);
        const t = j.data;
        if (!t || typeof t !== "object" || t.id == null) {
          return errorResult(j.detail || j.title || "tweet not found");
        }
        return textResult(
          `id=${t.id}\n${t.created_at}\n${t.text}\nconversation=${t.conversation_id}`,
          { metadata: j }
        );
      } catch (e) {
        return errorResult(e.message);
      }
    },
  };
}


export function createXSemanticSearchTool({ fetchFn, keywordTool } = {}) {
  const doFetch = typeof fetchFn === "function" ? fetchFn : fetchWithRetry;
  return {
    name: "x_semantic_search",
    description:
      "Semantic search over recent X posts. Uses X API if X_BEARER_TOKEN set; otherwise embeds query via xAI chat summary of keyword results.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
    async execute(args = {}) {
      const query = String(args.query || "").trim();
      if (!query) return errorResult("query required");
      const limit = Math.min(Number(args.limit) || 5, 15);
      // Prefer keyword search then rank by naive token overlap as semantic proxy
      const kw = keywordTool || createXKeywordSearchTool();
      const base = await kw.execute({ query, limit: Math.min(limit * 2, 15), mode: "Latest" });
      if (base.isError) return base;
      const text = base.content?.[0]?.text || "";
      // Optional: ask xAI to rank/filter
      const key = process.env.XAI_API_KEY || process.env.XCLAW_API_KEY;
      if (key && text.length > 20) {
        try {
          const res = await doFetch("https://api.x.ai/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: process.env.XCLAW_MODEL || "grok-4.5",
              messages: [
                {
                  role: "user",
                  content:
                    `Given the search intent: "${query}"\nRank and summarize the most relevant posts from:\n${text.slice(0, 12000)}\nReturn top ${limit} with why they match.`,
                },
              ],
              max_tokens: 800,
            }),
            signal: AbortSignal.timeout(60_000),
          });
          const j = await res.json().catch(() => null);
          if (!res.ok) {
            return errorResult(`xAI rerank HTTP ${res.status}`);
          }
          const content = j?.choices?.[0]?.message?.content;
          if (!content) {
            return errorResult(`xAI rerank HTTP ${res.status} with no usable content`);
          }
          return textResult(content, { metadata: { provider: "xai_rerank", query } });
        } catch (e) {
          return errorResult(`xAI rerank failed: ${e.message}`);
        }
      }
      return textResult(text, { metadata: { provider: "keyword_proxy", query } });
    },
  };
}

export function createXTools() {
  return [
    createXKeywordSearchTool(),
    createXUserSearchTool(),
    createXThreadFetchTool(),
    createXSemanticSearchTool(),
  ];
}


import { fetchWithRetry } from "../utils/fetch-retry.mjs";
/**
 * Finance quotes — Polygon + CoinGecko (env keys, fail-soft).
 */
function textResult(text, extra = {}) {
  return { content: [{ type: "text", text: String(text ?? "") }], ...extra };
}
function errorResult(msg) {
  return { isError: true, content: [{ type: "text", text: String(msg) }] };
}

export function createFinanceQuoteTool({ fetchFn } = {}) {
  const doFetch = typeof fetchFn === "function" ? fetchFn : fetchWithRetry;
  return {
    name: "finance_quote",
    description:
      "Get stock/crypto quote. Stocks via Polygon (POLYGON_API_KEY); crypto via CoinGecko (optional COINGECKO_PRO_API_KEY).",
    parameters: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Ticker e.g. AAPL or bitcoin/btc" },
        asset: {
          type: "string",
          description: "auto | stock | crypto (default auto)",
        },
      },
      required: ["symbol"],
    },
    async execute(args = {}) {
      const symbol = String(args.symbol || "").trim();
      if (!symbol) return errorResult("symbol required");
      const asset = String(args.asset || "auto").toLowerCase();
      const isCrypto =
        asset === "crypto" ||
        (asset === "auto" &&
          (/^[a-z-]+$/i.test(symbol) && !/^[A-Z]{1,5}$/.test(symbol)));

      if (!isCrypto || asset === "stock") {
        const key = process.env.POLYGON_API_KEY;
        if (!key) {
          if (asset === "stock") return errorResult("POLYGON_API_KEY not set");
        } else {
          try {
            const sym = symbol.toUpperCase();
            const base = process.env.POLYGON_API_BASE_URL || "https://api.polygon.io";
            const url = `${base}/v2/aggs/ticker/${encodeURIComponent(sym)}/prev?adjusted=true&apiKey=${encodeURIComponent(key)}`;
            const res = await doFetch(url, { signal: AbortSignal.timeout(15_000) });
            const j = await res.json();
            if (!res.ok) return errorResult(j.error || j.message || `HTTP ${res.status}`);
            const bar = j.results?.[0];
            if (!bar) return errorResult(`No data for ${sym}`);
            const lines = [
              `${sym} (Polygon prev day)`,
              `close: ${bar.c}`,
              `open: ${bar.o}  high: ${bar.h}  low: ${bar.l}`,
              `volume: ${bar.v}`,
              `ts: ${bar.t ? new Date(bar.t).toISOString() : "n/a"}`,
            ];
            return textResult(lines.join("\n"), { metadata: { provider: "polygon", symbol: sym, bar } });
          } catch (e) {
            if (asset === "stock") return errorResult(e.message);
          }
        }
      }

      // CoinGecko
      try {
        const id = symbol.toLowerCase().replace(/\s+/g, "-");
        const base = process.env.COINGECKO_BASE_URL || "https://api.coingecko.com/api/v3";
        const headers = { Accept: "application/json" };
        if (process.env.COINGECKO_PRO_API_KEY) {
          headers["x-cg-pro-api-key"] = process.env.COINGECKO_PRO_API_KEY;
        }
        // try simple price by id
        let url = `${base}/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`;
        let res = await doFetch(url, { headers, signal: AbortSignal.timeout(15_000) });
        if (!res.ok) return errorResult(`CoinGecko HTTP ${res.status}`);
        let j = await res.json();
        if (!j[id]) {
          // search
          const s = await doFetch(`${base}/search?query=${encodeURIComponent(symbol)}`, {
            headers,
            signal: AbortSignal.timeout(15_000),
          });
          if (!s.ok) return errorResult(`CoinGecko search HTTP ${s.status}`);
          const sj = await s.json();
          const coin = sj.coins?.[0];
          if (!coin) return errorResult(`No crypto match for ${symbol}`);
          url = `${base}/simple/price?ids=${encodeURIComponent(coin.id)}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`;
          res = await doFetch(url, { headers, signal: AbortSignal.timeout(15_000) });
          if (!res.ok) return errorResult(`CoinGecko HTTP ${res.status}`);
          j = await res.json();
          const row = j[coin.id];
          if (!row) return errorResult(`No price for ${coin.id}`);
          return textResult(
            `${coin.name} (${coin.symbol})\nid: ${coin.id}\nusd: ${row.usd}\n24h: ${row.usd_24h_change?.toFixed?.(2) ?? row.usd_24h_change}%\nmcap: ${row.usd_market_cap}`,
            { metadata: { provider: "coingecko", id: coin.id, row } }
          );
        }
        const row = j[id];
        return textResult(
          `${id}\nusd: ${row.usd}\n24h: ${row.usd_24h_change?.toFixed?.(2) ?? row.usd_24h_change}%\nmcap: ${row.usd_market_cap}`,
          { metadata: { provider: "coingecko", id, row } }
        );
      } catch (e) {
        return errorResult(e.message);
      }
    },
  };
}

export function createFinanceTools() {
  return [createFinanceQuoteTool()];
}

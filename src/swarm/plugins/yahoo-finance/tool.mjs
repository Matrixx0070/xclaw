/**
 * Yahoo Finance Tool — REAL stock quotes and historical data via the keyless
 * Yahoo chart API (query1.finance.yahoo.com/v8/finance/chart).
 */
import { makeHttp, capList } from "../../plugins-lib/http.mjs";

const BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

export class YahooFinanceTool {
  constructor({ fetchImpl } = {}) {
    this.name = "yahoo_finance";
    this.description =
      "Fetch REAL stock quotes, historical prices, dividends, and company info from Yahoo Finance. Supports quote, history, info, dividends.";
    this._get = makeHttp(fetchImpl);
    this.parameters = {
      symbol: { type: "string", description: "Stock ticker symbol (e.g., AAPL, TSLA)", required: true },
      data_type: { type: "string", description: "quote, history, info, dividends", default: "quote" },
      period: { type: "string", description: "1d, 5d, 1mo, 3mo, 6mo, 1y, 5y", default: "1mo" },
      interval: { type: "string", description: "1m, 5m, 15m, 60m, 1d, 1wk, 1mo", default: "1d" },
    };
  }

  getSchema() {
    return {
      type: "function",
      function: {
        name: this.name,
        description: this.description,
        parameters: {
          type: "object",
          properties: {
            symbol: { type: "string", description: "Stock ticker symbol" },
            data_type: { type: "string", enum: ["quote", "history", "info", "dividends"], default: "quote" },
            period: { type: "string", enum: ["1d", "5d", "1mo", "3mo", "6mo", "1y", "5y"], default: "1mo" },
            interval: { type: "string", enum: ["1m", "5m", "15m", "60m", "1d", "1wk", "1mo"], default: "1d" },
          },
          required: ["symbol"],
        },
      },
    };
  }

  async execute({ symbol, data_type = "quote", period = "1mo", interval = "1d" } = {}) {
    try {
      const sym = String(symbol || "").trim().toUpperCase();
      if (!sym || !/^[A-Z0-9.^=-]{1,12}$/.test(sym)) {
        return { success: false, error: "invalid symbol" };
      }
      const range = data_type === "quote" || data_type === "info" ? "1d" : period;
      const events = data_type === "dividends" ? "&events=div" : "";
      const url = `${BASE}/${encodeURIComponent(sym)}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}${events}`;
      const j = await this._get(url);
      const r = j?.chart?.result?.[0];
      if (!r) {
        return { success: false, error: j?.chart?.error?.description || `no data for ${sym}` };
      }
      const meta = r.meta || {};

      if (data_type === "quote" || data_type === "info") {
        const data = {
          symbol: meta.symbol,
          name: meta.longName || meta.shortName,
          currency: meta.currency,
          exchange: meta.fullExchangeName || meta.exchangeName,
          instrumentType: meta.instrumentType,
          price: meta.regularMarketPrice,
          previousClose: meta.chartPreviousClose ?? meta.previousClose,
          dayHigh: meta.regularMarketDayHigh,
          dayLow: meta.regularMarketDayLow,
          volume: meta.regularMarketVolume,
          fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
          fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
          marketTime: meta.regularMarketTime
            ? new Date(meta.regularMarketTime * 1000).toISOString()
            : undefined,
          source: "yahoo-finance chart API (live)",
        };
        return { success: true, data };
      }

      if (data_type === "dividends") {
        const div = r.events?.dividends || {};
        const rows = Object.values(div)
          .map((d) => ({ date: new Date(d.date * 1000).toISOString().slice(0, 10), amount: d.amount }))
          .sort((a, b) => a.date.localeCompare(b.date));
        return {
          success: true,
          data: { symbol: sym, period, dividends: capList(rows, 60), total: rows.length },
        };
      }

      // history
      const ts = r.timestamp || [];
      const q = r.indicators?.quote?.[0] || {};
      const rows = ts.map((t, i) => ({
        date: new Date(t * 1000).toISOString().slice(0, interval.endsWith("m") ? 16 : 10),
        open: q.open?.[i],
        high: q.high?.[i],
        low: q.low?.[i],
        close: q.close?.[i],
        volume: q.volume?.[i],
      }));
      return {
        success: true,
        data: { symbol: sym, period, interval, bars: capList(rows, 120), total: rows.length },
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
}

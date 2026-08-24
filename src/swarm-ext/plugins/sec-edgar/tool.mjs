/**
 * SEC EDGAR Tool — REAL filings + XBRL company facts from data.sec.gov.
 * Keyless; SEC fair-access policy requires a descriptive User-Agent (set in
 * plugins-lib/http.mjs) and modest request rates.
 */
import { makeHttp, capList } from "../../plugins-lib/http.mjs";

const TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";

// SCAFFOLD: www.sec.gov (the ticker->CIK index file) is IP-blocked from some
// datacenter ranges incl. this host (data.sec.gov itself is NOT blocked,
// verified 2026-08-24). Fallback map of major tickers keeps the tool useful
// there; any ticker outside the map still works by passing the numeric CIK.
const FALLBACK_CIKS = {
  AAPL: 320193, MSFT: 789019, GOOGL: 1652044, GOOG: 1652044, AMZN: 1018724,
  NVDA: 1045810, META: 1326801, TSLA: 1318605, BRK_B: 1067983, "BRK-B": 1067983,
  JPM: 19617, V: 1403161, MA: 1141391, UNH: 731766, XOM: 34088, JNJ: 200406,
  WMT: 104169, PG: 80424, HD: 354950, KO: 21344, PEP: 77476, BAC: 70858,
  COST: 909832, MRK: 310158, ABBV: 1551152, ORCL: 1341439, CVX: 93410,
  CRM: 1108524, NFLX: 1065280, AMD: 2488, INTC: 50863, DIS: 1744489,
  ADBE: 796343, CSCO: 858877, QCOM: 804328, IBM: 51143, T: 732717,
  VZ: 732712, PFE: 78003, NKE: 320187, MCD: 63908, GS: 886982, MS: 895421,
  BA: 12927, GE: 40545, F: 37996, GM: 1467858, PLTR: 1321655, UBER: 1543151,
  COIN: 1679788, SNOW: 1640147,
};
const KEY_CONCEPTS = [
  "Revenues",
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "NetIncomeLoss",
  "Assets",
  "Liabilities",
  "StockholdersEquity",
  "EarningsPerShareDiluted",
];

export class SecEdgarTool {
  constructor({ fetchImpl } = {}) {
    this.name = "sec_edgar";
    this.description =
      "Query the REAL U.S. SEC EDGAR database: recent filings (10-K, 10-Q, 8-K, ...) and key XBRL financial facts for a public company, by ticker or CIK.";
    this._get = makeHttp(fetchImpl);
    this._tickerCache = null;
    this.parameters = {
      ticker: { type: "string", description: "Company ticker (e.g., AAPL) or CIK number" },
      action: { type: "string", description: "filings or facts", default: "filings" },
      filing_type: { type: "string", description: "Filter: 10-K, 10-Q, 8-K, DEF 14A, S-1, all", default: "all" },
      limit: { type: "number", description: "Max filings returned (default 10)", default: 10 },
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
            ticker: { type: "string", description: "Ticker symbol or CIK number" },
            action: { type: "string", enum: ["filings", "facts"], default: "filings" },
            filing_type: { type: "string", description: "e.g. 10-K, 10-Q, 8-K, all", default: "all" },
            limit: { type: "number", minimum: 1, maximum: 40, default: 10 },
          },
          required: ["ticker"],
        },
      },
    };
  }

  async _resolveCik(tickerOrCik) {
    const raw = String(tickerOrCik || "").trim();
    if (/^\d{1,10}$/.test(raw)) return raw.padStart(10, "0");
    const up = raw.toUpperCase();
    if (this._tickerCache === null) {
      try {
        this._tickerCache = await this._get(TICKERS_URL);
      } catch {
        this._tickerCache = false; // index unreachable (see SCAFFOLD above)
      }
    }
    if (this._tickerCache) {
      for (const row of Object.values(this._tickerCache)) {
        if (String(row.ticker).toUpperCase() === up) {
          return String(row.cik_str).padStart(10, "0");
        }
      }
      throw new Error(`ticker '${raw}' not found in SEC company list`);
    }
    if (FALLBACK_CIKS[up]) return String(FALLBACK_CIKS[up]).padStart(10, "0");
    throw new Error(
      `SEC ticker index unreachable and '${raw}' is not in the built-in fallback map — pass the company's numeric CIK instead (find it via web_search: "<company> SEC CIK")`
    );
  }

  async execute({ ticker, action = "filings", filing_type = "all", limit = 10 } = {}) {
    try {
      const cik = await this._resolveCik(ticker);
      const cap = Math.min(Math.max(Number(limit) || 10, 1), 40);

      if (action === "facts") {
        const j = await this._get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
        const gaap = j?.facts?.["us-gaap"] || {};
        const facts = {};
        for (const concept of KEY_CONCEPTS) {
          const units = gaap[concept]?.units;
          if (!units) continue;
          const unit = Object.keys(units)[0];
          const rows = (units[unit] || [])
            .filter((r) => r.form === "10-K" || r.form === "10-Q")
            .slice(-6)
            .map((r) => ({ end: r.end, val: r.val, form: r.form, fy: r.fy, fp: r.fp }));
          if (rows.length) facts[concept] = { unit, recent: rows };
        }
        return {
          success: true,
          data: { cik, entityName: j?.entityName, facts, source: "SEC XBRL companyfacts (live)" },
        };
      }

      const j = await this._get(`https://data.sec.gov/submissions/CIK${cik}.json`);
      const rec = j?.filings?.recent || {};
      const want = String(filing_type || "all").toUpperCase();
      const out = [];
      for (let i = 0; i < (rec.form || []).length && out.length < cap; i++) {
        if (want !== "ALL" && String(rec.form[i]).toUpperCase() !== want) continue;
        const acc = String(rec.accessionNumber[i] || "").replace(/-/g, "");
        out.push({
          form: rec.form[i],
          filed: rec.filingDate[i],
          reportDate: rec.reportDate?.[i] || undefined,
          description: rec.primaryDocDescription?.[i] || undefined,
          url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc}/${rec.primaryDocument[i]}`,
        });
      }
      return {
        success: true,
        data: {
          cik,
          entityName: j?.name,
          filingType: want,
          filings: capList(out, cap),
          source: "SEC EDGAR submissions (live)",
        },
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
}

/**
 * World Bank Tool — REAL development indicators via the keyless World Bank
 * Open Data API v2 (api.worldbank.org).
 */
import { makeHttp, capList } from "../../plugins-lib/http.mjs";

const BASE = "https://api.worldbank.org/v2";
const COMMON = {
  gdp: "NY.GDP.MKTP.CD",
  gdp_growth: "NY.GDP.MKTP.KD.ZG",
  gdp_per_capita: "NY.GDP.PCAP.CD",
  population: "SP.POP.TOTL",
  inflation: "FP.CPI.TOTL.ZG",
  unemployment: "SL.UEM.TOTL.ZS",
  life_expectancy: "SP.DYN.LE00.IN",
  co2_emissions: "EN.ATM.CO2E.PC",
};

export class WorldBankTool {
  constructor({ fetchImpl } = {}) {
    this.name = "world_bank";
    this.description =
      "Fetch REAL World Bank Open Data indicators (GDP, population, inflation, unemployment, life expectancy, ...) for any country. Accepts indicator codes like NY.GDP.MKTP.CD or shortcuts: " +
      Object.keys(COMMON).join(", ") + ".";
    this._get = makeHttp(fetchImpl);
    this.parameters = {
      country: { type: "string", description: "ISO2/ISO3 country code (US, DEU) or 'all'", required: true },
      indicator: { type: "string", description: "Indicator code or shortcut (default gdp)", default: "gdp" },
      start_year: { type: "number", description: "First year (default 2015)" },
      end_year: { type: "number", description: "Last year (default current)" },
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
            country: { type: "string", description: "ISO2/ISO3 country code, e.g. US, CN, DEU" },
            indicator: { type: "string", description: "World Bank indicator code or shortcut", default: "gdp" },
            start_year: { type: "number" },
            end_year: { type: "number" },
          },
          required: ["country"],
        },
      },
    };
  }

  async execute({ country, indicator = "gdp", start_year, end_year } = {}) {
    try {
      const c = String(country || "").trim();
      if (!/^[A-Za-z;]{2,20}$/.test(c) && c !== "all") {
        return { success: false, error: "invalid country code" };
      }
      const ind = COMMON[String(indicator).toLowerCase()] || String(indicator).trim();
      if (!/^[A-Za-z0-9._]{2,40}$/.test(ind)) {
        return { success: false, error: "invalid indicator code" };
      }
      const endY = Number(end_year) || new Date().getFullYear();
      const startY = Number(start_year) || endY - 10;
      const url = `${BASE}/country/${encodeURIComponent(c)}/indicator/${encodeURIComponent(ind)}?format=json&per_page=200&date=${startY}:${endY}`;
      const j = await this._get(url);
      if (!Array.isArray(j) || !Array.isArray(j[1])) {
        const msg = j?.[0]?.message?.[0]?.value || "no data returned (check country/indicator codes)";
        return { success: false, error: msg };
      }
      const rows = j[1]
        .filter((r) => r.value !== null)
        .map((r) => ({ country: r.country?.value, year: r.date, value: r.value }))
        .sort((a, b) => a.year.localeCompare(b.year));
      return {
        success: true,
        data: {
          indicator: ind,
          indicatorName: j[1][0]?.indicator?.value,
          range: `${startY}-${endY}`,
          points: capList(rows, 100),
          total: rows.length,
          source: "World Bank Open Data API v2 (live)",
        },
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
}

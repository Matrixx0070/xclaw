/**
 * IMF Tool — REAL macroeconomic data via the keyless IMF DataMapper API
 * (www.imf.org/external/datamapper/api/v1).
 */
import { makeHttp, capList } from "../../plugins-lib/http.mjs";

const BASE = "https://www.imf.org/external/datamapper/api/v1";
const COMMON = {
  gdp_growth: "NGDP_RPCH",
  gdp_usd: "NGDPD",
  gdp_per_capita: "NGDPDPC",
  inflation: "PCPIPCH",
  unemployment: "LUR",
  gov_debt: "GGXWDG_NGDP",
  current_account: "BCA_NGDPD",
};

export class ImfTool {
  constructor({ fetchImpl } = {}) {
    this.name = "imf";
    this.description =
      "Fetch REAL IMF macroeconomic data (World Economic Outlook): GDP growth, GDP in USD, inflation, unemployment, government debt, current account. Accepts IMF indicator codes (NGDPD, PCPIPCH, ...) or shortcuts: " +
      Object.keys(COMMON).join(", ") + ". Includes IMF projections for future years.";
    this._get = makeHttp(fetchImpl);
    this.parameters = {
      indicator: { type: "string", description: "IMF indicator code or shortcut", default: "gdp_growth" },
      country: { type: "string", description: "ISO3 code(s), comma-separated (USA, DEU, CHN)", required: true },
      start_year: { type: "number", description: "First year (default 2015)" },
      end_year: { type: "number", description: "Last year (default current+1)" },
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
            indicator: { type: "string", description: "IMF indicator code or shortcut", default: "gdp_growth" },
            country: { type: "string", description: "ISO3 country code(s), comma-separated" },
            start_year: { type: "number" },
            end_year: { type: "number" },
          },
          required: ["country"],
        },
      },
    };
  }

  async execute({ indicator = "gdp_growth", country, start_year, end_year } = {}) {
    try {
      const ind = COMMON[String(indicator).toLowerCase()] || String(indicator).trim();
      if (!/^[A-Za-z0-9_]{2,30}$/.test(ind)) {
        return { success: false, error: "invalid indicator code" };
      }
      const countries = String(country || "")
        .split(/[\s,;]+/)
        .filter(Boolean)
        .map((s) => s.toUpperCase());
      if (!countries.length || countries.some((s) => !/^[A-Z]{2,5}$/.test(s))) {
        return { success: false, error: "invalid country code(s) — use ISO3 like USA, DEU" };
      }
      const endY = Number(end_year) || new Date().getFullYear() + 1;
      const startY = Number(start_year) || endY - 10;
      const periods = [];
      for (let y = startY; y <= endY; y++) periods.push(y);
      // The DataMapper API ignores its country path segment and periods
      // param (verified 2026-08-24: /NGDP_RPCH/USA returned all 229
      // countries, all years) — filter client-side.
      const url = `${BASE}/${encodeURIComponent(ind)}/${countries.map(encodeURIComponent).join("/")}?periods=${periods.join(",")}`;
      const j = await this._get(url, { timeoutMs: 45_000 });
      const values = j?.values?.[ind];
      if (!values || !Object.keys(values).length) {
        return { success: false, error: `no IMF data for ${ind}` };
      }
      const series = {};
      for (const iso of countries) {
        const byYear = values[iso];
        if (!byYear) continue;
        series[iso] = capList(
          Object.entries(byYear)
            .filter(([year]) => Number(year) >= startY && Number(year) <= endY)
            .map(([year, value]) => ({ year, value }))
            .sort((a, b) => a.year.localeCompare(b.year)),
          40
        );
      }
      if (!Object.keys(series).length) {
        return { success: false, error: `no IMF data for ${ind} / ${countries.join(",")} — use ISO3 codes like USA, DEU` };
      }
      return {
        success: true,
        data: {
          indicator: ind,
          range: `${startY}-${endY}`,
          series,
          note: "years beyond the latest WEO release are IMF projections",
          source: "IMF DataMapper API (live)",
        },
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
}

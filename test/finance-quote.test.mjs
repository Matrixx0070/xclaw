import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createFinanceQuoteTool } from "../src/tools/finance-tools.mjs";

describe("finance_quote", () => {
  it("CoinGecko HTTP 429 is isError, not an empty ticker", async () => {
    const prev = process.env.POLYGON_API_KEY;
    delete process.env.POLYGON_API_KEY;
    try {
      const tool = createFinanceQuoteTool({
        fetchFn: async () => ({
          ok: false,
          status: 429,
          async json() {
            return { error: "rate limited" };
          },
        }),
      });
      const out = await tool.execute({ symbol: "bitcoin", asset: "crypto" });
      assert.equal(out.isError, true);
      assert.match(out.content[0].text, /429|rate/i);
    } finally {
      if (prev !== undefined) process.env.POLYGON_API_KEY = prev;
    }
  });

  it("Polygon HTTP 429 with invalid JSON is isError HTTP 429, not a parse throw", async () => {
    const prev = process.env.POLYGON_API_KEY;
    process.env.POLYGON_API_KEY = "test";
    try {
      const tool = createFinanceQuoteTool({
        fetchFn: async () => ({
          ok: false,
          status: 429,
          async json() {
            throw new Error("Unexpected token <");
          },
        }),
      });
      const out = await tool.execute({ symbol: "AAPL", asset: "stock" });
      assert.equal(out.isError, true);
      assert.match(out.content[0].text, /HTTP 429/);
    } finally {
      if (prev === undefined) delete process.env.POLYGON_API_KEY;
      else process.env.POLYGON_API_KEY = prev;
    }
  });
});

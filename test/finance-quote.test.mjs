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

  it("CoinGecko HTTP 200 with invalid JSON is isError, not Unexpected token", async () => {
    const prev = process.env.POLYGON_API_KEY;
    delete process.env.POLYGON_API_KEY;
    try {
      const tool = createFinanceQuoteTool({
        fetchFn: async () => ({
          ok: true,
          status: 200,
          async json() {
            throw new Error("Unexpected token <");
          },
        }),
      });
      const out = await tool.execute({ symbol: "bitcoin", asset: "crypto" });
      assert.equal(out.isError, true);
      assert.match(out.content[0].text, /invalid JSON/i);
      assert.doesNotMatch(out.content[0].text, /Unexpected token/);
    } finally {
      if (prev !== undefined) process.env.POLYGON_API_KEY = prev;
    }
  });

  it("CoinGecko HTTP 200 with a row and no usd is isError, not usd:undefined", async () => {
    const prev = process.env.POLYGON_API_KEY;
    delete process.env.POLYGON_API_KEY;
    try {
      const tool = createFinanceQuoteTool({
        fetchFn: async () => ({
          ok: true,
          status: 200,
          async json() {
            return { bitcoin: {} };
          },
        }),
      });
      const out = await tool.execute({ symbol: "bitcoin", asset: "crypto" });
      assert.equal(out.isError, true);
      assert.match(out.content[0].text, /No price for bitcoin/);
      assert.doesNotMatch(out.content[0].text, /undefined/);
    } finally {
      if (prev !== undefined) process.env.POLYGON_API_KEY = prev;
    }
  });

  it("Polygon HTTP 200 with a bar and no close is isError, not close:undefined", async () => {
    const prev = process.env.POLYGON_API_KEY;
    process.env.POLYGON_API_KEY = "test";
    try {
      const tool = createFinanceQuoteTool({
        fetchFn: async () => ({
          ok: true,
          status: 200,
          async json() {
            return { results: [{}] };
          },
        }),
      });
      const out = await tool.execute({ symbol: "AAPL", asset: "stock" });
      assert.equal(out.isError, true);
      assert.match(out.content[0].text, /No data for AAPL/);
      assert.doesNotMatch(out.content[0].text, /undefined/);
    } finally {
      if (prev === undefined) delete process.env.POLYGON_API_KEY;
      else process.env.POLYGON_API_KEY = prev;
    }
  });
});

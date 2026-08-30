import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createXKeywordSearchTool, createXUserSearchTool, createXThreadFetchTool } from "../src/tools/x-tools.mjs";

describe("x_keyword_search", () => {
  it("DDG fallback HTTP 503 is isError, not parsed HTML success", async () => {
    const prev = process.env.X_BEARER_TOKEN;
    delete process.env.X_BEARER_TOKEN;
    delete process.env.TWITTER_BEARER_TOKEN;
    try {
      const tool = createXKeywordSearchTool({
        fetchFn: async () => ({
          ok: false,
          status: 503,
          async text() {
            return "<html>unavailable</html>";
          },
          async json() {
            return {};
          },
        }),
      });
      const out = await tool.execute({ query: "xclaw" });
      assert.equal(out.isError, true);
      assert.match(out.content[0].text, /HTTP 503/);
    } finally {
      if (prev !== undefined) process.env.X_BEARER_TOKEN = prev;
    }
  });

  it("bearer HTTP 429 with invalid JSON is isError HTTP 429, not a parse throw", async () => {
    const prev = process.env.X_BEARER_TOKEN;
    process.env.X_BEARER_TOKEN = "test";
    try {
      const tool = createXKeywordSearchTool({
        fetchFn: async () => ({
          ok: false,
          status: 429,
          async json() {
            throw new Error("Unexpected token <");
          },
        }),
      });
      const out = await tool.execute({ query: "xclaw" });
      assert.equal(out.isError, true);
      assert.match(out.content[0].text, /HTTP 429/);
      assert.doesNotMatch(out.content[0].text, /Unexpected token/);
    } finally {
      if (prev === undefined) delete process.env.X_BEARER_TOKEN;
      else process.env.X_BEARER_TOKEN = prev;
    }
  });
});

describe("x_user_search", () => {
  it("HTTP 429 with invalid JSON is isError HTTP 429, not a parse throw", async () => {
    process.env.X_BEARER_TOKEN = "test";
    const tool = createXUserSearchTool({
      fetchFn: async () => ({
        ok: false,
        status: 429,
        async json() {
          throw new Error("Unexpected token <");
        },
      }),
    });
    const out = await tool.execute({ query: "grok" });
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /HTTP 429/);
  });
});

describe("x_thread_fetch", () => {
  it("HTTP 200 with missing data is tweet not found, not a TypeError", async () => {
    process.env.X_BEARER_TOKEN = "test";
    const tool = createXThreadFetchTool({
      fetchFn: async () => ({
        ok: true,
        status: 200,
        async json() {
          return { data: null };
        },
      }),
    });
    const out = await tool.execute({ post_id: "1" });
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /tweet not found/);
  });
});

describe("x_user_search empty data", () => {
  it("HTTP 200 with empty data object is user not found, not @undefined", async () => {
    process.env.X_BEARER_TOKEN = "test";
    const tool = createXUserSearchTool({
      fetchFn: async () => ({
        ok: true,
        status: 200,
        async json() {
          return { data: {} };
        },
      }),
    });
    const out = await tool.execute({ query: "nobody" });
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /user not found/);
    assert.doesNotMatch(out.content[0].text, /@undefined/);
  });
});

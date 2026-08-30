import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createXKeywordSearchTool, createXUserSearchTool, createXThreadFetchTool, createXSemanticSearchTool } from "../src/tools/x-tools.mjs";

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

  it("HTTP 200 with non-array data is invalid tweet payload, not a TypeError", async () => {
    const prev = process.env.X_BEARER_TOKEN;
    process.env.X_BEARER_TOKEN = "test";
    try {
      const tool = createXKeywordSearchTool({
        fetchFn: async () => ({
          ok: true,
          status: 200,
          async json() {
            return { data: {} };
          },
        }),
      });
      const out = await tool.execute({ query: "xclaw" });
      assert.equal(out.isError, true);
      assert.match(out.content[0].text, /invalid tweet payload/);
      assert.doesNotMatch(out.content[0].text, /slice is not a function|TypeError/);
    } finally {
      if (prev === undefined) delete process.env.X_BEARER_TOKEN;
      else process.env.X_BEARER_TOKEN = prev;
    }
  });

  it("HTTP 200 with missing data is No tweets, not isError", async () => {
    const prev = process.env.X_BEARER_TOKEN;
    process.env.X_BEARER_TOKEN = "test";
    try {
      const tool = createXKeywordSearchTool({
        fetchFn: async () => ({
          ok: true,
          status: 200,
          async json() {
            return { meta: { result_count: 0 } };
          },
        }),
      });
      const out = await tool.execute({ query: "xclaw" });
      assert.notEqual(out.isError, true);
      assert.match(out.content[0].text, /No tweets/);
    } finally {
      if (prev === undefined) delete process.env.X_BEARER_TOKEN;
      else process.env.X_BEARER_TOKEN = prev;
    }
  });

  it("HTTP 200 with tweets missing id is invalid payload, not 1. undefined", async () => {
    const prev = process.env.X_BEARER_TOKEN;
    process.env.X_BEARER_TOKEN = "test";
    try {
      const tool = createXKeywordSearchTool({
        fetchFn: async () => ({
          ok: true,
          status: 200,
          async json() {
            return { data: [{}] };
          },
        }),
      });
      const out = await tool.execute({ query: "xclaw" });
      assert.equal(out.isError, true);
      assert.match(out.content[0].text, /invalid tweet payload/);
      assert.doesNotMatch(out.content[0].text, /undefined/);
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

describe("x_semantic_search", () => {
  it("xAI 200 HTML is isError, not a silent keyword_proxy success", async () => {
    const prev = process.env.XAI_API_KEY;
    process.env.XAI_API_KEY = "test-key";
    try {
      const tool = createXSemanticSearchTool({
        keywordTool: {
          async execute() {
            return {
              content: [
                {
                  type: "text",
                  text: "1. https://x.com/a/status/1\nhello world this is a long enough keyword payload",
                },
              ],
            };
          },
        },
        fetchFn: async () => ({
          ok: true,
          status: 200,
          async json() {
            throw new Error("Unexpected token <");
          },
        }),
      });
      const out = await tool.execute({ query: "hello" });
      assert.equal(out.isError, true);
      assert.match(out.content[0].text, /no usable content|rerank failed/i);
    } finally {
      if (prev === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = prev;
    }
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createXKeywordSearchTool } from "../src/tools/x-tools.mjs";

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
});

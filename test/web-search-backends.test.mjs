import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createWebSearchTool } from "../src/tools/extra-tools.mjs";

describe("web_search backend honesty", () => {
  it("all backends failing is isError, not empty results", async () => {
    const tool = createWebSearchTool({
      fetchFn: async () => {
        throw new Error("network down");
      },
    });
    const out = await tool.execute({ query: "anything" });
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /web_search failed/);
    assert.match(out.content[0].text, /network down/);
  });

  it("HTTP 503 from every backend is isError", async () => {
    const tool = createWebSearchTool({
      fetchFn: async () => ({
        ok: false,
        status: 503,
        async json() {
          return {};
        },
        async text() {
          return "unavailable";
        },
      }),
    });
    const out = await tool.execute({ query: "anything" });
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /503/);
  });

  it("a 200 with no hits is empty results, not a failure", async () => {
    const tool = createWebSearchTool({
      fetchFn: async () => ({
        ok: true,
        status: 200,
        async json() {
          return { AbstractText: "", RelatedTopics: [] };
        },
        async text() {
          return "<html></html>";
        },
      }),
    });
    const out = await tool.execute({ query: "zzzz-no-hits" });
    assert.ok(!out.isError);
    assert.match(out.content[0].text, /No results/);
  });
});

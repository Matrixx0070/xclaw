import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isSearchHostAllowed,
  SEARCH_ALLOW_HOSTS,
  runWebSearch,
  isSearchPlaneTool,
} from "../src/planes/search.mjs";
import { createToolRouter } from "../src/tools/router.mjs";
import { getPlane } from "../src/tools/planes.mjs";

describe("T4 search plane", () => {
  it("allowlists only search hosts", () => {
    assert.equal(isSearchHostAllowed("https://html.duckduckgo.com/html/"), true);
    assert.equal(isSearchHostAllowed("https://api.search.brave.com/res/v1/web/search"), true);
    assert.equal(isSearchHostAllowed("https://evil.example/"), false);
    assert.ok(SEARCH_ALLOW_HOSTS.length >= 2);
  });

  it("isSearchPlaneTool for web_search", () => {
    assert.equal(isSearchPlaneTool("web_search"), true);
    assert.equal(getPlane("web_search"), "search");
    assert.equal(isSearchPlaneTool("xclaw_bash"), false);
  });

  it("runWebSearch requires query", async () => {
    const r = await runWebSearch({});
    assert.equal(r.ok, false);
  });

  it("router dispatches web_search to search plane", async () => {
    const router = createToolRouter({ computer: null, localTools: [] });
    // May succeed or fail network; must not be computer plane
    const r = await router.dispatch({
      name: "web_search",
      args: { query: "xclaw agent", limit: 2 },
    });
    assert.equal(r.plane, "search");
    // if network works, ok true; if not, error message from search plane
    assert.ok(r.plane === "search");
  });
});

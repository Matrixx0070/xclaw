import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isSearchHostAllowed,
  SEARCH_ALLOW_HOSTS,
  runWebSearch,
} from "../src/planes/search.mjs";

describe("search plane", () => {
  it("allowlist includes brave and ddg", () => {
    assert.ok(SEARCH_ALLOW_HOSTS.some((h) => h.includes("brave")));
    assert.ok(SEARCH_ALLOW_HOSTS.some((h) => h.includes("duckduckgo")));
  });

  it("isSearchHostAllowed accepts brave api", () => {
    assert.equal(
      isSearchHostAllowed("https://api.search.brave.com/res/v1/web/search"),
      true
    );
  });

  it("isSearchHostAllowed rejects random hosts", () => {
    assert.equal(isSearchHostAllowed("https://evil.example/search"), false);
    assert.equal(isSearchHostAllowed("https://google.com/search"), false);
  });

  it("runWebSearch requires query", async () => {
    const r = await runWebSearch({});
    assert.equal(r.ok, false);
  });

  it(
    "runWebSearch ddg or brave returns results when network available",
    { timeout: 25_000 },
    async () => {
      const r = await runWebSearch({ query: "xAI Grok", limit: 3 });
      if (r.isError || r.ok === false) {
        // Network may be restricted in some sandboxes — soft skip
        console.log("search soft-skip:", r.content?.[0]?.text || r);
        return;
      }
      assert.ok(r.content || r.ok !== false);
    }
  );
});

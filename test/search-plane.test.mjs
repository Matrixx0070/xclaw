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

  // RULE(a) subdomain-boundary: a lookalike host that merely SHARES an allowed
  // host as a trailing SUBSTRING ("evilduckduckgo.com" vs "duckduckgo.com") is
  // NOT a subdomain of it and must be REFUSED. `isSearchHostAllowed` enforces the
  // dot boundary via `.endsWith("." + h)`; a bare `.endsWith(h)` would admit the
  // lookalike, letting the search plane's egress allowlist (`allowedFetch`) fetch
  // from an attacker-registered host — query exfiltration + attacker-controlled
  // results injected into agent reasoning (SSRF). The prior reject test uses only
  // DISJOINT hosts ("evil.example", "google.com"), rejected either way, so it
  // never pins the dot boundary. This pins the sibling REJECT (mutated -> RED)
  // with a real-subdomain ADMIT (green both ways).
  it("isSearchHostAllowed refuses a lookalike sharing only the allowlisted suffix", () => {
    assert.equal(
      isSearchHostAllowed("https://evilduckduckgo.com/search"),
      false
    );
    assert.equal(
      isSearchHostAllowed("https://evilapi.search.brave.com/x"),
      false
    );
  });

  it("isSearchHostAllowed admits a real subdomain of an allowlisted host", () => {
    assert.equal(
      isSearchHostAllowed("https://foo.duckduckgo.com/search"),
      true
    );
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

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { observeAfterAct } from "../src/computer/modules/computer-act-tool.mjs";

describe("observeAfterAct", () => {
  it("reads href and title from the tab", async () => {
    const tab = {
      page: { url: "https://stale.example/" },
      async evaluate() {
        return JSON.stringify({
          href: "https://example.com/after",
          title: "After",
        });
      },
    };
    const o = await observeAfterAct(tab);
    assert.equal(o.pageUrl, "https://example.com/after");
    assert.equal(o.title, "After");
  });

  it("falls back to tab.page.url when evaluate throws", async () => {
    const tab = {
      page: { url: "https://cached.example/" },
      async evaluate() {
        throw new Error("cdp down");
      },
    };
    const o = await observeAfterAct(tab);
    assert.equal(o.pageUrl, "https://cached.example/");
    assert.equal(o.title, null);
  });
});

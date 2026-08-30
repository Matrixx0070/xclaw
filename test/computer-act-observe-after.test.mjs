import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
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

  it("navigate and key success paths call observeAfterAct", () => {
    const src = fs.readFileSync(
      new URL("../src/computer/modules/computer-act-tool.mjs", import.meta.url),
      "utf8"
    );
    const nav = src.indexOf('if (action === "navigate")');
    const key = src.indexOf('if (action === "key")');
    const click = src.indexOf("const observed = await observeAfterAct(tab);");
    assert.ok(nav >= 0 && key >= 0 && click >= 0);
    const n = (src.match(/await observeAfterAct\(tab\)/g) || []).length;
    assert.ok(n >= 4, `navigate, key, screenshot, and click/type/scroll must observe (got ${n})`);
  });
});

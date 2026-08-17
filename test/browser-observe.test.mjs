/**
 * I1 — native browser observe (structure before vision)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractInteractiveElements,
  observeFromTab,
  runBrowserTab,
  _resetTabsForTests,
} from "../src/computer/modules/browser-tab-tool.mjs";

describe("browser observe (I1)", () => {
  it("extracts links buttons inputs from HTML", () => {
    const html = `
      <html><body>
        <a href="/go">Go there</a>
        <button aria-label="Save doc">Save</button>
        <input type="text" name="q" placeholder="Search" />
        <input type="hidden" name="csrf" value="x" />
      </body></html>`;
    const els = extractInteractiveElements(html, "https://example.com", 20);
    assert.ok(els.length >= 3);
    assert.ok(els.some((e) => e.role === "link" && /Go/.test(e.name)));
    assert.ok(els.some((e) => e.role === "button"));
    assert.ok(els.some((e) => e.role === "textbox"));
    assert.ok(!els.some((e) => e.inputType === "hidden"));
    assert.ok(els.every((e) => e.ref && e.role && e.name));
  });

  it("observeFromTab returns mode html-structure", () => {
    const tab = {
      id: "tab_test",
      url: "https://example.com",
      title: "Example",
      text: "hello",
      html: `<a href="https://example.com/a">A</a><button>B</button>`,
    };
    const obs = observeFromTab(tab);
    assert.equal(obs.ok, true);
    assert.equal(obs.action, "observe");
    assert.equal(obs.mode, "html-structure");
    assert.ok(obs.elementCount >= 2);
  });

  it("runBrowserTab observe requires tabId", async () => {
    _resetTabsForTests();
    const r = await runBrowserTab({ action: "observe" });
    assert.equal(r.ok, false);
  });

  it("click/type honestly require bundle", async () => {
    const r = await runBrowserTab({ action: "click", click: "e1" });
    assert.equal(r.ok, false);
    assert.match(String(r.error), /CDP|bundle/i);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  runBrowserTab,
  _resetTabsForTests,
} from "../src/computer/modules/browser-tab-tool.mjs";

describe("native browser_tab", () => {
  it("lists empty tabs", async () => {
    _resetTabsForTests();
    const r = await runBrowserTab({ action: "list" });
    assert.equal(r.ok, true);
    assert.equal(r.count, 0);
    assert.equal(r.engine, "native-fetch");
  });

  it("navigates local http fixture and extracts title/links", async () => {
    _resetTabsForTests();
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        `<html><head><title>Hello XClaw</title>
        <meta name="description" content="fixture page"/>
        </head><body><a href="/next">Next</a><p>Body text here</p></body></html>`
      );
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address();
    try {
      const r = await runBrowserTab({ url: `http://127.0.0.1:${port}/` });
      assert.equal(r.ok, true);
      assert.equal(r.title, "Hello XClaw");
      assert.match(r.textPreview, /Body text/);
      assert.ok(r.tabId);
      assert.ok(Array.isArray(r.links));
      const read = await runBrowserTab({ action: "read", tabId: r.tabId });
      assert.equal(read.ok, true);
      assert.equal(read.title, "Hello XClaw");
    } finally {
      server.close();
    }
  });

  it("rejects jsCode with clear CDP guidance", async () => {
    const r = await runBrowserTab({ jsCode: "1+1" });
    assert.equal(r.ok, false);
    assert.match(r.error, /CDP|BrowserService/);
  });
});

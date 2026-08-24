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

  it("navigates local http fixture and extracts title/links (allowPrivate)", async () => {
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
    process.env.XCLAW_SSRF_ALLOW_PRIVATE = "1";
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
      delete process.env.XCLAW_SSRF_ALLOW_PRIVATE;
      server.close();
    }
  });

  it("SSRF: blocks loopback navigation by default (no allowPrivate)", async () => {
    _resetTabsForTests();
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><title>secret</title></html>");
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address();
    delete process.env.XCLAW_SSRF_ALLOW_PRIVATE;
    try {
      const r = await runBrowserTab({ url: `http://127.0.0.1:${port}/` });
      assert.equal(r.ok, false);
      assert.equal(r.code, "SSRF_BLOCKED");
      assert.match(r.error, /private|loopback/i);
    } finally {
      server.close();
    }
  });

  it("SSRF: cloud metadata blocked even with allowPrivate (floor)", async () => {
    _resetTabsForTests();
    process.env.XCLAW_SSRF_ALLOW_PRIVATE = "1";
    try {
      const r = await runBrowserTab({ url: "http://169.254.169.254/latest/meta-data/" });
      assert.equal(r.ok, false);
      assert.equal(r.code, "SSRF_BLOCKED");
      assert.match(r.error, /metadata/i);
    } finally {
      delete process.env.XCLAW_SSRF_ALLOW_PRIVATE;
    }
  });

  it("SSRF: cloud metadata blocked even with guard off (floor)", async () => {
    _resetTabsForTests();
    process.env.XCLAW_SSRF = "off";
    try {
      const r = await runBrowserTab({ url: "http://metadata.google.internal/computeMetadata/v1/" });
      assert.equal(r.ok, false);
      assert.equal(r.code, "SSRF_BLOCKED");
      assert.match(r.error, /metadata/i);
    } finally {
      delete process.env.XCLAW_SSRF;
    }
  });

  it("jsCode without a reachable browser fails typed (external endpoint pinned — no spawn)", async () => {
    process.env.XCLAW_CDP_URL = "http://127.0.0.1:59991";
    try {
      const r = await runBrowserTab({ jsCode: "1+1" });
      assert.equal(r.ok, false);
      assert.equal(r.code, "CUA_JS_FAILED");
    } finally {
      delete process.env.XCLAW_CDP_URL;
    }
  });
});

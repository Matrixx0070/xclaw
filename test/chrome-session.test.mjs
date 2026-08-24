/**
 * chrome-session unit tests — CI-safe: never spawns a real Chrome.
 * The adopt path is exercised with a fake /json/version endpoint plus a
 * DevToolsActivePort file, exactly what a previous server process leaves.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensureChrome,
  stopChrome,
  chromeSessionStatus,
  externalCdpEndpoint,
  probeCdp,
  _resetChromeSessionForTests,
} from "../src/computer/chrome-session.mjs";

const fake = http.createServer((req, res) => {
  if (req.url === "/json/version") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ Browser: "FakeChrome/1.0", webSocketDebuggerUrl: "ws://x" }));
    return;
  }
  res.writeHead(404);
  res.end("{}");
});
await new Promise((r) => fake.listen(0, "127.0.0.1", r));
const fakePort = fake.address().port;

after(() => {
  fake.close();
  _resetChromeSessionForTests();
});

describe("chrome-session", () => {
  it("externalCdpEndpoint parses XCLAW_CDP_URL and wins over managed", async () => {
    assert.equal(externalCdpEndpoint({}), null);
    assert.deepEqual(externalCdpEndpoint({ XCLAW_CDP_URL: "http://127.0.0.1:9222" }), {
      host: "127.0.0.1",
      port: 9222,
    });
    process.env.XCLAW_CDP_URL = `http://127.0.0.1:${fakePort}`;
    try {
      const ep = await ensureChrome();
      assert.equal(ep.port, fakePort);
      assert.equal(ep.managed, false);
    } finally {
      delete process.env.XCLAW_CDP_URL;
      _resetChromeSessionForTests();
    }
  });

  it("probeCdp true for live /json/version, false for dead port", async () => {
    assert.equal((await probeCdp("127.0.0.1", fakePort)).ok, true);
    assert.equal((await probeCdp("127.0.0.1", 1, 400)).ok, false);
  });

  it("adopts an existing Chrome via DevToolsActivePort without spawning", async () => {
    _resetChromeSessionForTests();
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-cs-test-"));
    fs.writeFileSync(
      path.join(profileDir, "DevToolsActivePort"),
      `${fakePort}\n/devtools/browser/abc\n`
    );
    try {
      const ep = await ensureChrome({ profileDir });
      assert.equal(ep.host, "127.0.0.1");
      assert.equal(ep.port, fakePort);
      assert.equal(ep.managed, true);
      assert.equal(ep.pid, null, "adopted instance has no child pid");
      const st = chromeSessionStatus();
      assert.equal(st.running, true);
      assert.equal(st.endpoint, `127.0.0.1:${fakePort}`);
      // Second call reuses without re-reading the port file
      const ep2 = await ensureChrome({ profileDir });
      assert.equal(ep2.port, fakePort);
    } finally {
      _resetChromeSessionForTests();
      fs.rmSync(profileDir, { recursive: true, force: true });
    }
  });

  it("stopChrome is a safe no-op when nothing is managed", async () => {
    _resetChromeSessionForTests();
    const r = await stopChrome();
    assert.equal(r.stopped, false);
    assert.equal(chromeSessionStatus().running, false);
  });
});

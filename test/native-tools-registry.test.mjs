import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  listMaintainedTools,
  executeMaintainedTool,
  getTool,
} from "../src/computer/modules/registry.mjs";

describe("maintained registry + bundle server browser", () => {
  it("registry lists xclaw_browser_tab", () => {
    const names = listMaintainedTools().map((t) => t.name);
    assert.ok(names.includes("xclaw_browser_tab"));
    assert.ok(getTool("xclaw_browser_tab"));
  });

  it("executeMaintainedTool navigates via registry", async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><head><title>Reg</title></head><body>ok</body></html>");
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address();
    process.env.XCLAW_SSRF_ALLOW_PRIVATE = "1"; // loopback fixture needs lab bypass
    try {
      const out = await executeMaintainedTool("xclaw_browser_tab", {
        url: `http://127.0.0.1:${port}/`,
      });
      assert.equal(out.ok, true);
      assert.equal(out.title, "Reg");
      assert.equal(out.engine, "native-fetch");
    } finally {
      delete process.env.XCLAW_SSRF_ALLOW_PRIVATE;
      server.close();
    }
  });

  it("bundle server health exposes browser tool", async () => {
    // The unified engine's embeddable factory: XCLAW_COMPUTER_EMBEDDED=1 makes
    // the import side-effect-free, createComputerServer({port:0}) binds an
    // ephemeral port (A6 thin-server merge, GAP 44 parity).
    process.env.XCLAW_COMPUTER_EMBEDDED = "1";
    let svc;
    try {
      const { createComputerServer } = await import("../src/computer/xclaw-server.mjs");
      svc = createComputerServer({ port: 0 });
      await svc.listen();
      const res = await fetch(`http://127.0.0.1:${svc.port}/health`);
      const j = await res.json();
      assert.equal(j.ok, true);
      assert.equal(j.engine, "bundle");
      assert.ok(
        j.tools.includes("xclaw_browser_tab"),
        `tools=${JSON.stringify(j.tools)}`
      );
    } finally {
      delete process.env.XCLAW_COMPUTER_EMBEDDED;
      if (svc) await svc.close();
    }
  });
});

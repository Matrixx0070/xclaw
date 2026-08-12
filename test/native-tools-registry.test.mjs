import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  listMaintainedTools,
  executeMaintainedTool,
  getTool,
} from "../src/computer/modules/registry.mjs";
import { createThinComputerServer } from "../src/computer/thin-server.mjs";

describe("maintained registry + thin server browser", () => {
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
    try {
      const out = await executeMaintainedTool("xclaw_browser_tab", {
        url: `http://127.0.0.1:${port}/`,
      });
      assert.equal(out.ok, true);
      assert.equal(out.title, "Reg");
      assert.equal(out.engine, "native-fetch");
    } finally {
      server.close();
    }
  });

  it("thin server health exposes browser tool", async () => {
    // port 0 → ephemeral
    const svc = createThinComputerServer({ host: "127.0.0.1", port: 0 });
    // thin-server uses Number(opts.port) which is 0 — Node assigns ephemeral
    const { port } = await new Promise((resolve, reject) => {
      svc.server.listen(0, "127.0.0.1", () => {
        resolve(svc.server.address());
      });
      svc.server.on("error", reject);
    });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      const j = await res.json();
      assert.equal(j.ok, true);
      assert.ok(
        j.tools.includes("xclaw_browser_tab"),
        `tools=${JSON.stringify(j.tools)}`
      );
    } finally {
      await svc.close();
    }
  });
});

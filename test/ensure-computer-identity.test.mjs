/**
 * Regression: ensure-computer adopted ANY 200 + JSON on the computer port.
 *
 * The A6 thin-merge dropped the old `engine === "thin"` assertion because
 * there is one engine now — but it dropped the identity check with it, so the
 * probe reduced to "did something answer 200 with JSON". An unrelated local
 * service holding 4243 was adopted as the computer server: the script exited
 * 0, the real server never started, and every later tool call went to a
 * stranger with no indication of why.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isComputerServerHealth } from "../scripts/ensure-computer.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function serveHealth(payload) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(req.url === "/health" ? payload : {}));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, port: server.address().port, close: () => new Promise((r) => server.close(r)) })
    );
  });
}

function runEnsure(port) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(root, "scripts/ensure-computer.mjs")], {
      cwd: root,
      env: { ...process.env, XCLAW_COMPUTER_PORT: String(port), XCLAW_COMPUTER_HOST: "127.0.0.1" },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

describe("ensure-computer only adopts an xclaw computer server", () => {
  it("recognises a real computer health payload", () => {
    assert.equal(isComputerServerHealth({ engine: "bundle", tools: ["bash"], ok: true }), true);
    // Version-agnostic: a rolling upgrade must not make the sides disown
    // each other, so only the shape is asserted, never a version or a name.
    assert.equal(isComputerServerHealth({ engine: "thin", tools: [] }), true);
  });

  it("rejects healthy-looking JSON from anything else", () => {
    assert.equal(isComputerServerHealth({ status: "ok" }), false, "a generic health endpoint");
    assert.equal(isComputerServerHealth({ engine: "bundle" }), false, "no tool list");
    assert.equal(isComputerServerHealth({ tools: ["bash"] }), false, "no engine");
    assert.equal(isComputerServerHealth({ engine: "", tools: [] }), false);
    assert.equal(isComputerServerHealth(null), false);
    assert.equal(isComputerServerHealth("ok"), false);
  });

  it("refuses to adopt a foreign service holding the port", async () => {
    const s = await serveHealth({ status: "ok", uptime: 12 });
    try {
      const r = await runEnsure(s.port);
      assert.equal(r.code, 1, "previously exited 0 and reported already:true");
      assert.match(r.err, /not an xclaw computer server/);
      assert.doesNotMatch(r.out, /already/);
    } finally {
      await s.close();
    }
  });

  it("still adopts a running computer server without spawning a second one", async () => {
    const s = await serveHealth({ status: "healthy", engine: "bundle", ok: true, tools: ["bash"] });
    try {
      const r = await runEnsure(s.port);
      assert.equal(r.code, 0);
      assert.match(r.out, /"already": true/);
      assert.doesNotMatch(r.out, /"started"/);
    } finally {
      await s.close();
    }
  });
});

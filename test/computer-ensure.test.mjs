import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isTransientError } from "../src/utils/backoff.mjs";

describe("computer error classification", () => {
  it("ECONNREFUSED is transient (retryable)", () => {
    const err = new Error("connect ECONNREFUSED");
    err.code = "ECONNREFUSED";
    assert.equal(isTransientError(err), true);
  });

  it("ETIMEDOUT is transient", () => {
    const err = new Error("timeout");
    err.code = "ETIMEDOUT";
    assert.equal(isTransientError(err), true);
  });
});

describe("ensureComputer module loads", () => {
  it("exports ensureComputer", async () => {
    const mod = await import("../src/computer/ensure.mjs");
    assert.equal(typeof mod.ensureComputer, "function");
  });
});

describe("ensureComputer target derivation", () => {
  /** An ephemeral port the OS just handed back, then released: nothing listens. */
  async function deadPort() {
    const net = await import("node:net");
    const srv = net.createServer();
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    const { port } = srv.address();
    await new Promise((r) => srv.close(r));
    return port;
  }

  async function healthyServer() {
    const http = await import("node:http");
    const srv = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "healthy" }));
    });
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    return { port: srv.address().port, close: () => new Promise((r) => srv.close(r)) };
  }

  // attempts:0 keeps every case off the spawn path: the remote branch is
  // decided before the retry loop, so no local computer server is ever started.
  it("a configured remoteUrl is the target the verdict reports", async () => {
    const { ensureComputer } = await import("../src/computer/ensure.mjs");
    const port = await deadPort();
    const remoteUrl = `http://127.0.0.1:${port}`;
    const r = await ensureComputer(
      { computer: { remoteUrl, host: "127.0.0.1", port: 4243 } },
      { attempts: 0, log: false }
    );
    assert.equal(r.ok, false);
    assert.equal(r.url, remoteUrl, "verdict must name the endpoint it probed");
    assert.match(r.error, new RegExp(String(port)));
    assert.equal(r.remote, true, "an unreachable remote must not be treated as a local start");
    assert.match(r.error, /not starting a local server/);
  });

  it("a healthy remote is reported without starting anything locally", async () => {
    const { ensureComputer } = await import("../src/computer/ensure.mjs");
    const srv = await healthyServer();
    try {
      const remoteUrl = `http://127.0.0.1:${srv.port}`;
      const r = await ensureComputer(
        { computer: { remoteUrl, host: "127.0.0.1", port: 4243 } },
        { attempts: 1, log: false }
      );
      assert.equal(r.ok, true);
      assert.equal(r.started, false);
      assert.equal(r.url, remoteUrl);
      assert.equal(r.remote, true);
    } finally {
      await srv.close();
    }
  });

  it("a wildcard bind still resolves to loopback in the verdict", async () => {
    const { ensureComputer } = await import("../src/computer/ensure.mjs");
    const r = await ensureComputer(
      { computer: { host: "0.0.0.0", port: 4243 } },
      { attempts: 0, log: false }
    );
    assert.equal(r.url, "http://127.0.0.1:4243");
  });

  it("giving up is written to the log, not returned silently", async () => {
    const { ensureComputer } = await import("../src/computer/ensure.mjs");
    const lines = [];
    const orig = console.error;
    console.error = (...a) => lines.push(a.join(" "));
    try {
      await ensureComputer({ computer: { host: "127.0.0.1", port: 4243 } }, { attempts: 0, log: true });
    } finally {
      console.error = orig;
    }
    assert.ok(
      lines.some((l) => /not healthy/i.test(l)),
      `expected a give-up line on stderr, got: ${JSON.stringify(lines)}`
    );
  });
});

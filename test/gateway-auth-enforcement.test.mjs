/**
 * The gateway's 401 gate must actually be REACHED (src/gateway/index.mjs).
 *
 * Two shipped bypasses, both of the same shape as the v3.188.0 bind guard: the
 * pure function was right the whole time and the half that PERFORMS had no
 * test. Every auth test in the suite calls createGatewayAuth().check() or
 * .isProtectedPath() directly; nothing drove an HTTP request through the real
 * request handler, so neither of these was visible.
 *
 *   1. /v1/<route>, open since 3.83.0 (d4f48d6, 2026-08-12) — 106 releases.
 *      index.mjs stripped the version prefix and asked
 *      isProtectedPath("/hooks"), while check() re-derived the path from the
 *      raw req.url, saw "/v1/hooks", matched no protection list and returned
 *      { ok: true, mode: "open" }. Proven before the fix on a real socket with
 *      a token configured: GET /hooks -> 401, GET /v1/hooks -> 200 with the
 *      hook configuration; POST /v1/hooks/commands -> 200 {"ok":true} and the
 *      shell command was persisted to xclaw.json and hot-applied. That is
 *      unauthenticated remote command installation.
 *
 *   2. /computer/proxy/* and /xclaw/computer/*. proxyComputerRequest returned
 *      above the gate, so the request never reached it, and the plane behind
 *      it answers POST /tool with any tool (bash included) while
 *      authenticating nothing itself. The proxy is on by default
 *      (isComputerProxyEnabled opts out, not in). "/xclaw/computer/" was not
 *      in the protected list at all, which is why auth.mjs now derives both
 *      prefixes from COMPUTER_PROXY_PREFIXES.
 *
 * Both landed the same way the bind guard did: a normalization added above an
 * enforcement point that was never told about it. The fix is one shared
 * stripApiVersion() and one gate — not two agreeing copies.
 *
 * A real child gateway on a real socket, because that is exactly the surface
 * the unit tests could not see. startGateway never resolves (it ends in
 * `await new Promise(() => {})`), so it cannot be awaited in-process.
 *
 * Both directions, one thing apart: every refusal case has a mirror that
 * changes only the Authorization header, because a gate that refuses
 * everything satisfies the negative cases alone. The proxy cases additionally
 * assert on the upstream's hit counter — a 401 could come from anywhere, but
 * "the computer plane was never contacted" can only be true if the gate ran
 * before the proxy.
 *
 * The MCP plane block below closes the same CLASS before it could ship open.
 * Unlike 1 and 2, /mcp was protected in prod the whole time — but by a single
 * list term (auth.mjs: p.startsWith("/mcp")) with no behavioural test, so a
 * one-line narrowing to "/mcp/oauth" opens the agent + data plane (POST /mcp
 * runs the agent, /mcp/call runs a tool, /mcp/servers writes credentials) with
 * the full suite green — measured, 3222/0. This drives those paths through the
 * real socket so that narrowing fails here instead.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = "t".repeat(64);
const BOOT_TIMEOUT_MS = 60_000;

let home;
let child;
let childLog = "";
let upstream;
let upstreamHits = [];
let gwPort;

/** One request against the child gateway. Never throws; 0 = no answer. */
function request(method, p, { headers = {}, body = null } = {}) {
  return new Promise((resolve) => {
    const payload = body == null ? null : JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: gwPort,
        path: p,
        method,
        timeout: 10_000,
        headers: {
          ...(payload
            ? {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(payload),
              }
            : {}),
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      }
    );
    req.on("error", (e) => resolve({ status: 0, headers: {}, body: String(e.message) }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ status: 0, headers: {}, body: "timeout" });
    });
    if (payload) req.write(payload);
    req.end();
  });
}

const withToken = { authorization: `Bearer ${TOKEN}` };

/**
 * One raw WebSocket upgrade against the child gateway; resolves with the HTTP
 * status line. Raw sockets because an upgrade is refused before any WS library
 * would hand back a usable error, and the status line is the whole assertion.
 */
function wsUpgrade(pathQuery, headers = {}) {
  return new Promise((resolve) => {
    const key = crypto.randomBytes(16).toString("base64");
    const sock = net.connect(gwPort, "127.0.0.1", () => {
      sock.write(
        [
          `GET ${pathQuery} HTTP/1.1`,
          "Host: 127.0.0.1",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${key}`,
          "Sec-WebSocket-Version: 13",
          ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
          "",
          "",
        ].join("\r\n")
      );
    });
    let buf = "";
    const done = (statusLine) => {
      sock.destroy();
      resolve(statusLine);
    };
    sock.on("data", (c) => {
      buf += c.toString("latin1");
      if (buf.includes("\r\n\r\n")) done(buf.split("\r\n")[0]);
    });
    sock.on("error", (e) => done(`ERROR ${e.message}`));
    setTimeout(() => done("TIMEOUT"), 10_000);
  });
}

before(async () => {
  // Stands in for the computer plane. Records every request that reaches it:
  // an empty log is the proof that the gate ran before the proxy.
  upstream = http.createServer((req, res) => {
    upstreamHits.push(`${req.method} ${req.url}`);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, upstream: req.url }));
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  const upstreamPort = upstream.address().port;

  // A free port for the gateway: bind 0, read it, release it.
  const probe = http.createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  gwPort = probe.address().port;
  await new Promise((r) => probe.close(r));

  home = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-authenf-"));
  fs.mkdirSync(path.join(home, ".xclaw"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".xclaw", "xclaw.json"),
    JSON.stringify(
      {
        profile: "lab",
        gateway: { host: "127.0.0.1", port: gwPort, token: TOKEN },
        // autoStart false: the proxy still forwards, but to the fake above.
        computer: { host: "127.0.0.1", port: upstreamPort, autoStart: false },
        channels: { telegram: { enabled: false }, webchat: { enabled: false } },
        tokens: { probeOnStart: false },
      },
      null,
      2
    )
  );

  child = spawn(process.execPath, ["bin/xclaw.mjs", "gateway"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      XCLAW_HOME: home,
      XCLAW_PROFILE: "lab",
      XAI_API_KEY: "xai-test-dummy",
      NODE_ENV: "test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => (childLog += d));
  child.stderr.on("data", (d) => (childLog += d));

  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  let up = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    const r = await request("GET", "/health");
    if (r.status === 200) {
      up = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(up, `gateway never became healthy on :${gwPort}\n${childLog.slice(-2000)}`);
  upstreamHits = [];
});

after(async () => {
  if (child) {
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 600));
    child.kill("SIGKILL");
  }
  if (upstream) await new Promise((r) => upstream.close(r));
  if (home) fs.rmSync(home, { recursive: true, force: true });
});

describe("the /v1 alias does not bypass gateway auth", () => {
  it("refuses a protected route without a token", async () => {
    const r = await request("GET", "/hooks");

    assert.equal(r.status, 401, `expected 401 (got ${r.status}: ${r.body.slice(0, 120)})`);
  });

  it("refuses the same route through /v1 without a token", async () => {
    // The bypass itself. Returned 200 with the hook configuration before 3.190.0.
    const r = await request("GET", "/v1/hooks");

    assert.equal(r.status, 401, `/v1 must not be an auth bypass (got ${r.status}: ${r.body.slice(0, 160)})`);
  });

  it("serves the same /v1 route once the token is presented", async () => {
    // Only the header moves. Without this a gate that 401s every /v1 request
    // passes the case above while breaking the alias for real clients.
    const r = await request("GET", "/v1/hooks", { headers: withToken });

    assert.notEqual(r.status, 401, `an authenticated /v1 call must pass (${r.body.slice(0, 160)})`);
    assert.equal(r.headers["x-xclaw-api-version"], "1", "the version header still marks the alias");
  });

  it("keeps open routes open, with and without the version prefix", async () => {
    // Proves the prefix is still being STRIPPED, not merely refused: /v1/health
    // only resolves to the alwaysOpen /health if normalization happened.
    const plain = await request("GET", "/health");
    const aliased = await request("GET", "/v1/health");

    assert.equal(plain.status, 200);
    assert.equal(aliased.status, 200, `/v1/health must still resolve to /health (got ${aliased.status})`);
  });

  it("does not let a doubled prefix reach a route auth did not see", async () => {
    // Auth and routing normalize with the same function, so both see
    // "/v1/hooks" here: auth leaves it open, routing has no such route. The
    // property that matters is that no reachable route skipped the gate.
    const r = await request("GET", "/v1/v1/hooks", { headers: {} });

    assert.notEqual(r.status, 200, `a doubled prefix must not serve a protected route (${r.body.slice(0, 160)})`);
    assert.equal(r.status, 404);
  });
});

describe("the computer plane is behind gateway auth", () => {
  it("refuses POST /computer/proxy/tool without a token, before contacting the plane", async () => {
    upstreamHits = [];

    const r = await request("POST", "/computer/proxy/tool", {
      body: { name: "bash", arguments: { command: "id" } },
    });

    assert.equal(r.status, 401, `expected 401 (got ${r.status}: ${r.body.slice(0, 160)})`);
    assert.deepEqual(upstreamHits, [], "the computer plane must never be contacted by an unauthenticated caller");
  });

  it("forwards the same call once the token is presented", async () => {
    upstreamHits = [];

    const r = await request("POST", "/computer/proxy/tool", {
      headers: withToken,
      body: { name: "bash", arguments: { command: "id" } },
    });

    assert.equal(r.status, 200, `an authenticated proxy call must still forward (${r.body.slice(0, 160)})`);
    assert.deepEqual(upstreamHits, ["POST /tool"], "the prefix must still be stripped for the upstream");
  });

  it("refuses the /xclaw/computer alias without a token", async () => {
    // The half no protected-path entry covered: "/computer/" does not prefix
    // "/xclaw/computer/", so this route answered every caller.
    upstreamHits = [];

    const r = await request("GET", "/xclaw/computer/tools");

    assert.equal(r.status, 401, `expected 401 (got ${r.status}: ${r.body.slice(0, 160)})`);
    assert.deepEqual(upstreamHits, [], "the computer plane must never be contacted by an unauthenticated caller");
  });

  it("forwards the /xclaw/computer alias once the token is presented", async () => {
    upstreamHits = [];

    const r = await request("GET", "/xclaw/computer/tools", { headers: withToken });

    assert.equal(r.status, 200, `an authenticated alias call must still forward (${r.body.slice(0, 160)})`);
    assert.deepEqual(upstreamHits, ["GET /tools"]);
  });
});

describe("every WebSocket endpoint is behind the same gate", () => {
  // The third bypass of this shape, live from 3.131.0 (b4ecb14) to 3.191.0.
  // /ws/voice asked `auth.isProtectedPath("/ws/voice")` before consulting
  // check() — and no protection list contains "/ws/voice", so the gate was
  // dead code and the socket answered everyone. Proven on the production
  // gateway (token configured) before the fix: the upgrade returned 101, the
  // server sent its `ready` frame with workingDir /root/.xclaw/workspaces, and
  // a client {"type":"ping"} was answered — one frame short of
  // {"type":"command"}, which reaches runAgent with the full tool pack.
  //
  // /ws/events was never affected: it asks authorizeWebSocket, which gates on
  // "is a token configured", not on the path. Both now ask that one function,
  // and both are asserted here because the unit test (test/ws-auth.test.mjs)
  // passes the correct lambda by hand — only the real process proves the
  // WIRING in index.mjs, which is where this defect lived.
  it("refuses a /ws/voice upgrade without a token", async () => {
    const line = await wsUpgrade("/ws/voice");

    assert.match(line, /401/, `the voice socket runs the agent and must be gated (got: ${line})`);
  });

  it("accepts /ws/voice once the token is presented", async () => {
    // Only the credential moves; a gate that refuses every upgrade would pass
    // the case above while taking the feature offline.
    const line = await wsUpgrade(`/ws/voice?token=${TOKEN}`);

    assert.match(line, /101 Switching Protocols/, `an authenticated voice upgrade must pass (got: ${line})`);
  });

  it("echoes the token subprotocol so a browser can complete the handshake", async () => {
    // Browsers cannot set Authorization on an upgrade; the subprotocol is the
    // only carrier they have, and an unechoed subprotocol fails the handshake
    // client-side even after a 101.
    const line = await new Promise((resolve) => {
      const key = crypto.randomBytes(16).toString("base64");
      const sock = net.connect(gwPort, "127.0.0.1", () => {
        sock.write(
          [
            "GET /ws/voice HTTP/1.1",
            "Host: 127.0.0.1",
            "Upgrade: websocket",
            "Connection: Upgrade",
            `Sec-WebSocket-Key: ${key}`,
            "Sec-WebSocket-Version: 13",
            `Sec-WebSocket-Protocol: xclaw.token.${TOKEN}`,
            "",
            "",
          ].join("\r\n")
        );
      });
      let buf = "";
      sock.on("data", (c) => {
        buf += c.toString("latin1");
        if (buf.includes("\r\n\r\n")) {
          sock.destroy();
          resolve(buf.split("\r\n\r\n")[0]);
        }
      });
      sock.on("error", (e) => resolve(`ERROR ${e.message}`));
      setTimeout(() => resolve("TIMEOUT"), 10_000);
    });

    assert.match(line, /101 Switching Protocols/);
    assert.match(line, new RegExp(`Sec-WebSocket-Protocol: xclaw\\.token\\.${TOKEN}`));
  });

  it("refuses a /ws/events upgrade without a token", async () => {
    const line = await wsUpgrade("/ws/events");

    assert.match(line, /401/, `the event stream must stay gated (got: ${line})`);
  });

  it("accepts /ws/events once the token is presented", async () => {
    const line = await wsUpgrade(`/ws/events?token=${TOKEN}`);

    assert.match(line, /101 Switching Protocols/, `an authenticated event upgrade must pass (got: ${line})`);
  });
});

describe("the MCP JSON-RPC plane is behind the same gate", () => {
  // The same shape as the three bypasses above, waiting to happen on the whole
  // /mcp surface. POST /mcp runs the agent as an MCP server; POST /mcp/call
  // invokes a tool (bash included); POST /mcp/servers writes MCP config and
  // stored credentials; /mcp/resources reads resources and transcripts. The
  // entire plane is protected by a single list term (auth.mjs:
  // p.startsWith("/mcp")). Narrowing it to "/mcp/oauth" keeps the only /mcp
  // paths any prior test touched — the OAuth subpaths, pinned by
  // gateway-auth-cost-usage.test.mjs — protected while opening every agent and
  // data path, and the full suite stayed green (measured: 3222/0). routes-map
  // now declares these so gateway-route-coverage sees the list drift; this
  // drives them through the wired socket so a WIRING skip — a gate reached only
  // for some paths, exactly the /v1 + computer + /ws/voice defects this file
  // exists for — is caught too.
  const ANON_401 = [
    ["POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" }], // runs the agent
    ["POST", "/mcp/call", { name: "bash", arguments: { command: "id" } }], // invokes a tool
    ["GET", "/mcp/servers", null], // POST here writes config + stored credentials
    ["GET", "/mcp/resources", null], // reads resources / transcripts
    ["POST", "/mcp/oauth/start", { server: "x" }], // gated OAuth POST, through the socket
  ];
  for (const [method, p, body] of ANON_401) {
    it(`refuses ${method} ${p} without a token`, async () => {
      const r = await request(method, p, body ? { body } : {});
      assert.equal(
        r.status,
        401,
        `${p} exposes the MCP agent/data plane and must be gated (got ${r.status}: ${r.body.slice(0, 160)})`
      );
    });
  }

  it("serves POST /mcp to the operator (the gate is the only thing that moved)", async () => {
    const r = await request("POST", "/mcp", {
      headers: withToken,
      body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    assert.notEqual(r.status, 401, `the operator must still reach the MCP server (${r.body.slice(0, 160)})`);
  });

  it("serves GET /mcp/servers to the operator", async () => {
    const r = await request("GET", "/mcp/servers", { headers: withToken });
    assert.notEqual(r.status, 401, `the operator must still list MCP servers (${r.body.slice(0, 160)})`);
  });

  it("leaves /mcp/oauth/callback open — path discrimination, not a blanket refusal", async () => {
    // The one MCP path that authenticates itself (with the state it issued),
    // never the operator token. That it answers non-401 anonymously proves the
    // 401s above are the gate deciding per path, and that alwaysOpen still
    // reaches through the wiring.
    const r = await request("GET", "/mcp/oauth/callback?code=x&state=y");
    assert.notEqual(r.status, 401, `the AS redirect must not require the operator token (got ${r.status})`);
  });
});

describe("the ledger / usage / diagnostics data plane is behind the same gate", () => {
  // 3.195.0. Each of these was a route the router served and no auth list named,
  // so on the default token gateway an anonymous GET answered 200 with real
  // data: /ledger the full command+actor+spend audit history, /usage/* spend and
  // session previews (only the exact /usage arm was gated, not the prefix its
  // siblings /cost and /logs both gate), /gateway/doctor + /status/report + /routes
  // the diagnostics and the whole served attack surface. /api/voice/* runs the
  // local synth/transcribe compute. This drives them through the wired socket so
  // a WIRING skip — the class this file exists for — is caught, not just the
  // pure isProtectedPath check the inventory test covers.
  const ANON_401 = [
    ["GET", "/ledger", null], // full audit history
    ["GET", "/ledger/stats", null], // cost rollup
    ["GET", "/ledger/who-touched?path=x", null], // per-file actor trail
    ["GET", "/usage/cache", null], // the sibling that fell through the missing prefix
    ["GET", "/usage/dashboard", null], // spend + session preview
    ["GET", "/usage/efficiency", null],
    ["GET", "/gateway/doctor", null], // detailed diagnostics under the un-gated prefix
    ["GET", "/status/report", null], // status markdown
    ["GET", "/routes", null], // the entire served attack surface as JSON
    ["POST", "/api/voice/speak", { text: "x" }], // local synth compute
    ["POST", "/api/voice/transcribe", { audio: "x" }], // local transcribe compute
  ];
  for (const [method, p, body] of ANON_401) {
    it(`refuses ${method} ${p} without a token`, async () => {
      const r = await request(method, p, body ? { body } : {});
      assert.equal(
        r.status,
        401,
        `${p} exposed data/compute unauthenticated and must be gated (got ${r.status}: ${r.body.slice(0, 160)})`
      );
    });
  }

  it("serves GET /ledger to the operator (the gate is the only thing that moved)", async () => {
    const r = await request("GET", "/ledger", { headers: withToken });
    assert.notEqual(r.status, 401, `the operator must still read the ledger (${r.body.slice(0, 160)})`);
  });

  it("leaves /gateway/info open — the supervisor's liveness poll, not a data leak", async () => {
    // The one diagnostics-adjacent path that must answer anonymously: the
    // supervisor polls it every 15s and restarts on any non-2xx. That it is
    // non-401 while /gateway/doctor above is 401 proves the gate decides per
    // path, and that the open decision reaches through the wiring.
    const r = await request("GET", "/gateway/info");
    assert.notEqual(r.status, 401, `the supervisor liveness path must stay open (got ${r.status})`);
  });
});

describe("the 401 stays usable from a browser", () => {
  it("answers a refused cross-origin call with CORS headers", async () => {
    // The gate moved above applyCors in 3.190.0; without an explicit call on
    // the refusal path a browser client sees an opaque network error instead
    // of the status.
    const r = await request("GET", "/hooks", { headers: { origin: "http://127.0.0.1:5173" } });

    assert.equal(r.status, 401);
    assert.ok(
      r.headers["access-control-allow-origin"],
      `a 401 must still carry CORS headers (saw: ${JSON.stringify(r.headers)})`
    );
  });
});

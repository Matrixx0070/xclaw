/**
 * The approval endpoints refuse anonymous callers on a REAL gateway socket.
 *
 * gateway-approvals-auth.test.mjs asserts what isProtectedPath decides. It
 * cannot catch the defect that shipped, because the defect WAS the list: the
 * router served /approvals and /agent-runs and no auth list named them, and a
 * test of the list agrees with the list by construction. This drives real
 * requests through the wired gateway, exactly as the leak was measured on the
 * live one:
 *
 *   pre-fix, no credentials:
 *     200  GET  /approvals          {pending:[...]}  — full command + args
 *     200  GET  /agent-runs         real session history
 *     404  POST /approvals/approve  APPROVAL_NOT_FOUND — the handler ran
 *
 * The 404 on approve is the tell this test is built around: pre-fix an
 * anonymous approve REACHED the decide() handler and only failed for want of a
 * matching pending id. Post-fix the gate refuses first, so the same request is
 * 401 — a different layer, provable without a real pending. Every anonymous
 * refusal has a token mirror that changes only the Authorization header, so a
 * gateway that 401s everything cannot be mistaken for the gate working.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = "a".repeat(64);
const BOOT_TIMEOUT_MS = 60_000;

let home;
let child;
let childLog = "";
let gwPort;

function request(method, p, { token = false, body = null } = {}) {
  return new Promise((resolve) => {
    const headers = {};
    if (token) headers.authorization = `Bearer ${TOKEN}`;
    let payload = null;
    if (body != null) {
      payload = typeof body === "string" ? body : JSON.stringify(body);
      headers["content-type"] = "application/json";
      headers["content-length"] = Buffer.byteLength(payload);
    }
    const req = http.request(
      { hostname: "127.0.0.1", port: gwPort, path: p, method, timeout: 10_000, headers },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on("error", (e) => resolve({ status: 0, body: String(e.message) }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ status: 0, body: "timeout" });
    });
    if (payload != null) req.write(payload);
    req.end();
  });
}

before(async () => {
  const probe = http.createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  gwPort = probe.address().port;
  await new Promise((r) => probe.close(r));

  home = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-approvals-"));
  fs.mkdirSync(path.join(home, ".xclaw"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".xclaw", "xclaw.json"),
    JSON.stringify(
      {
        profile: "lab",
        // The shipped default: a token IS configured. This is the gateway the
        // live leak was measured on — not a non-default mode.
        gateway: { host: "127.0.0.1", port: gwPort, token: TOKEN },
        computer: { autoStart: false },
        channels: { telegram: { enabled: false }, webchat: { enabled: true } },
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
    if ((await request("GET", "/health")).status === 200) {
      up = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(up, `gateway never became healthy on :${gwPort}\n${childLog.slice(-2000)}`);
});

after(async () => {
  if (child) {
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 600));
    child.kill("SIGKILL");
  }
  if (home) fs.rmSync(home, { recursive: true, force: true });
});

describe("approval endpoints on a live gateway", () => {
  const READS = ["/approvals", "/approvals/pending", "/agent-runs"];

  for (const p of READS) {
    it(`refuses GET ${p} without a token`, async () => {
      const r = await request("GET", p);
      assert.equal(r.status, 401, `${p} answered anonymously (${r.status}: ${r.body.slice(0, 160)})`);
    });
  }

  it("refuses POST /approvals/approve without a token — 401, not the pre-fix 404", async () => {
    // The whole point. Pre-fix this request reached decide() and returned 404
    // APPROVAL_NOT_FOUND; the gate now stops it at 401. A plain "not 200" would
    // have passed against the broken gateway too, so assert the layer.
    const r = await request("POST", "/approvals/approve", { body: { id: "apr_nope", note: "anon" } });
    assert.equal(
      r.status,
      401,
      `approve was reachable without a token (${r.status}: ${r.body.slice(0, 160)})`
    );
    assert.ok(!/APPROVAL_NOT_FOUND/.test(r.body), "handler ran — the gate did not refuse first");
  });

  it("refuses POST /approvals/deny without a token", async () => {
    const r = await request("POST", "/approvals/deny", { body: { id: "apr_nope" } });
    assert.equal(r.status, 401, `deny was reachable without a token (${r.status}: ${r.body.slice(0, 160)})`);
  });

  // Token mirrors: the operator still reaches every handler. Without these, a
  // gateway that refused all approval traffic would pass the block above and
  // silently break the operator's own approve/deny.
  for (const p of READS) {
    it(`serves GET ${p} to the operator`, async () => {
      const r = await request("GET", p, { token: true });
      assert.notEqual(r.status, 401, `${p} unreachable WITH the token (${r.body.slice(0, 160)})`);
    });
  }

  it("lets the operator reach decide() — bogus id returns the handler's 404, not 401", async () => {
    const r = await request("POST", "/approvals/approve", { token: true, body: { id: "apr_nope" } });
    assert.notEqual(r.status, 401, `operator was gated out of approve (${r.body.slice(0, 160)})`);
    // With a real token the request passes the gate and decide() answers; there
    // is no such pending, so the handler's own 404/409 is the expected shape.
    assert.ok(
      r.status === 404 || r.status === 409 || r.status === 400,
      `unexpected approve response for a bogus id (${r.status}: ${r.body.slice(0, 160)})`
    );
  });

  it("controls: /security/pending 401 anon, /health 200 anon", async () => {
    // Proves auth is ON (the canonical twin still refuses) and that the 401s
    // above are the gate deciding, not the gateway refusing everything.
    const canonical = await request("GET", "/security/pending");
    const health = await request("GET", "/health");
    assert.equal(canonical.status, 401, `/security/pending leaked (${canonical.body.slice(0, 160)})`);
    assert.equal(health.status, 200, "/health should stay open");
  });
});

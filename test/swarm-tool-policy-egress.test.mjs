/**
 * Swarm ToolPolicy egress gate — canExecute decisions + bridge wiring.
 *
 * `ToolPolicy.canExecute` (src/swarm/decompose/tool-policy.mjs) is the operator
 * egress gate for the swarm tool plane: createXclawToolBridge instantiates it
 * whenever `cfg.swarm.decompose.tools.policy` is set (runtime.mjs:87 builds the
 * bridge for the inbound /swarm plane), and tool-bridge.mjs runs it BEFORE the
 * risk gate on EVERY tool — including alwaysAllow ones — so the operator's deny
 * beats the research bypass. It decides four things: blocklist (tool_blocked),
 * allowlist-mode tool names (not_in_allowlist), network-egress deny
 * (egress_denied), and a URL host-allowlist for any tool carrying a `url`
 * (url_not_allowed).
 *
 * That host match had a real bypass: the vendored form was
 * `hostname.includes(entry)`, which let `allowed.com.attacker.io` satisfy an
 * allowlist of `allowed.com` (fixed 2026-08-24 to exact-host OR dot-suffix
 * only). And `canExecute` had ZERO behavioural test — no test imported
 * tool-policy.mjs, and no bridge test set `tools.policy`. Mutating the host
 * match back to the vulnerable `host.includes(entry)` left the FULL suite green
 * (3575/0): a silent revert of a known security fix would ship unnoticed.
 *
 * This file pins the gate. The load-bearing case is the substring-bypass
 * rejection — asserted both at the pure decision and END TO END through the
 * bridge's execute(), so it proves the handler actually HONORS the deny, not
 * just that the function returns the right object.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolPolicy } from "../src/swarm/decompose/tool-policy.mjs";
import { createXclawToolBridge } from "../src/swarm/tool-bridge.mjs";

const ws = () => mkdtempSync(join(tmpdir(), "swarm-toolpolicy-"));

// --- pure decision surface ---------------------------------------------------

test("blocklisted tool is refused (tool_blocked)", () => {
  const p = new ToolPolicy({ blocklist: ["danger_tool"] });
  assert.deepEqual(p.canExecute("danger_tool"), { allowed: false, reason: "tool_blocked" });
  assert.deepEqual(p.canExecute("web_search"), { allowed: true });
});

test("allowlist egress mode gates by tool name (not_in_allowlist)", () => {
  const p = new ToolPolicy({ egress: "allowlist", allowlist: ["web_search"] });
  assert.deepEqual(p.canExecute("web_search"), { allowed: true });
  assert.deepEqual(p.canExecute("bash"), { allowed: false, reason: "not_in_allowlist" });
});

test("deny egress mode blocks network tools only (egress_denied)", () => {
  const p = new ToolPolicy({ egress: "deny" });
  for (const t of ["web_search", "browser", "web_extract", "web_crawl"]) {
    assert.deepEqual(p.canExecute(t), { allowed: false, reason: "egress_denied" }, t);
  }
  // a non-network tool is unaffected by egress:deny
  assert.deepEqual(p.canExecute("grep"), { allowed: true });
});

test("URL host-allowlist: exact host and dot-suffix subdomain are allowed", () => {
  const p = new ToolPolicy({ egress: "allow", allowlist: ["allowed.com"] });
  assert.deepEqual(p.canExecute("web_fetch", { url: "https://allowed.com/x" }), { allowed: true });
  assert.deepEqual(p.canExecute("web_fetch", { url: "https://api.allowed.com/x" }), { allowed: true });
});

test("URL host-allowlist REJECTS the substring bypass (url_not_allowed) — the proven mutation", () => {
  const p = new ToolPolicy({ egress: "allow", allowlist: ["allowed.com"] });
  // `allowed.com.attacker.io` contains `allowed.com` as a substring but is NOT
  // allowed.com nor a subdomain of it. The vendored `host.includes(entry)` let
  // it through; exact/dot-suffix must reject it.
  assert.deepEqual(
    p.canExecute("web_fetch", { url: "https://allowed.com.attacker.io/x" }),
    { allowed: false, reason: "url_not_allowed" },
  );
  // a prefix-glued host (`allowed.com` as a suffix substring without the dot)
  assert.deepEqual(
    p.canExecute("web_fetch", { url: "https://xallowed.com/x" }),
    { allowed: false, reason: "url_not_allowed" },
  );
  // an entirely unrelated host
  assert.deepEqual(
    p.canExecute("web_fetch", { url: "https://evil.io/x" }),
    { allowed: false, reason: "url_not_allowed" },
  );
});

test("URL host-allowlist is fail-open when no allowlist is configured", () => {
  // empty allowlist = no restriction (the class's documented default); a url
  // must not be blocked just because it is present.
  const p = new ToolPolicy({ egress: "allow" });
  assert.deepEqual(p.canExecute("web_fetch", { url: "https://anything.io/x" }), { allowed: true });
});

// --- bridge wiring: execute() must HONOR the deny -----------------------------

function fakes() {
  const dispatched = [];
  const computer = {
    async listTools() {
      return [{ name: "xclaw_bash", description: "run bash", inputSchema: {} }];
    },
    async createSession() { return "sess-fake"; },
    async destroySession() {},
  };
  const localTools = [
    {
      name: "web_search",
      description: "real search",
      parameters: { type: "object", properties: { query: { type: "string" } } },
      execute: async () => ({}),
    },
  ];
  const router = {
    async dispatch(req) {
      dispatched.push(req);
      return { ok: true, plane: "fake", durationMs: 1, result: { content: [{ type: "text", text: `ran:${req.name}` }] } };
    },
  };
  return { computer, sessionId: "sess-fake", localTools, router, dispatched };
}

const policyCfg = () => ({
  swarm: { decompose: { tools: { policy: { egress: "allow", allowlist: ["allowed.com"] } } } },
});

test("bridge execute() BLOCKS a substring-bypass url end-to-end (deny beats alwaysAllow)", async () => {
  const f = fakes();
  const b = await createXclawToolBridge(policyCfg(), { ...f, workingDir: ws() });
  // web_search is on alwaysAllow, so the risk gate would pass it — the operator
  // egress policy runs first and must stop it.
  const out = await b.execute("web_search", { url: "https://allowed.com.attacker.io/x", query: "q" });
  assert.equal(out.success, false);
  assert.equal(out.blocked, true);
  assert.match(out.error, /url_not_allowed/);
  assert.equal(f.dispatched.length, 0, "a policy-blocked call must never reach the router");
});

test("bridge execute() ALLOWS an exact-host url through the same policy", async () => {
  const f = fakes();
  const b = await createXclawToolBridge(policyCfg(), { ...f, workingDir: ws() });
  const out = await b.execute("web_search", { url: "https://allowed.com/x", query: "q" });
  assert.equal(out.success, true, out.error);
  assert.equal(f.dispatched.length, 1, "an allowed call must reach the router");
});

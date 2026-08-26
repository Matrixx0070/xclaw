import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseNoisyJson,
  tailnetHostFromStatus,
  tailnetIpFromStatus,
  getTailnetHost,
  getTailnetIp,
  enableTailscaleServe,
  disableTailscaleServe,
  enableTailscaleFunnel,
  disableTailscaleFunnel,
  parseWhoisIdentity,
  readTailscaleWhoisIdentity,
  resetTailscaleWhoisCache,
  tailnetHttpsOrigin,
  resolveGatewayBindHost,
  coupleTailscaleExposure,
  startGatewayTailscaleExposure,
} from "../src/net/tailscale.mjs";

// A tailnet node with a trailing-dot DNS name and two IPs (v4 first).
const STATUS = JSON.stringify({
  Self: { DNSName: "node.tail1234.ts.net.", TailscaleIPs: ["100.64.0.1", "fd7a::1"] },
});
const WHOIS = JSON.stringify({
  UserProfile: { LoginName: "frank@example.com", DisplayName: "Frank" },
});

// Recording exec double: no real binary is ever spawned. Every injectable
// call site is exercised with an explicit `bin` string so findTailscaleBinary
// (which would shell out to which/where) is never reached.
function recordingExec(responder) {
  const calls = [];
  const fn = (bin, args, opts = {}) => {
    calls.push({ bin, args: [...args], opts });
    return (responder && responder(args, { bin, opts })) || { status: 0, stdout: "", stderr: "" };
  };
  fn.calls = calls;
  return fn;
}

// Branches on the tailscale subcommand so one double serves status/serve/funnel/whois.
function tsExec({ ok = true, statusJson = STATUS, whoisJson = WHOIS } = {}) {
  return recordingExec((args) => {
    if (args[0] === "status") return { status: 0, stdout: statusJson, stderr: "" };
    if (args[0] === "whois") return { status: 0, stdout: whoisJson, stderr: "" };
    if (args[0] === "serve" || args[0] === "funnel") {
      return ok ? { status: 0, stdout: "", stderr: "" } : { status: 1, stdout: "", stderr: "boom" };
    }
    return { status: 0, stdout: "", stderr: "" };
  });
}

describe("tailscale · parseNoisyJson", () => {
  it("parses clean JSON", () => {
    assert.deepEqual(parseNoisyJson('{"a":1}'), { a: 1 });
  });
  it("slices JSON out of noisy CLI output", () => {
    assert.deepEqual(parseNoisyJson('warning: something\n{"a":1}\ntrailing noise'), { a: 1 });
  });
  it("returns {} for empty / whitespace", () => {
    assert.deepEqual(parseNoisyJson(""), {});
    assert.deepEqual(parseNoisyJson("   \n "), {});
  });
});

describe("tailscale · host/IP extraction from status", () => {
  it("prefers DNSName for host and strips the trailing dot", () => {
    assert.equal(tailnetHostFromStatus(JSON.parse(STATUS)), "node.tail1234.ts.net");
  });
  it("falls back to the first IP for host when no DNSName", () => {
    assert.equal(tailnetHostFromStatus({ Self: { TailscaleIPs: ["100.64.0.2"] } }), "100.64.0.2");
  });
  it("tailnetIpFromStatus returns the first IP (bindable), never the DNS name", () => {
    assert.equal(tailnetIpFromStatus(JSON.parse(STATUS)), "100.64.0.1");
  });
  it("returns null when Self / IPs absent", () => {
    assert.equal(tailnetHostFromStatus({}), null);
    assert.equal(tailnetIpFromStatus({ Self: {} }), null);
  });
});

describe("tailscale · getTailnetHost / getTailnetIp", () => {
  it("runs `status --json` and resolves host + IP", () => {
    const exec = tsExec();
    assert.equal(getTailnetHost({ exec, bin: "tailscale" }), "node.tail1234.ts.net");
    assert.deepEqual(exec.calls[0].args, ["status", "--json"]);
    assert.equal(getTailnetIp({ exec, bin: "tailscale" }), "100.64.0.1");
  });
  it("degrades to null (never throws) with no binary or a non-zero status", () => {
    assert.equal(getTailnetHost({ exec: tsExec(), bin: null }), null);
    const bad = recordingExec(() => ({ status: 1, stdout: "", stderr: "down" }));
    assert.equal(getTailnetHost({ exec: bad, bin: "tailscale" }), null);
    assert.equal(getTailnetIp({ exec: bad, bin: "tailscale" }), null);
  });
});

describe("tailscale · serve/funnel argv", () => {
  it("serve enable → `serve --bg --yes <port>`", () => {
    const exec = recordingExec();
    assert.deepEqual(enableTailscaleServe(18790, { exec, bin: "tailscale" }), { ok: true });
    assert.deepEqual(exec.calls[0].args, ["serve", "--bg", "--yes", "18790"]);
  });
  it("serve reset → `serve reset`", () => {
    const exec = recordingExec();
    assert.deepEqual(disableTailscaleServe({ exec, bin: "tailscale" }), { ok: true });
    assert.deepEqual(exec.calls[0].args, ["serve", "reset"]);
  });
  it("funnel enable → `funnel --bg --yes <port>`", () => {
    const exec = recordingExec();
    assert.deepEqual(enableTailscaleFunnel(443, { exec, bin: "tailscale" }), { ok: true });
    assert.deepEqual(exec.calls[0].args, ["funnel", "--bg", "--yes", "443"]);
  });
  it("funnel reset → `funnel reset`", () => {
    const exec = recordingExec();
    assert.deepEqual(disableTailscaleFunnel({ exec, bin: "tailscale" }), { ok: true });
    assert.deepEqual(exec.calls[0].args, ["funnel", "reset"]);
  });
  it("surfaces the CLI error on non-zero exit", () => {
    const exec = recordingExec(() => ({ status: 1, stdout: "", stderr: "needs login" }));
    assert.deepEqual(enableTailscaleServe(1, { exec, bin: "tailscale" }), {
      ok: false,
      error: "needs login",
    });
  });
  it("reports a missing binary rather than shelling out", () => {
    assert.deepEqual(enableTailscaleServe(1, { bin: null }), {
      ok: false,
      error: "tailscale binary not found",
    });
  });
});

describe("tailscale · whois identity", () => {
  it("extracts { login, name } from a UserProfile", () => {
    assert.deepEqual(parseWhoisIdentity(JSON.parse(WHOIS)), {
      login: "frank@example.com",
      name: "Frank",
    });
  });
  it("login is required; name is best-effort", () => {
    assert.equal(parseWhoisIdentity({}), null);
    assert.deepEqual(parseWhoisIdentity({ UserProfile: { LoginName: "x@y" } }), { login: "x@y" });
  });
  it("runs `whois --json <ip>` and caches success for 60s", () => {
    resetTailscaleWhoisCache();
    const exec = recordingExec(() => ({ status: 0, stdout: WHOIS, stderr: "" }));
    const id = readTailscaleWhoisIdentity("100.64.0.5", { exec, bin: "tailscale", now: 1000 });
    assert.deepEqual(id, { login: "frank@example.com", name: "Frank" });
    assert.deepEqual(exec.calls[0].args, ["whois", "--json", "100.64.0.5"]);
    // within TTL → cache hit, no second CLI call
    readTailscaleWhoisIdentity("100.64.0.5", { exec, bin: "tailscale", now: 1000 + 59_000 });
    assert.equal(exec.calls.length, 1);
    // past TTL → refetched
    readTailscaleWhoisIdentity("100.64.0.5", { exec, bin: "tailscale", now: 1000 + 61_000 });
    assert.equal(exec.calls.length, 2);
  });
  it("caches the error (null) for a shorter 5s TTL", () => {
    resetTailscaleWhoisCache();
    const exec = recordingExec(() => ({ status: 1, stdout: "", stderr: "no peer" }));
    assert.equal(readTailscaleWhoisIdentity("1.2.3.4", { exec, bin: "tailscale", now: 0 }), null);
    assert.equal(readTailscaleWhoisIdentity("1.2.3.4", { exec, bin: "tailscale", now: 4000 }), null);
    assert.equal(exec.calls.length, 1); // error cached, not re-run within 5s
    readTailscaleWhoisIdentity("1.2.3.4", { exec, bin: "tailscale", now: 6000 });
    assert.equal(exec.calls.length, 2);
  });
});

describe("tailscale · tailnetHttpsOrigin", () => {
  it("builds an https origin and strips a trailing dot", () => {
    assert.equal(tailnetHttpsOrigin("node.ts.net"), "https://node.ts.net");
    assert.equal(tailnetHttpsOrigin("node.ts.net."), "https://node.ts.net");
  });
  it("returns null for empty input", () => {
    assert.equal(tailnetHttpsOrigin(""), null);
    assert.equal(tailnetHttpsOrigin(null), null);
  });
});

describe("tailscale · resolveGatewayBindHost", () => {
  it("loopback/auto → 127.0.0.1", () => {
    assert.equal(resolveGatewayBindHost({ gateway: { bind: "loopback" } }), "127.0.0.1");
    assert.equal(resolveGatewayBindHost({ gateway: { bind: "auto" } }), "127.0.0.1");
  });
  it("lan → 0.0.0.0", () => {
    assert.equal(resolveGatewayBindHost({ gateway: { bind: "lan" } }), "0.0.0.0");
  });
  it("custom/default → the explicit host unchanged (back-compat)", () => {
    assert.equal(resolveGatewayBindHost({ gateway: { bind: "custom", host: "1.2.3.4" } }), "1.2.3.4");
    assert.equal(resolveGatewayBindHost({ gateway: { host: "5.6.7.8" } }), "5.6.7.8");
  });
  it("tailnet → the tailnet IP, degrading to loopback when unreachable", () => {
    assert.equal(
      resolveGatewayBindHost({ gateway: { bind: "tailnet" } }, { exec: tsExec(), bin: "tailscale" }),
      "100.64.0.1"
    );
    const down = recordingExec(() => ({ status: 1, stdout: "", stderr: "" }));
    assert.equal(
      resolveGatewayBindHost({ gateway: { bind: "tailnet" } }, { exec: down, bin: "tailscale" }),
      "127.0.0.1"
    );
  });
});

describe("tailscale · coupleTailscaleExposure", () => {
  it("mode off is a no-op (same reference)", () => {
    const cfg = { gateway: { bind: "lan", host: "0.0.0.0", tailscale: { mode: "off" } } };
    assert.equal(coupleTailscaleExposure(cfg), cfg);
  });
  it("serve forces loopback + 127.0.0.1 and records what it overrode", () => {
    const cfg = { gateway: { bind: "lan", host: "0.0.0.0", tailscale: { mode: "serve" } } };
    const out = coupleTailscaleExposure(cfg);
    assert.notEqual(out, cfg); // new object, input untouched
    assert.equal(cfg.gateway.bind, "lan");
    assert.equal(out.gateway.bind, "loopback");
    assert.equal(out.gateway.host, "127.0.0.1");
    assert.equal(out.gateway.authStrict, undefined); // serve is tailnet-internal, no auth force
    assert.ok(out._tailscaleCoupling.length >= 2);
  });
  it("funnel additionally forces authStrict (public internet)", () => {
    const out = coupleTailscaleExposure({ gateway: { tailscale: { mode: "funnel" } } });
    assert.equal(out.gateway.bind, "loopback");
    assert.equal(out.gateway.authStrict, true);
    assert.ok(out._tailscaleCoupling.some((n) => /authStrict/.test(n)));
  });
});

describe("tailscale · startGatewayTailscaleExposure", () => {
  it("mode off → null (no exposure)", () => {
    assert.equal(
      startGatewayTailscaleExposure({ cfg: { gateway: { tailscale: { mode: "off" } } }, port: 1 }),
      null
    );
  });
  it("serve success → active handle, resolved host, correct argv, cors injection", () => {
    const cfg = {
      gateway: { port: 18790, corsOrigin: ["https://x"], tailscale: { mode: "serve", resetOnExit: true } },
    };
    const logs = [];
    const exec = tsExec();
    const h = startGatewayTailscaleExposure({
      cfg,
      port: 18790,
      log: (m) => logs.push(m),
      exec,
      bin: "tailscale",
    });
    assert.equal(h.active, true);
    assert.equal(h.mode, "serve");
    assert.equal(h.host, "node.tail1234.ts.net");
    const serveCall = exec.calls.find((c) => c.args[0] === "serve" && c.args[1] === "--bg");
    assert.deepEqual(serveCall.args, ["serve", "--bg", "--yes", "18790"]);
    assert.ok(cfg.gateway.corsOrigin.includes("https://node.tail1234.ts.net"));
    // resetOnExit:true → stop() tears the route down
    h.stop();
    assert.ok(exec.calls.some((c) => c.args[0] === "serve" && c.args[1] === "reset"));
  });
  it("resetOnExit:false → stop() leaves the route in place", () => {
    const cfg = { gateway: { port: 18790, tailscale: { mode: "serve", resetOnExit: false } } };
    const exec = tsExec();
    const h = startGatewayTailscaleExposure({ cfg, port: 18790, exec, bin: "tailscale" });
    h.stop();
    assert.ok(!exec.calls.some((c) => c.args[0] === "serve" && c.args[1] === "reset"));
  });
  it("missing binary → inactive handle, gateway stays up", () => {
    const logs = [];
    const h = startGatewayTailscaleExposure({
      cfg: { gateway: { port: 18790, tailscale: { mode: "serve" } } },
      port: 18790,
      log: (m) => logs.push(m),
      exec: recordingExec(),
      bin: null,
    });
    assert.equal(h.active, false);
    assert.equal(h.host, null);
    assert.ok(logs.some((l) => /binary was not found/.test(l)));
  });
  it("enable failure → inactive handle (never throws)", () => {
    const h = startGatewayTailscaleExposure({
      cfg: { gateway: { port: 18790, tailscale: { mode: "serve" } } },
      port: 18790,
      exec: tsExec({ ok: false }),
      bin: "tailscale",
    });
    assert.equal(h.active, false);
  });
  it("funnel on a non-routable port warns, funnel on 443 does not", () => {
    const warnLogs = [];
    startGatewayTailscaleExposure({
      cfg: { gateway: { port: 18790, tailscale: { mode: "funnel" } } },
      port: 18790,
      log: (m) => warnLogs.push(m),
      exec: tsExec(),
      bin: "tailscale",
    });
    assert.ok(warnLogs.some((l) => /only routes/.test(l)));

    const okLogs = [];
    const exec = tsExec();
    const h = startGatewayTailscaleExposure({
      cfg: { gateway: { port: 443, tailscale: { mode: "funnel" } } },
      port: 443,
      log: (m) => okLogs.push(m),
      exec,
      bin: "tailscale",
    });
    assert.equal(h.active, true);
    assert.ok(!okLogs.some((l) => /only routes/.test(l)));
    const fc = exec.calls.find((c) => c.args[0] === "funnel" && c.args[1] === "--bg");
    assert.deepEqual(fc.args, ["funnel", "--bg", "--yes", "443"]);
  });
});

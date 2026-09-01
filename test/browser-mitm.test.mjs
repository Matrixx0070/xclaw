/**
 * M0/M1 — MITM feature gate + confdir + lifecycle (no mitmdump required for unit tests)
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  isMitmEnabled,
  mitmPort,
  mitmConfdir,
  ensureMitmConfdir,
  startMitm,
  stopMitm,
  isMitmRunning,
  chromeProxyArgs,
  chromeMitmArgs,
  findMitmCaCert,
  readMitmFlows,
  probePort,
} from "../src/browser/mitm.mjs";

describe("isMitmEnabled gate", () => {
  const prev = process.env.XCLAW_MITM;
  after(() => {
    if (prev === undefined) delete process.env.XCLAW_MITM;
    else process.env.XCLAW_MITM = prev;
  });

  it("defaults off", () => {
    delete process.env.XCLAW_MITM;
    assert.equal(isMitmEnabled(), false);
    assert.equal(isMitmEnabled({ browser: { mitm: {} } }), false);
  });

  it("env true enables", () => {
    process.env.XCLAW_MITM = "true";
    assert.equal(isMitmEnabled(), true);
  });

  it("env 0 disables even if config true", () => {
    process.env.XCLAW_MITM = "0";
    assert.equal(isMitmEnabled({ browser: { mitm: { enabled: true } } }), false);
  });

  it("config enabled when env unset", () => {
    delete process.env.XCLAW_MITM;
    assert.equal(isMitmEnabled({ browser: { mitm: { enabled: true } } }), true);
  });
});

describe("mitmPort / confdir", () => {
  it("default port 4444", () => {
    delete process.env.XCLAW_MITM_PORT;
    assert.equal(mitmPort(), 4444);
  });

  it("env port override", () => {
    process.env.XCLAW_MITM_PORT = "9999";
    assert.equal(mitmPort(), 9999);
    delete process.env.XCLAW_MITM_PORT;
  });

  it("confdir is null without configDir", () => {
    delete process.env.XCLAW_MITM_CONFDIR;
    assert.equal(mitmConfdir(), null);
    assert.equal(mitmConfdir({}), null);
  });
});

describe("ensureMitmConfdir", () => {
  it("creates confdir + addons.py", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-mitm-test-"));
    process.env.XCLAW_MITM_CONFDIR = tmp;
    try {
      const dir = await ensureMitmConfdir();
      assert.equal(dir, tmp);
      const addon = path.join(tmp, "addons.py");
      const st = await fs.stat(addon);
      assert.ok(st.isFile());
      const body = await fs.readFile(addon, "utf8");
      assert.ok(body.includes("XClaw") || body.includes("addons"));
    } finally {
      delete process.env.XCLAW_MITM_CONFDIR;
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("startMitm when disabled", () => {
  it("returns MITM_DISABLED without spawning", async () => {
    process.env.XCLAW_MITM = "false";
    const r = await startMitm();
    assert.equal(r.ok, false);
    assert.equal(r.code, "MITM_DISABLED");
    delete process.env.XCLAW_MITM;
  });
});

describe("startMitm when enabled but no binary", () => {
  it("returns MITMDUMP_MISSING", async () => {
    process.env.XCLAW_MITM = "true";
    process.env.XCLAW_MITMDUMP = "/nonexistent/mitmdump-xclaw-test";
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-mitm-miss-"));
    process.env.XCLAW_MITM_CONFDIR = tmp;
    try {
      const r = await startMitm();
      assert.equal(r.ok, false);
      assert.equal(r.code, "MITMDUMP_MISSING");
    } finally {
      delete process.env.XCLAW_MITM;
      delete process.env.XCLAW_MITMDUMP;
      delete process.env.XCLAW_MITM_CONFDIR;
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("chromeProxyArgs", () => {
  it("empty when disabled", () => {
    delete process.env.XCLAW_MITM;
    assert.deepEqual(chromeProxyArgs(), []);
  });

  it("includes proxy-server when enabled", () => {
    process.env.XCLAW_MITM = "1";
    process.env.XCLAW_MITM_PORT = "4444";
    const args = chromeProxyArgs();
    assert.ok(args.some((a) => a.includes("proxy-server") && a.includes("4444")));
    delete process.env.XCLAW_MITM;
    delete process.env.XCLAW_MITM_PORT;
  });
});

describe("readMitmFlows empty", () => {
  it("returns [] when no file", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-mitm-flows-"));
    process.env.XCLAW_MITM_CONFDIR = tmp;
    try {
      const flows = await readMitmFlows(null, { limit: 10 });
      assert.deepEqual(flows, []);
    } finally {
      delete process.env.XCLAW_MITM_CONFDIR;
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("probePort", () => {
  it("false on closed port", async () => {
    const ok = await probePort(1, "127.0.0.1", 200);
    assert.equal(ok, false);
  });
});

describe("M2 chromeMitmArgs", () => {
  it("empty when disabled", async () => {
    delete process.env.XCLAW_MITM;
    assert.deepEqual(await chromeMitmArgs(), []);
  });

  it("includes proxy and bypass when enabled", async () => {
    process.env.XCLAW_MITM = "true";
    process.env.XCLAW_MITM_PORT = "4444";
    const args = await chromeMitmArgs();
    assert.ok(args.some((a) => a.includes("proxy-server") && a.includes("4444")));
    assert.ok(args.some((a) => a.includes("proxy-bypass-list")));
    delete process.env.XCLAW_MITM;
    delete process.env.XCLAW_MITM_PORT;
  });

  it("insecure certs flag when env set", async () => {
    process.env.XCLAW_MITM = "1";
    process.env.XCLAW_MITM_INSECURE_CERTS = "1";
    const args = await chromeMitmArgs();
    assert.ok(args.includes("--ignore-certificate-errors"));
    delete process.env.XCLAW_MITM;
    delete process.env.XCLAW_MITM_INSECURE_CERTS;
  });
});

describe("M2 findMitmCaCert", () => {
  it("returns null when no CA present", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-mitm-noca-"));
    process.env.XCLAW_MITM_CONFDIR = tmp;
    try {
      const p = await findMitmCaCert();
      assert.equal(p, null);
    } finally {
      delete process.env.XCLAW_MITM_CONFDIR;
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("finds CA when pem present", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-mitm-ca-"));
    process.env.XCLAW_MITM_CONFDIR = tmp;
    // minimal invalid-looking pem is fine for path discovery; SPKI may fail
    const pem = path.join(tmp, "mitmproxy-ca-cert.pem");
    await fs.writeFile(pem, "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n");
    try {
      const p = await findMitmCaCert();
      assert.equal(p, pem);
    } finally {
      delete process.env.XCLAW_MITM_CONFDIR;
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("M3 readMitmFlows filters", () => {
  it("filters by host and method", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-mitm-flows-f-"));
    process.env.XCLAW_MITM_CONFDIR = tmp;
    const flowsPath = path.join(tmp, "flows.jsonl");
    const rows = [
      { ts: 1, method: "GET", host: "api.example.com", url: "https://api.example.com/v1", status: 200, size: 10 },
      { ts: 2, method: "POST", host: "api.example.com", url: "https://api.example.com/v1/login", status: 401, size: 20 },
      { ts: 3, method: "GET", host: "cdn.other.com", url: "https://cdn.other.com/x.js", status: 200, size: 30 },
    ];
    await fs.writeFile(flowsPath, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    try {
      const { readMitmFlows, formatMitmFlows } = await import("../src/browser/mitm.mjs");
      const all = await readMitmFlows(null, { limit: 50 });
      assert.equal(all.length, 3);
      const api = await readMitmFlows(null, { host: "api.example.com", limit: 50 });
      assert.equal(api.length, 2);
      const posts = await readMitmFlows(null, { method: "POST", limit: 50 });
      assert.equal(posts.length, 1);
      assert.equal(posts[0].status, 401);
      const errs = await readMitmFlows(null, { statusMin: 400, limit: 50 });
      assert.equal(errs.length, 1);
      const text = formatMitmFlows(api);
      assert.ok(text.includes("api.example.com"));
    } finally {
      delete process.env.XCLAW_MITM_CONFDIR;
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("M3 mitmStatus + clear", () => {
  it("reports flowCount and clears", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-mitm-st-"));
    process.env.XCLAW_MITM_CONFDIR = tmp;
    delete process.env.XCLAW_MITM;
    await fs.writeFile(path.join(tmp, "flows.jsonl"), JSON.stringify({ ts: 9, method: "GET", host: "h", url: "u", status: 200 }) + "\n");
    try {
      const { mitmStatus, clearMitmFlows } = await import("../src/browser/mitm.mjs");
      const st = await mitmStatus();
      assert.equal(st.flowCount, 1);
      assert.equal(st.enabled, false);
      const c = await clearMitmFlows();
      assert.equal(c.ok, true);
      const st2 = await mitmStatus();
      assert.equal(st2.flowCount, 0);
    } finally {
      delete process.env.XCLAW_MITM_CONFDIR;
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("M3 agent tools", () => {
  it("createBrowserTools includes mitm_*", async () => {
    const { createBrowserTools } = await import("../src/tools/browser-tools.mjs");
    const tools = createBrowserTools({});
    const names = tools.map((t) => t.name);
    assert.ok(names.includes("mitm_status"));
    assert.ok(names.includes("mitm_flows"));
    assert.ok(names.includes("mitm_clear_flows"));
    assert.ok(names.includes("mitm_control"));
  });
});

describe("hardening mitmEnvFromConfig + waitForMitmReady", () => {
  it("env empty when disabled", async () => {
    delete process.env.XCLAW_MITM;
    const { mitmEnvFromConfig } = await import("../src/browser/mitm.mjs");
    assert.deepEqual(mitmEnvFromConfig(), {});
  });

  it("env sets XCLAW_MITM and chrome args when enabled", async () => {
    process.env.XCLAW_MITM = "true";
    const { mitmEnvFromConfig } = await import("../src/browser/mitm.mjs");
    const e = mitmEnvFromConfig();
    assert.equal(e.XCLAW_MITM, "true");
    assert.ok(e.XCLAW_CHROME_MITM_ARGS.includes("proxy-server"));
    delete process.env.XCLAW_MITM;
  });

  it("findMitmdump checks .local/bin", async () => {
    const { findMitmdump } = await import("../src/browser/mitm.mjs");
    const bin = await findMitmdump();
    // may be null in CI without install — just must not throw
    assert.ok(bin === null || String(bin).includes("mitmdump"));
  });
});

describe("CA certificate management", () => {
  it("mitmCaStatus absent when no cert", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-ca-none-"));
    process.env.XCLAW_MITM_CONFDIR = tmp;
    try {
      const { mitmCaStatus } = await import("../src/browser/mitm.mjs");
      const st = await mitmCaStatus();
      assert.equal(st.present, false);
    } finally {
      delete process.env.XCLAW_MITM_CONFDIR;
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("getMitmCaInfo reads openssl metadata when pem present", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-ca-pem-"));
    process.env.XCLAW_MITM_CONFDIR = tmp;
    // Generate a throwaway self-signed cert for unit test
    const { execFile } = await import("node:child_process");
    const pem = path.join(tmp, "mitmproxy-ca-cert.pem");
    await new Promise((res, rej) => {
      execFile(
        "openssl",
        ["req", "-x509", "-newkey", "rsa:2048", "-keyout", path.join(tmp, "key.pem"),
         "-out", pem, "-days", "1", "-nodes", "-subj", "/CN=xclaw-test-ca"],
        (e) => (e ? rej(e) : res())
      );
    });
    try {
      const { getMitmCaInfo, exportMitmCa } = await import("../src/browser/mitm.mjs");
      const info = await getMitmCaInfo();
      assert.ok(info);
      assert.ok(info.certPath.endsWith("mitmproxy-ca-cert.pem"));
      assert.ok(info.spki);
      const exp = await exportMitmCa(null, path.join(tmp, "out"));
      assert.equal(exp.ok, true);
      assert.ok(exp.spkiPath);
    } finally {
      delete process.env.XCLAW_MITM_CONFDIR;
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("mitm_ca tool registered", async () => {
    const { createBrowserTools } = await import("../src/tools/browser-tools.mjs");
    const names = createBrowserTools({}).map((t) => t.name);
    assert.ok(names.includes("mitm_ca"));
  });
});

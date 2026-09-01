/**
 * Every surface that NAMES the computer must name the machine the gateway
 * actually talks to.
 *
 * v3.342.0 closed this on `xclaw doctor`: one if/else whose two branches
 * probed two different machines, so a stray local listener graded a dead
 * remote "up". The same shape survived in seven reporting surfaces that build
 * `http://${cfg.computer.host}:${cfg.computer.port}` inline and therefore drop
 * `computer.remoteUrl` — while the VERDICT beside them comes from
 * `isComputerRunning`, which honours it. One JSON object then carries a
 * remote-aware verdict next to a local-derived identity:
 *
 *   {"computer":"down","computerUrl":"http://127.0.0.1:35503"}
 *
 * Worse, one of them does not merely report — GET /computer/health FETCHES the
 * inline address and returns that machine's health body verbatim as the
 * answer. Proven live on a clean v3.342.0 tree against a gateway configured
 * with a dead remote and a squatter on the local port:
 *
 *   GET /computer/health -> 200 {"ok":true,"iam":"WRONG-MACHINE-local-squatter"}
 *
 * `computerBaseUrl` already owns this decision. These pin that every surface
 * asks it, instead of re-deriving the address and getting a different answer.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { tryHandleOpsRoute } from "../src/gateway/routes/ops.mjs";
import { buildDashboard } from "../src/gateway/dashboard.mjs";
import { buildDoctorReport } from "../src/gateway/doctor.mjs";

/** A remote deployment: the local host/port are the ones NOT in use. */
const REMOTE = "http://127.0.0.1:1";
const cfgRemote = () => ({
  profile: "dev",
  gateway: { host: "127.0.0.1", port: 18790 },
  computer: { host: "127.0.0.1", port: 4243, remoteUrl: REMOTE },
  agent: { model: "m", maxTurns: 5 },
  security: { autoApprove: false },
  paths: { configDir: "/tmp/xclaw-addr-test-missing", configFile: "/tmp/x.json" },
});
/** The ordinary local deployment — must keep reporting exactly as before. */
const cfgLocal = () => {
  const c = cfgRemote();
  c.computer = { host: "127.0.0.1", port: 4243, remoteUrl: null };
  return c;
};

async function ops(p, cfg, extra = {}) {
  let body = null;
  let code = null;
  const handled = await tryHandleOpsRoute({
    p,
    method: "GET",
    req: { headers: {}, url: p },
    res: {},
    url: new URL(`http://local${p}`),
    cfg,
    json: (_res, c, payload) => {
      code = c;
      body = payload;
    },
    webchatEnabled: true,
    channelManager: { status: () => [] },
    XCLAW_VERSION: "0.0.0-test",
    XCLAW_PHASE: 0,
    ...extra,
  });
  assert.equal(handled, true, `${p} not handled`);
  return { body, code };
}

/** Swap global fetch for the duration of one call. */
async function withFetch(impl, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

describe("computer address reporting honours remoteUrl", () => {
  it("GET /health names the configured remote, not the unused local port", async () => {
    const { body } = await ops("/health", cfgRemote());
    assert.equal(body.computerUrl, REMOTE);
  });

  it("GET /health still names the local computer when there is no remote", async () => {
    const { body } = await ops("/health", cfgLocal());
    assert.equal(body.computerUrl, "http://127.0.0.1:4243");
  });

  it("GET /gateway/info carries the address its `healthy` verdict was taken from", async () => {
    const { body } = await ops("/gateway/info", cfgRemote());
    assert.equal(body.computer.url, REMOTE);
  });

  it("GET /computer/health probes the remote — never a local squatter", async () => {
    let asked = null;
    const { body, code } = await withFetch(
      async (u) => {
        asked = String(u);
        return { status: 200, json: async () => ({ ok: true, iam: "remote" }) };
      },
      () => ops("/computer/health", cfgRemote())
    );
    assert.equal(asked, `${REMOTE}/health`);
    assert.equal(code, 200);
    assert.deepEqual(body, { ok: true, iam: "remote" });
  });

  it("GET /computer/health probes the local computer when there is no remote", async () => {
    let asked = null;
    await withFetch(
      async (u) => {
        asked = String(u);
        return { status: 200, json: async () => ({ ok: true }) };
      },
      () => ops("/computer/health", cfgLocal())
    );
    assert.equal(asked, "http://127.0.0.1:4243/health");
  });

  it("GET /computer/health names the upstream it failed to reach", async () => {
    const { body, code } = await withFetch(
      async () => {
        throw new Error("connect ECONNREFUSED");
      },
      () => ops("/computer/health", cfgRemote())
    );
    assert.equal(code, 502);
    // Without this the caller cannot tell WHICH machine was unreachable —
    // the whole point of the bug. computer-proxy.mjs sets the precedent.
    assert.equal(body.upstream, `${REMOTE}/health`);
    assert.match(body.detail, /ECONNREFUSED/);
  });

  it("GET /computer/health does not hang forever on a silent upstream", async () => {
    // Node fetch has no total-request timeout. A connection that opens and
    // then never answers parked the route forever — same class as v3.290.0.
    // AbortSignal.timeout unrefs its timer; a missing signal would otherwise
    // let the suite exit with a pending promise. raceHang keeps the loop
    // alive and surfaces HUNG instead of hanging the file.
    function silentFetch(_url, init) {
      return new Promise((_resolve, reject) => {
        const sig = init?.signal;
        if (!sig) return;
        if (sig.aborted) return reject(sig.reason);
        sig.addEventListener("abort", () => reject(sig.reason), { once: true });
      });
    }
    async function raceHang(p, ms = 3_000) {
      let timer;
      const hang = new Promise((res) => {
        timer = setTimeout(() => res("HUNG"), ms);
      });
      try {
        return await Promise.race([p, hang]);
      } finally {
        clearTimeout(timer);
      }
    }
    const out = await withFetch(silentFetch, () =>
      raceHang(ops("/computer/health", cfgRemote(), { computerHealthTimeoutMs: 40 }))
    );
    assert.notEqual(out, "HUNG", "GET /computer/health never returned — unbounded fetch");
    assert.equal(out.code, 502);
    assert.equal(out.body.error, "computer unreachable");
    assert.equal(out.body.upstream, `${REMOTE}/health`);
    assert.match(String(out.body.detail), /abort|timeout/i);
  });

  it("dashboard reports the address its `up` verdict was taken from", async () => {
    const d = await buildDashboard(cfgRemote());
    assert.equal(d.computer.url, REMOTE);
  });

  it("gateway doctor report names the remote in its computer row", async () => {
    const rep = await buildDoctorReport({
      cfg: cfgRemote(),
      channelManager: { status: () => [] },
      isComputerRunning: async () => false,
    });
    const row = rep.checks.find((c) => c.name === "computer");
    assert.ok(row, "no computer row");
    assert.equal(row.url, REMOTE);
  });
});

/**
 * Two callers load the real config themselves, so a fixture cannot reach them.
 * Pin the wiring as text — the same technique the doctor probes use.
 */
describe("computer address wiring (untestable-by-construction callers)", () => {
  const src = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

  it("the gateway boot banner asks computerBaseUrl", () => {
    const s = src("../src/gateway/index.mjs");
    assert.match(s, /Computer at \$\{computerBaseUrl\(cfg\)\}/);
    assert.doesNotMatch(
      s,
      /Computer at http:\/\/\$\{cfg\.computer/,
      "boot banner still derives the computer address inline"
    );
  });

  it("`xclaw status` asks computerBaseUrl", () => {
    const s = src("../src/cli/status.mjs");
    assert.match(s, /const compUrl = computerBaseUrl\(cfg\)/);
    assert.doesNotMatch(
      s,
      /\$\{computerProbeHost\(cfg\)\}:\$\{cfg\.computer\.port\}/,
      "status still derives the computer address inline"
    );
  });

  it("GET /computer/health fetch carries AbortSignal.timeout", () => {
    const s = src("../src/gateway/routes/ops.mjs");
    assert.match(s, /signal:\s*AbortSignal\.timeout\(timeoutMs\)/);
    assert.doesNotMatch(
      s,
      /await fetch\(u\);/,
      "GET /computer/health still fetches without a deadline"
    );
  });
});

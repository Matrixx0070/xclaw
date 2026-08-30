/**
 * Opt-in CLI handoff to a running gateway.
 *
 * Default `xclaw agent` / `job` / `runs resume` stay in-process. `--gateway`
 * POSTs to the owner. If the owner is down, fail closed — no silent
 * in-process fallback (queue pause/resume analog, not add).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { takeGatewayFlag, runGatewayHandoff, probeGateway, HANDOFF_TIMEOUT_MS, PROBE_TIMEOUT_MS } from "../src/cli/gateway-handoff.mjs";
import { isResumableAgentRun } from "../src/agent/run-resume.mjs";

const execFileP = promisify(execFile);
const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function fakeFetch(reply) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({
      url: String(url),
      method: init?.method,
      auth: init?.headers?.authorization,
      body: init?.body ? JSON.parse(init.body) : null,
      signal: init?.signal,
    });
    if (reply instanceof Error) throw reply;
    return {
      ok: reply.status < 400,
      status: reply.status,
      json: async () => reply.body,
    };
  };
  fn.calls = calls;
  return fn;
}

const CFG = { gateway: { host: "127.0.0.1", port: 18790, token: "tok-123" } };

describe("takeGatewayFlag: boolean presence, not a URL", () => {
  it("strips --gateway so it is not part of the prompt", () => {
    const { viaGateway, rest } = takeGatewayFlag(["--session", "s1", "--gateway", "list files"]);
    assert.equal(viaGateway, true);
    assert.deepEqual(rest, ["--session", "s1", "list files"]);
  });

  it("leaves argv alone when the flag is absent", () => {
    const { viaGateway, rest } = takeGatewayFlag(["--session", "s1", "hello"]);
    assert.equal(viaGateway, false);
    assert.deepEqual(rest, ["--session", "s1", "hello"]);
  });

  it("does not consume the next token as a URL", () => {
    const { viaGateway, rest } = takeGatewayFlag(["--gateway", "http://example"]);
    assert.equal(viaGateway, true);
    assert.deepEqual(rest, ["http://example"]);
  });
});

describe("runGatewayHandoff: opt-in POSTs, fail closed", () => {
  it("agent POSTs /agent/run with sessionId and no persistRun mint", async () => {
    const f = fakeFetch({
      status: 200,
      body: { ok: true, text: "PONG", stopReason: "natural", sessionId: "cli-1" },
    });
    const out = await runGatewayHandoff(
      CFG,
      "agent",
      { message: "ping", sessionId: "cli-1", workingDir: "/tmp" },
      { fetchImpl: f }
    );
    assert.equal(out.ok, true);
    assert.equal(out.via, "gateway");
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].url, "http://127.0.0.1:18790/agent/run");
    assert.equal(f.calls[0].method, "POST");
    assert.equal(f.calls[0].auth, "Bearer tok-123");
    assert.equal(f.calls[0].body.message, "ping");
    assert.equal(f.calls[0].body.sessionId, "cli-1");
    assert.equal(f.calls[0].body.workingDir, "/tmp");
    assert.equal(f.calls[0].body.persistRun, undefined);
  });

  it("job POSTs /jobs and treats 422 as a completed job, not a transport failure", async () => {
    const f = fakeFetch({
      status: 422,
      body: { id: "job_1", pass: false, status: "failed", text: "nope" },
    });
    const out = await runGatewayHandoff(CFG, "job", { goal: "do a thing", autoApprove: true }, { fetchImpl: f });
    assert.equal(out.ok, true, "a finished job that did not pass is still a delivered handoff");
    assert.equal(out.via, "gateway");
    assert.equal(f.calls[0].url, "http://127.0.0.1:18790/jobs");
    assert.equal(f.calls[0].body.goal, "do a thing");
    assert.equal(f.calls[0].body.autoApprove, true);
    assert.equal(out.result.pass, false);
  });

  it("resume POSTs /objectives/:id/resume", async () => {
    const f = fakeFetch({ status: 200, body: { ok: true, id: "obj_1", status: "running" } });
    const out = await runGatewayHandoff(CFG, "resume", { objectiveId: "obj_1" }, { fetchImpl: f });
    assert.equal(out.ok, true);
    assert.equal(f.calls[0].url, "http://127.0.0.1:18790/objectives/obj_1/resume");
    assert.equal(out.result.status, "running");
  });

  it("refuses to run an agent it could not deliver", async () => {
    const f = fakeFetch(new Error("ECONNREFUSED"));
    const out = await runGatewayHandoff(CFG, "agent", { message: "ping" }, { fetchImpl: f });
    assert.equal(out.ok, false, "an undelivered handoff must never read as success");
    assert.equal(out.exitCode, 1);
    assert.match(out.error, /gateway/i);
  });

  it("fails loudly when the gateway rejects the job", async () => {
    const f = fakeFetch({ status: 401, body: { error: "unauthorized" } });
    const out = await runGatewayHandoff(CFG, "job", { goal: "x" }, { fetchImpl: f });
    assert.equal(out.ok, false);
    assert.equal(out.exitCode, 1);
    assert.match(out.error, /401|gateway/i);
  });

  it("passes a long timeout, not the queue-control 4000ms default", async () => {
    assert.equal(HANDOFF_TIMEOUT_MS, 180000);
    const f = fakeFetch({ status: 200, body: { ok: true, text: "ok" } });
    await runGatewayHandoff(CFG, "agent", { message: "ping" }, { fetchImpl: f });
    // AbortController is armed at HANDOFF_TIMEOUT_MS; the fetch itself is
    // invoked with a signal. The 4000 default lives on gatewayPost and must
    // stay there for queue pause/resume.
    assert.ok(f.calls[0].signal, "handoff must abort via signal, not hang forever");
  });
});

describe("probeGateway: GET /health before any stamp", () => {
  it("GETs /health and succeeds on 200", async () => {
    assert.equal(PROBE_TIMEOUT_MS, 3000);
    const f = fakeFetch({ status: 200, body: { status: "healthy" } });
    const out = await probeGateway(CFG, { fetchImpl: f });
    assert.equal(out.ok, true);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].url, "http://127.0.0.1:18790/health");
    assert.equal(f.calls[0].method, "GET");
    assert.equal(f.calls[0].auth, "Bearer tok-123");
    assert.equal(f.calls[0].body, null);
  });

  it("fails closed on ECONNREFUSED", async () => {
    const f = fakeFetch(new Error("ECONNREFUSED"));
    const out = await probeGateway(CFG, { fetchImpl: f });
    assert.equal(out.ok, false);
    assert.equal(out.exitCode, 1);
    assert.match(out.error, /gateway/i);
  });
});

describe("CLI --gateway: end to end, an undelivered handoff fails", () => {
  async function cliHome() {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-handoff-home-"));
    await fs.mkdir(path.join(home, ".xclaw"), { recursive: true });
    await fs.writeFile(
      path.join(home, ".xclaw", "xclaw.json"),
      JSON.stringify({ gateway: { host: "127.0.0.1", port: 18999 } })
    );
    return {
      home,
      run: (...argv) =>
        execFileP("node", [path.join(REPO, "bin", "xclaw.mjs"), ...argv], {
          env: { ...process.env, HOME: home },
          timeout: 20000,
        })
          .then((r) => ({ ...r, code: 0 }))
          .catch((e) => e),
      cleanup: () => fs.rm(home, { recursive: true, force: true }),
    };
  }

  it("agent --gateway against a dead port does not fall back in-process", async () => {
    const c = await cliHome();
    const r = await c.run("agent", "--gateway", "ping");
    assert.notEqual(r.code, 0, "an undelivered agent handoff must not exit 0");
    const combined = `${r.stdout || ""}\n${r.stderr || ""}`;
    assert.match(combined, /gateway/i, "it must say why it could not run");
    assert.doesNotMatch(combined, /Starting Computer/);
    await c.cleanup();
  });

  it("job --gateway against a dead port does not fall back in-process", async () => {
    const c = await cliHome();
    const r = await c.run("job", "--gateway", "list files");
    assert.notEqual(r.code, 0, "an undelivered job handoff must not exit 0");
    const combined = `${r.stdout || ""}\n${r.stderr || ""}`;
    assert.match(combined, /gateway/i);
    assert.doesNotMatch(String(r.stdout || ""), /"verdict":/, "must not print a local job as though it ran");
    await c.cleanup();
  });

  it("runs resume --gateway against a dead port does not stamp the snapshot", async () => {
    const c = await cliHome();
    const wd = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-handoff-wd-"));
    const sessionId = "resume_dead_gw";
    const snapDir = path.join(c.home, ".xclaw", "agent-runs");
    await fs.mkdir(snapDir, { recursive: true });
    const snapPath = path.join(snapDir, `${sessionId}.json`);
    await fs.writeFile(
      snapPath,
      JSON.stringify(
        {
          version: 1,
          sessionId,
          updatedAt: new Date().toISOString(),
          workingDir: wd,
          messages: [{ role: "assistant", content: "Partial analysis so far." }],
          status: "maxTurns",
          stopReason: "maxTurns",
          turns: 12,
          meta: { goal: "analyse the whole repo" },
          resumedAt: null,
          objectiveId: null,
        },
        null,
        2
      )
    );
    const r = await c.run("runs", "resume", "--gateway", sessionId);
    assert.notEqual(r.code, 0, "an undelivered resume handoff must not exit 0");
    const combined = `${r.stdout || ""}\n${r.stderr || ""}`;
    assert.match(combined, /gateway/i);
    const after = JSON.parse(await fs.readFile(snapPath, "utf8"));
    assert.equal(after.resumedAt, null, "dead gateway must not stamp resumedAt");
    assert.equal(after.objectiveId, null, "dead gateway must not stamp objectiveId");
    assert.equal(isResumableAgentRun(after), true, "snapshot must stay resumable");
    await fs.rm(wd, { recursive: true, force: true });
    await c.cleanup();
  });
});

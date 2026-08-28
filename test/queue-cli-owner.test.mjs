/**
 * The queue has ONE owner: the running gateway. The CLI is a client.
 *
 * `xclaw queue pause` used to call pauseQueue() — which mutates a module-level
 * `worker` singleton — inside the CLI's own short-lived process, print that
 * singleton, and exit. Nothing crossed to the gateway. Measured live against
 * the running 3.322.0 gateway before any code was written:
 *
 *   gateway /metrics   xclaw_queue_paused 0
 *   $ xclaw queue pause   -> {"paused": true, "blocked": true}
 *   gateway /metrics   xclaw_queue_paused 0        <-- the stop did nothing
 *
 * Two more of the same root, both measured against the real modules:
 *
 *   `case "queue"` armed a queue worker for EVERY subcommand, read-only ones
 *   included. Measured, that line does nothing at all: the timer is unref'd
 *   and every subcommand is one disk read away from `break`, so the process
 *   is gone first (3/3 `queue list` runs left the job `queued`, exit in
 *   0.10s). It is dead code that reads like a dispatcher — and on the day it
 *   won the race it would start an agent run in a process about to exit,
 *   against the same queue directory the gateway owns. Deleted, not tested:
 *   there is no behaviour to pin.
 *
 *   The third defect is real and cross-process: a job added by a second
 *   process is never picked up, because the
 *   gateway's worker only chains `if (left)` and is otherwise armed at boot:
 *     gateway idle on an empty queue; a child process enqueues and exits;
 *     1s later  ->  still "queued"
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { gatewayBaseUrl, gatewayPost } from "../src/cli/gateway-client.mjs";
import { runQueueControl } from "../src/cli/queue-cli.mjs";
import { pickEnqueueRequest, pauseQueue, getQueueItem } from "../src/jobs/queue.mjs";
import { tryHandleEvalQueueRoute } from "../src/gateway/routes/eval-queue.mjs";

const execFileP = promisify(execFile);
const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** A fetch that records what the CLI tried to do, and answers as told. */
function fakeFetch(reply) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({
      url: String(url),
      method: init?.method,
      auth: init?.headers?.authorization,
      body: init?.body ? JSON.parse(init.body) : null,
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

describe("queue CLI: the gateway owns the queue", () => {
  it("sends pause to the running gateway, not to its own memory", async () => {
    const f = fakeFetch({ status: 200, body: { paused: true, blocked: true } });
    const out = await runQueueControl(CFG, "pause", {}, { fetchImpl: f });
    assert.equal(out.ok, true);
    assert.equal(out.via, "gateway", "a pause that never leaves the process is not a pause");
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].url, "http://127.0.0.1:18790/queue/pause");
    assert.equal(f.calls[0].method, "POST");
    assert.equal(f.calls[0].auth, "Bearer tok-123");
  });

  it("sends resume to the running gateway", async () => {
    const f = fakeFetch({ status: 200, body: { paused: false } });
    const out = await runQueueControl(CFG, "resume", {}, { fetchImpl: f });
    assert.equal(out.via, "gateway");
    assert.equal(f.calls[0].url, "http://127.0.0.1:18790/queue/resume");
  });

  it("refuses to report a pause it could not deliver", async () => {
    const f = fakeFetch(new Error("ECONNREFUSED"));
    const out = await runQueueControl(CFG, "pause", {}, { fetchImpl: f });
    assert.equal(out.ok, false, "an undelivered stop must never read as success");
    assert.equal(out.exitCode, 1);
    assert.doesNotMatch(JSON.stringify(out.result ?? {}), /"paused":\s*true/);
    assert.match(out.error, /gateway/i);
  });

  it("fails loudly when the gateway rejects the pause", async () => {
    const f = fakeFetch({ status: 401, body: { error: "unauthorized" } });
    const out = await runQueueControl(CFG, "pause", {}, { fetchImpl: f });
    assert.equal(out.ok, false);
    assert.equal(out.exitCode, 1);
    assert.match(out.error, /401/);
  });

  it("adds a job through the owner, so the owner actually kicks it", async () => {
    const f = fakeFetch({ status: 200, body: { id: "q1", status: "queued" } });
    const local = async () => assert.fail("must not enqueue locally while a gateway is up");
    const out = await runQueueControl(CFG, "add", { goal: "do a thing" }, {
      fetchImpl: f,
      enqueueLocal: local,
    });
    assert.equal(out.via, "gateway");
    assert.equal(f.calls[0].url, "http://127.0.0.1:18790/queue");
    assert.equal(out.result.id, "q1");
  });

  it("still enqueues with no gateway, and says the job is not running yet", async () => {
    const f = fakeFetch(new Error("ECONNREFUSED"));
    const out = await runQueueControl(CFG, "add", { goal: "offline" }, {
      fetchImpl: f,
      enqueueLocal: async (_cfg, item) => ({ id: "local1", ...item, status: "queued" }),
    });
    assert.equal(out.ok, true, "enqueueing to disk still works with no gateway");
    assert.equal(out.via, "local");
    assert.equal(out.result.id, "local1");
    assert.match(out.note, /gateway/i, "an operator must know nothing will run it yet");
  });

  it("fails an add with no local fallback instead of returning a blank result", async () => {
    // The contract enqueueFromFile relies on: given a fallback, an add never
    // comes back !ok, so it has no !ok branch of its own. Without one it must
    // report the failure, never hand back {ok:true, result:undefined}.
    const f = fakeFetch(new Error("ECONNREFUSED"));
    const out = await runQueueControl(CFG, "add", { goal: "offline" }, { fetchImpl: f });
    assert.equal(out.ok, false);
    assert.equal(out.exitCode, 1);
    assert.match(out.error, /ECONNREFUSED|gateway|fetch/i);
  });
});

describe("gateway-client: one base URL builder", () => {
  it("defaults to the loopback gateway", () => {
    assert.equal(gatewayBaseUrl({}), "http://127.0.0.1:18790");
  });
  it("honours a configured host and port", () => {
    assert.equal(
      gatewayBaseUrl({ gateway: { host: "10.0.0.5", port: 9999 } }),
      "http://10.0.0.5:9999"
    );
  });
  it("omits the auth header when no token is configured", async () => {
    const f = fakeFetch({ status: 200, body: {} });
    await gatewayPost({}, "/queue/pause", {}, { fetchImpl: f });
    assert.equal(f.calls[0].auth, undefined);
  });
});

/**
 * The end-to-end half. `case "queue"` in bin/xclaw.mjs called
 * startQueueWorker(cfg) before dispatching ANY subcommand, so merely listing
 * the queue armed a worker in a process that is about to exit — and it really
 * did start jobs (measured above). These run the actual binary.
 */
describe("queue CLI: end to end, an undelivered stop fails", () => {
  /**
   * The one assertion that separates before from after. Run against the real
   * binary with the gateway port pointed at nothing, the shipped 3.322.0 CLI
   * printed `"paused": true, "blocked": true` and exited 0 — a stop reported
   * as delivered with no gateway in existence to deliver it to.
   */
  async function cliHome() {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-cli-home-"));
    await fs.mkdir(path.join(home, ".xclaw"), { recursive: true });
    // a port nothing is listening on, so "unreachable" is the honest state
    await fs.writeFile(
      path.join(home, ".xclaw", "xclaw.json"),
      JSON.stringify({ gateway: { host: "127.0.0.1", port: 18999 } })
    );
    return {
      home,
      run: (...argv) =>
        execFileP("node", [path.join(REPO, "bin", "xclaw.mjs"), ...argv], {
          env: { ...process.env, HOME: home },
          timeout: 60000,
          // execFile resolves only on exit 0 and rejects with `code` otherwise;
          // normalise so an unexpected success cannot read as "not zero".
        })
          .then((r) => ({ ...r, code: 0 }))
          .catch((e) => e),
      cleanup: () => fs.rm(home, { recursive: true, force: true }),
    };
  }

  it("refuses to report a pause when no gateway can receive it", async () => {
    const c = await cliHome();
    const r = await c.run("queue", "pause");
    assert.notEqual(r.code, 0, "an undelivered stop must not exit 0");
    assert.doesNotMatch(
      String(r.stdout || ""),
      /"paused":\s*true/,
      "the CLI printed its own singleton as though the queue had stopped"
    );
    assert.match(String(r.stderr || ""), /gateway/i, "it must say why it could not stop");
    await c.cleanup();
  });

  it("says the same about resume", async () => {
    const c = await cliHome();
    const r = await c.run("queue", "resume");
    assert.notEqual(r.code, 0);
    assert.match(String(r.stderr || ""), /gateway/i);
    await c.cleanup();
  });
});

/**
 * `xclaw goal` had the same shape: it enqueued to disk in its own process and
 * printed `enqueued: true`. With the gateway idle that job is never picked up
 * — the owner re-arms its worker only while items remain — so the operator was
 * told a job was queued with nothing on the machine that would ever start it.
 * It now goes to the owner, and when it cannot, it says so.
 */
describe("xclaw goal: end to end", () => {
  it("still queues with no gateway, but says nothing will run it", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-goal-home-"));
    await fs.mkdir(path.join(home, ".xclaw"), { recursive: true });
    await fs.writeFile(
      path.join(home, ".xclaw", "xclaw.json"),
      JSON.stringify({ gateway: { host: "127.0.0.1", port: 18999 } })
    );
    const r = await execFileP(
      "node",
      [path.join(REPO, "bin", "xclaw.mjs"), "goal", "write a haiku"],
      { env: { ...process.env, HOME: home }, timeout: 60000 }
    )
      .then((x) => ({ ...x, code: 0 }))
      .catch((e) => e);
    assert.equal(r.code, 0, "an offline enqueue is still a real enqueue");
    assert.match(String(r.stdout || ""), /"enqueued": true/);
    assert.match(
      String(r.stderr || ""),
      /gateway/i,
      "an operator must be told the job is parked, not running"
    );
    await fs.rm(home, { recursive: true, force: true });
  });

  it("says it about a whole batch file too", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-batch-home-"));
    await fs.mkdir(path.join(home, ".xclaw"), { recursive: true });
    await fs.writeFile(
      path.join(home, ".xclaw", "xclaw.json"),
      JSON.stringify({ gateway: { host: "127.0.0.1", port: 18999 } })
    );
    const jobs = path.join(home, "jobs.jsonl");
    await fs.writeFile(jobs, JSON.stringify({ goal: "one", harness: true }) + "\n");
    const r = await execFileP("node", [path.join(REPO, "bin", "xclaw.mjs"), "queue", "batch", jobs], {
      env: { ...process.env, HOME: home },
      timeout: 60000,
    })
      .then((x) => ({ ...x, code: 0 }))
      .catch((e) => e);
    assert.equal(r.code, 0);
    assert.match(String(r.stdout || ""), /"count": 1/);
    assert.match(
      String(r.stderr || ""),
      /gateway/i,
      "a batch parked on disk must say so once, like a single goal does"
    );
    await fs.rm(home, { recursive: true, force: true });
  });
});

/**
 * Routing an add through the owner is only correct if the owner receives what
 * the caller asked for. `POST /queue` forwarded goal|verify|maxTurns|priority
 * and dropped the rest, so `xclaw goal --harness --cmd "npm test"` sent over
 * the wire would have run as a plain unverified batch job while still printing
 * `harness: true` locally — a capability lost in transit, silently.
 */
describe("an enqueue request keeps its harness semantics", () => {
  it("forwards every field enqueueJob honours", () => {
    const picked = pickEnqueueRequest({
      goal: "ship it",
      verify: [{ type: "command", cmd: "npm test", exitCode: 0 }],
      workspace: "/w",
      maxTurns: 9,
      timeoutMs: 1000,
      harness: true,
      groundHard: true,
      claimsRequireEvidence: true,
      requireStructuredClaims: true,
      priority: 3,
      class: "interactive",
    });
    assert.equal(picked.harness, true, "a harness job must not arrive as a batch job");
    assert.equal(picked.groundHard, true);
    assert.equal(picked.claimsRequireEvidence, true);
    assert.equal(picked.requireStructuredClaims, true);
    assert.equal(picked.class, "interactive");
    assert.equal(picked.workspace, "/w");
    assert.equal(picked.timeoutMs, 1000);
    assert.equal(picked.maxTurns, 9);
    assert.equal(picked.priority, 3);
    assert.equal(picked.verify.length, 1);
  });

  it("still accepts `message` as the goal", () => {
    assert.equal(pickEnqueueRequest({ message: "from a channel" }).goal, "from a channel");
  });

  it("does not let a request set retry or wait ceilings", () => {
    const picked = pickEnqueueRequest({ goal: "g", maxAttempts: 99, maxWaitMs: 10 ** 9 });
    assert.equal(picked.maxAttempts, undefined, "retry budget is config-owned");
    assert.equal(picked.maxWaitMs, undefined, "admission wait is config-owned");
  });
});

describe("xclaw goal: the flags reach the owner", () => {
  const HARNESS_JOB = {
    goal: "ship it",
    class: "batch",
    harness: true,
    verify: [{ type: "command", cmd: "npm test", exitCode: 0 }],
    groundHard: true,
    claimsRequireEvidence: true,
    requireStructuredClaims: true,
  };

  it("puts the whole payload on the wire, not just the goal", async () => {
    const f = fakeFetch({ status: 202, body: { id: "q9", harness: true } });
    const out = await runQueueControl(CFG, "add", HARNESS_JOB, { fetchImpl: f });
    assert.equal(out.via, "gateway");
    const sent = f.calls[0].body;
    assert.equal(sent.harness, true, "the owner would have run this unverified");
    assert.equal(sent.groundHard, true);
    assert.equal(sent.claimsRequireEvidence, true);
    assert.equal(sent.requireStructuredClaims, true);
    assert.equal(sent.class, "batch");
    assert.equal(sent.verify[0].cmd, "npm test");
  });

  it("keeps the payload on the offline path too", async () => {
    const f = fakeFetch(new Error("ECONNREFUSED"));
    let got = null;
    await runQueueControl(CFG, "add", HARNESS_JOB, {
      fetchImpl: f,
      enqueueLocal: async (_cfg, item) => {
        got = item;
        return { id: "local9", ...item };
      },
    });
    assert.equal(got.harness, true);
    assert.equal(got.verify[0].cmd, "npm test");
  });
});

/**
 * And the owner's side of that wire: POST /queue must persist what arrived.
 * Pinning the pure picker is not enough — the route has to actually use it,
 * which is exactly the line a refactor re-narrows by hand.
 */
describe("POST /queue persists the harness semantics it was sent", () => {
  it("writes harness, class and the grounding flags to the job record", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-route-q-"));
    const cfg = { paths: { configDir: dir }, agent: { maxTurns: 1 } };
    // The route arms the worker. Park it first so the enqueued job is written
    // and left alone; nothing in this file resumes it.
    pauseQueue();
    let sent = null;
    const handled = await tryHandleEvalQueueRoute({
      p: "/queue",
      method: "POST",
      req: { headers: {} },
      res: {},
      url: new URL("http://local/queue"),
      cfg,
      json: (_res, status, body) => {
        sent = { status, body };
      },
      readBody: async () => ({
        goal: "ship it",
        harness: true,
        class: "interactive",
        groundHard: true,
        claimsRequireEvidence: true,
        requireStructuredClaims: true,
        verify: [{ type: "command", cmd: "npm test", exitCode: 0 }],
      }),
    });
    assert.equal(handled, true);
    assert.equal(sent.status, 202);
    const rec = await getQueueItem(cfg, sent.body.id);
    assert.equal(rec.harness, true, "the owner recorded an unverified job");
    assert.equal(rec.class, "interactive");
    assert.equal(rec.groundHard, true);
    assert.equal(rec.claimsRequireEvidence, true);
    assert.equal(rec.requireStructuredClaims, true);
    assert.equal(rec.verify[0].cmd, "npm test");
    await fs.rm(dir, { recursive: true, force: true });
  });
});

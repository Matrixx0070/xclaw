import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import {
  validateWorkerUrl,
  listWorkers,
  findWorker,
  startRemoteMission,
  listRemoteMissions,
  getRemoteMission,
  mergeRemoteMission,
  pingWorker,
} from "../src/missions/remote.mjs";

describe("validateWorkerUrl", () => {
  it("https anywhere; http loopback only; allowInsecure overrides", () => {
    assert.equal(validateWorkerUrl("https://build-box:18790").ok, true);
    assert.equal(validateWorkerUrl("http://127.0.0.1:18790").ok, true);
    assert.equal(validateWorkerUrl("http://10.0.0.9:18790").ok, false);
    assert.equal(validateWorkerUrl("http://10.0.0.9:18790", { allowInsecure: true }).ok, true);
    assert.equal(validateWorkerUrl("ftp://x").ok, false);
    assert.equal(validateWorkerUrl("not a url").ok, false);
  });
});

describe("listWorkers / findWorker", () => {
  const cfg = {
    missions: {
      workers: [
        { name: "w1", url: "https://a:18790", token: "SECRET" },
        { name: "", url: "https://skip" },
        null,
      ],
    },
  };
  it("redacts tokens and drops malformed entries", () => {
    const ws = listWorkers(cfg);
    assert.equal(ws.length, 1);
    assert.equal(ws[0].name, "w1");
    assert.equal(ws[0].hasToken, true);
    assert.equal("token" in ws[0], false, "token never leaves the config");
  });
  it("findWorker returns the RAW entry (token included) for internal use", () => {
    assert.equal(findWorker(cfg, "w1").token, "SECRET");
    assert.equal(findWorker(cfg, "nope"), null);
  });
});

describe("remote mission proxy against a mock worker", () => {
  let server, port;
  const seen = [];
  before(async () => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push({ method: req.method, url: req.url, token: req.headers["x-xclaw-token"], body: body ? JSON.parse(body) : null });
        res.setHeader("content-type", "application/json");
        if (req.url === "/gateway/info") {
          res.end(JSON.stringify({ version: "9.9.9", computer: { healthy: true } }));
        } else if (req.url === "/missions" && req.method === "POST") {
          res.end(JSON.stringify({ ok: true, mission: { id: "msn_remote_1", status: "planning" } }));
        } else if (req.url.startsWith("/missions?")) {
          res.end(JSON.stringify({ missions: [{ id: "msn_remote_1", status: "merge_ready", verified: true }] }));
        } else if (req.url === "/missions/msn_remote_1/merge") {
          res.end(JSON.stringify({ mission: { id: "msn_remote_1", status: "done" }, merge: { ok: true } }));
        } else if (req.url === "/missions/msn_remote_1") {
          res.end(JSON.stringify({ id: "msn_remote_1", status: "merge_ready" }));
        } else if (req.url === "/missions/denied" ) {
          res.statusCode = 401;
          res.end(JSON.stringify({ error: "unauthorized" }));
        } else {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: "not found" }));
        }
      });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    port = server.address().port;
  });
  after(() => server.close());

  function worker() {
    return { name: "mock", url: `http://127.0.0.1:${port}`, token: "tok-123" };
  }

  it("start/list/get/merge round-trip with token header", async () => {
    const started = await startRemoteMission(worker(), { goal: "g", repoDir: "/repo", strategy: "swarm" });
    assert.equal(started.mission.id, "msn_remote_1");
    const list = await listRemoteMissions(worker());
    assert.equal(list.missions[0].status, "merge_ready");
    const got = await getRemoteMission(worker(), "msn_remote_1");
    assert.equal(got.status, "merge_ready");
    const merged = await mergeRemoteMission(worker(), "msn_remote_1");
    assert.equal(merged.merge.ok, true);
    assert.ok(seen.every((s) => s.token === "tok-123"), "operator token attached to every proxied call");
    const startReq = seen.find((s) => s.method === "POST" && s.url === "/missions");
    assert.equal(startReq.body.strategy, "swarm");
  });

  it("worker errors surface with the worker name", async () => {
    await assert.rejects(
      () => getRemoteMission(worker(), "denied"),
      /mock: unauthorized/
    );
  });

  it("pingWorker reports version + computer health", async () => {
    const p = await pingWorker(worker());
    assert.deepEqual(p, { ok: true, name: "mock", version: "9.9.9", computerHealthy: true });
  });

  it("pingWorker fails cleanly on a dead endpoint", async () => {
    const p = await pingWorker({ name: "dead", url: "http://127.0.0.1:1" });
    assert.equal(p.ok, false);
    assert.equal(p.name, "dead");
  });
});

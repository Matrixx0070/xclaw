/**
 * W3 — learning write-path: post-mission reflection → durable "lesson" events.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { reflectOnMission, parseLessons } from "../src/memory/reflection.mjs";
import { listMemory } from "../src/memory/durable.mjs";

const obj = (ws) => ({
  id: "obj_test1",
  objective: "Migrate the billing cron to the new scheduler",
  verdict: "verified",
  workingDir: ws,
  totals: { segments: 3, toolCalls: 41 },
  criteria: [{ text: "cron removed", done: true }, { text: "new job green", done: true }],
});

const providerWith = (content) => ({ chat: async () => ({ message: { content } }) });

describe("W3 reflection write-path", () => {
  it("parseLessons: fenced JSON, kind default, 3-cap, 200-char cap, garbage → []", () => {
    const three = parseLessons('```json\n{"lessons":[{"kind":"failed","lesson":" a "},{"kind":"bogus","lesson":"b"},{"lesson":"c"},{"lesson":"d"}]}\n```');
    assert.deepEqual(three.map((l) => l.lesson), ["a", "b", "c"]);
    assert.equal(three[0].kind, "failed");
    assert.equal(three[1].kind, "worked");
    assert.equal(parseLessons("not json at all").length, 0);
    assert.equal(parseLessons("").length, 0);
    assert.equal(parseLessons('{"lessons":"nope"}').length, 0);
    const long = parseLessons(`{"lessons":[{"lesson":"${"x".repeat(400)}"}]}`)[0];
    assert.equal(long.lesson.length, 200);
  });

  it("writes lesson events with provenance to the workspace memory", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-refl-"));
    const cfg = { paths: { configDir: path.join(ws, ".xclaw") } };
    const r = await reflectOnMission(cfg, obj(ws), {
      provider: providerWith('{"lessons":[{"kind":"worked","lesson":"Arm the runtime baseline before editing crons."},{"kind":"avoid","lesson":"Do not edit the live crontab without a dry-run."}]}'),
    });
    assert.deepEqual(r, { written: 2 });
    const mem = await listMemory(cfg, ws, { limit: 10 });
    const lessons = (mem?.events || mem || []).filter((e) => e.type === "lesson");
    assert.equal(lessons.length, 2);
    assert.equal(lessons[0].objectiveId, "obj_test1");
    assert.equal(lessons[0].verdict, "verified");
    assert.ok(["worked", "avoid"].includes(lessons[0].kind));
    await fs.rm(ws, { recursive: true, force: true });
  });

  it("gates: memory.reflection:false and memory.enabled:false → null, no provider call", async () => {
    let called = 0;
    const p = { chat: async () => { called++; return {}; } };
    assert.equal(await reflectOnMission({ memory: { reflection: false } }, obj("/tmp"), { provider: p }), null);
    assert.equal(await reflectOnMission({ memory: { enabled: false } }, obj("/tmp"), { provider: p }), null);
    assert.equal(called, 0);
  });

  it("provider failure never throws but IS reported; empty lessons writes 0", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-refl2-"));
    const cfg = { paths: { configDir: path.join(ws, ".xclaw") } };
    // A failure must not look like a healthy quiet run: it carries an error.
    const bad = await reflectOnMission(cfg, obj(ws), {
      provider: { chat: async () => { throw new Error("boom"); } },
    });
    assert.deepEqual(bad, { written: 0, error: "boom" });
    // ...and a genuinely empty reflection must NOT carry one.
    const r = await reflectOnMission(cfg, obj(ws), { provider: providerWith('{"lessons":[]}') });
    assert.deepEqual(r, { written: 0 });
    await fs.rm(ws, { recursive: true, force: true });
  });

  // Regression: v3.179.0 shipped `createProvider(cfg)` here — config passed
  // where the options bag belongs — so reflection built an unauthenticated
  // OpenAI client and 401'd on every real mission. Every other test in this
  // file injects deps.provider, so none of them execute the production wiring.
  // This one deliberately omits the seam.
  it("with no injected provider, builds the ROUTED provider and calls its baseUrl", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-refl3-"));
    const seen = [];
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push({ url: req.url, auth: req.headers.authorization, body });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content:
                    '{"lessons":[{"kind":"worked","lesson":"Resolve the route before building the provider."}]}',
                },
              },
            ],
          })
        );
      });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;

    // The route must come from cfg alone — env and the real HOME would
    // otherwise decide the outcome (and could send this to a live endpoint).
    const envKeys = [
      "XCLAW_MODEL", "XCLAW_PROVIDER", "XCLAW_API_BASE", "OPENAI_API_KEY",
      "XCLAW_API_KEY", "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN",
      "ANTHROPIC_AUTH_TOKEN", "HOME",
    ];
    const saved = {};
    for (const k of envKeys) { saved[k] = process.env[k]; delete process.env[k]; }
    process.env.HOME = ws;

    try {
      const cfg = {
        paths: { configDir: path.join(ws, ".xclaw") },
        agent: {
          provider: "openai",
          model: "gpt-4o-mini",
          baseUrl: `http://127.0.0.1:${port}/v1`,
          apiKey: "refl-test-key",
        },
      };
      const r = await reflectOnMission(cfg, obj(ws)); // no deps.provider
      assert.ok(r, "reflection returned null despite memory being enabled");
      assert.equal(r.error, undefined, `reflection errored: ${r.error}`);
      assert.deepEqual(r, { written: 1 });
      assert.equal(
        seen.length,
        1,
        "routed provider never reached the configured baseUrl — reflection built the wrong client"
      );
      assert.equal(seen[0].auth, "Bearer refl-test-key");
      const mem = await listMemory(cfg, ws, { limit: 10 });
      const lessons = (mem?.events || mem || []).filter((e) => e.type === "lesson");
      assert.equal(lessons.length, 1);
      assert.equal(lessons[0].objectiveId, "obj_test1");
    } finally {
      for (const k of envKeys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
      server.close();
      await fs.rm(ws, { recursive: true, force: true });
    }
  });

  it("objective.mjs wires reflection at the outcome boundary", async () => {
    const src = await fs.readFile(new URL("../src/agent/objective.mjs", import.meta.url), "utf8");
    assert.match(src, /reflectOnMission\(cfg, obj\)/);
  });
});

/**
 * W3 — learning write-path: post-mission reflection → durable "lesson" events.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

  it("provider failure or empty lessons never throws; empty writes 0", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-refl2-"));
    const cfg = { paths: { configDir: path.join(ws, ".xclaw") } };
    assert.equal(await reflectOnMission(cfg, obj(ws), { provider: { chat: async () => { throw new Error("boom"); } } }), null);
    const r = await reflectOnMission(cfg, obj(ws), { provider: providerWith('{"lessons":[]}') });
    assert.deepEqual(r, { written: 0 });
    await fs.rm(ws, { recursive: true, force: true });
  });

  it("objective.mjs wires reflection at the outcome boundary", async () => {
    const src = await fs.readFile(new URL("../src/agent/objective.mjs", import.meta.url), "utf8");
    assert.match(src, /reflectOnMission\(cfg, obj\)/);
  });
});

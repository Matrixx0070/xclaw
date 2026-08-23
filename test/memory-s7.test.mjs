import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// S7 (Master Evolution Directive): memory must be addressable, forgettable,
// and actually READ back into behavior.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-mem7-"));
const savedHome = process.env.HOME;
const savedState = process.env.XCLAW_STATE_DIR;

let appendMemory, listMemory, forgetMemory, writePreferences, runAgentLoop;

before(async () => {
  process.env.HOME = tmpHome;
  process.env.XCLAW_STATE_DIR = tmpHome;
  ({ appendMemory, listMemory, forgetMemory } = await import(
    "../src/memory/durable.mjs"
  ));
  ({ writePreferences } = await import("../src/memory/preferences.mjs"));
  ({ runAgentLoop } = await import("../src/agent/loop.mjs"));
});

after(() => {
  process.env.HOME = savedHome;
  if (savedState === undefined) delete process.env.XCLAW_STATE_DIR;
  else process.env.XCLAW_STATE_DIR = savedState;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("memory addressability + forget (S7)", () => {
  it("every appended event carries a durable id; sourceIds pass through", async () => {
    const cfg = { paths: { configDir: path.join(tmpHome, "c1") } };
    const ws = path.join(tmpHome, "ws1");
    const a = await appendMemory(cfg, ws, { type: "note", summary: "first" });
    const b = await appendMemory(cfg, ws, {
      type: "note",
      summary: "derived",
      sourceIds: [a.id],
    });
    assert.ok(a.id && a.id.startsWith("mem_"));
    assert.deepEqual(b.sourceIds, [a.id]);
    const items = await listMemory(cfg, ws);
    assert.ok(items.every((i) => i.id));
  });

  it("forgetMemory removes by id / jobId / type and rebuilds the md", async () => {
    const cfg = { paths: { configDir: path.join(tmpHome, "c2") } };
    const ws = path.join(tmpHome, "ws2");
    const a = await appendMemory(cfg, ws, { type: "note", summary: "keep me" });
    await appendMemory(cfg, ws, { type: "job_fail", summary: "wrong record", jobId: "j9" });
    await appendMemory(cfg, ws, { type: "job_fail", summary: "also wrong", jobId: "j9" });
    const r1 = await forgetMemory(cfg, ws, { jobId: "j9" });
    assert.equal(r1.removed, 2);
    const left = await listMemory(cfg, ws);
    assert.equal(left.length, 1);
    assert.equal(left[0].id, a.id);
    const r2 = await forgetMemory(cfg, ws, {});
    assert.equal(r2.reason, "no_matcher", "refuses to wipe without a matcher");
  });

  it("owner preferences are injected into the loop context (read path)", async () => {
    const cfg = {
      paths: { configDir: path.join(tmpHome, "c3") },
      agent: { maxTurns: 2, persistTranscript: false },
      tokens: { enabled: false, ledger: false },
      skills: { enabled: false },
      memory: { enabled: true },
      computer: { autoStart: false },
      security: { autoApprove: true },
      hooks: { log: false },
    };
    await writePreferences(cfg, ["always answer in haiku form"], { source: "test" });
    let sawPrefs = false;
    const provider = {
      providerName: "fake",
      model: "fake-1",
      modelRef: "fake-1",
      baseUrl: "http://127.0.0.1:1",
      async chat({ messages }) {
        const sys = messages
          .filter((m) => m.role === "system")
          .map((m) => String(m.content))
          .join("\n");
        if (sys.includes("always answer in haiku form")) sawPrefs = true;
        return { message: { role: "assistant", content: "ok" }, finishReason: "stop" };
      },
    };
    const ws = fs.mkdtempSync(path.join(tmpHome, "ws3-"));
    await runAgentLoop({ cfg, provider, message: "hello", workingDir: ws });
    assert.equal(sawPrefs, true, "preferences reached the model context");
  });
});

describe("compaction provenance (E-B)", () => {
  it("rotation writes a compact event; recall expands it back to archived sources", async () => {
    const cfg = {
      paths: { configDir: path.join(tmpHome, "c-eb") },
      memory: { maxEventBytes: 3000, keepEventBytes: 1000 },
    };
    const ws = path.join(tmpHome, "ws-eb");
    for (let i = 0; i < 40; i++) {
      await appendMemory(cfg, ws, {
        type: "note",
        summary: `zebra event number ${i} — ${"x".repeat(100)}`,
      });
    }
    const items = await listMemory(cfg, ws, { limit: 100 });
    const compact = items.find((i) => i.type === "compact");
    assert.ok(compact, "compact summary event written on rotation");
    assert.ok(Array.isArray(compact.sourceIds) && compact.sourceIds.length > 0, "sourceIds recorded");
    const { recallMemory } = await import("../src/memory/recall.mjs");
    const r = await recallMemory(cfg, ws, { query: "archived events", provenance: { expand: true } });
    const hit = (r.hits || []).find((h) => h.type === "compact");
    assert.ok(hit, "compact event recallable");
    assert.ok(hit.provenance, "provenance expansion ran");
    assert.ok(
      (hit.provenance.sources || []).length > 0,
      `archived sources resolved (missing: ${JSON.stringify(hit.provenance?.missing || []).slice(0, 100)})`
    );
  });
});

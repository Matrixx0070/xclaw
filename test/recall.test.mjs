import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appendMemory, memoryPaths } from "../src/memory/durable.mjs";
import { recallMemory, createRecallTool } from "../src/memory/recall.mjs";

describe("recall", () => {
  it("finds matching durable events by keyword", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-mem-"));
    const cfg = { paths: { configDir: dir } };
    const ws = path.join(dir, "ws");
    await fs.mkdir(ws, { recursive: true });
    await appendMemory(cfg, ws, {
      type: "job_ok",
      goal: "Fix OAuth attestation for Claude",
      summary: "Succeeded: OAuth attestation",
    });
    await appendMemory(cfg, ws, {
      type: "note",
      summary: "Unrelated weather note",
    });
    const r = await recallMemory(cfg, ws, { query: "OAuth attestation", limit: 5 });
    assert.ok(r.hitCount >= 1);
    assert.match(String(r.hits[0].summary || r.hits[0].goal), /OAuth|attestation/i);
  });

  it("createRecallTool execute returns ok shape", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-mem2-"));
    const cfg = { paths: { configDir: dir } };
    const ws = path.join(dir, "ws");
    await fs.mkdir(ws, { recursive: true });
    await appendMemory(cfg, ws, { type: "note", summary: "swarm receipt merge policy" });
    const tool = createRecallTool({ cfg, workingDir: ws });
    const out = await tool.execute({ query: "merge policy", limit: 3 });
    assert.equal(out.ok, true);
    assert.ok(Array.isArray(out.hits));
  });
});

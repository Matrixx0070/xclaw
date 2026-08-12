import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  appendMemory,
  listMemory,
  rememberJob,
  loadDurableMemoryFile,
} from "../src/memory/durable.mjs";

describe("durable memory", () => {
  it("appends and lists", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-mem-"));
    const cfg = { paths: { configDir: dir } };
    const ws = path.join(dir, "ws");
    await fs.mkdir(ws);
    await appendMemory(cfg, ws, { type: "note", summary: "hello memory" });
    const items = await listMemory(cfg, ws);
    assert.ok(items.length >= 1);
    assert.equal(items[0].summary, "hello memory");
    const file = await loadDurableMemoryFile(cfg, ws);
    assert.ok(file?.content.includes("hello memory"));
  });

  it("rememberJob writes job_ok", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-memj-"));
    const cfg = { paths: { configDir: dir } };
    const ws = path.join(dir, "ws");
    await fs.mkdir(ws);
    await rememberJob(cfg, {
      id: "j1",
      workspace: ws,
      pass: true,
      status: "succeeded",
      goal: "write x",
      turns: 1,
    });
    const items = await listMemory(cfg, ws);
    assert.ok(items.some((i) => i.type === "job_ok"));
  });
});

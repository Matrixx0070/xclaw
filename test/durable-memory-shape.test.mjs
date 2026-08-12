import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "path";
import os from "os";
import {
  appendMemory,
  loadDurableMemoryFile,
  memoryPaths,
} from "../src/memory/durable.mjs";
import { buildContextSections } from "../src/skills/loader.mjs";

describe("durable memory shape", () => {
  it("loadDurableMemoryFile returns body+name for buildContextSections", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-dur-"));
    const cfg = { paths: { configDir: dir } };
    const ws = path.join(dir, "project");
    await fs.mkdir(ws, { recursive: true });
    await appendMemory(cfg, ws, {
      type: "job_ok",
      goal: "demo task",
      summary: "Succeeded: demo task",
    });
    const m = await loadDurableMemoryFile(cfg, ws);
    assert.ok(m);
    assert.equal(m.name, "MEMORY.md");
    assert.ok(m.body && m.body.includes("demo"));
    assert.ok(m.path.endsWith("MEMORY.md"));

    const section = buildContextSections({
      memoryFiles: [m],
      maxMemoryChars: 4000,
    });
    assert.match(section, /Project memory/);
    assert.match(section, /MEMORY\.md/);
    assert.match(section, /demo/);
  });

  it("buildContextSections accepts content alias without body", () => {
    const section = buildContextSections({
      memoryFiles: [
        { path: "/tmp/x.md", name: "x.md", content: "Prefer short answers." },
      ],
    });
    assert.match(section, /Prefer short answers/);
  });
});

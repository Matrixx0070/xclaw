import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appendMemory, loadDurableMemoryFile, memoryPaths } from "../src/memory/durable.mjs";
import { REDACTED } from "../src/security/redact-secrets.mjs";

describe("MEMORY.md redaction", () => {
  it("rebuilds and loads without leaking keys", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-mmd-"));
    const ws = path.join(dir, "ws");
    await fs.mkdir(ws);
    const cfg = { paths: { configDir: dir } };
    await appendMemory(cfg, ws, {
      type: "note",
      summary: "token xai-abcdefghijklmnopqrstuvwxyz0123456789",
    });
    const md = await fs.readFile(memoryPaths(cfg, ws).md, "utf8");
    assert.ok(!md.includes("abcdefghijklmnop"));
    const loaded = await loadDurableMemoryFile(cfg, ws);
    assert.ok(loaded.body.includes(REDACTED) || !loaded.body.includes("xai-abc"));
    await fs.rm(dir, { recursive: true, force: true });
  });
});

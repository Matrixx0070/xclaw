import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appendMemory } from "../src/memory/durable.mjs";
import { appendSoakRun, soakPaths } from "../src/eval/soak.mjs";
import { REDACTED } from "../src/security/redact-secrets.mjs";

describe("durable + soak redaction", () => {
  it("redacts keys in memory jsonl", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-mem-"));
    const ws = path.join(dir, "ws");
    await fs.mkdir(ws);
    await appendMemory({ paths: { configDir: dir } }, ws, {
      type: "note",
      summary: "key xai-abcdefghijklmnopqrstuvwxyz0123456789",
      apiKey: "super-secret-value-12345",
    });
    const files = await fs.readdir(path.join(dir, "memory"));
    const jsonl = await fs.readFile(
      path.join(dir, "memory", files[0], "events.jsonl"),
      "utf8"
    );
    assert.ok(!jsonl.includes("abcdefghijklmnop"));
    assert.ok(jsonl.includes(REDACTED));
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("redacts keys in soak runs", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-soak-"));
    await appendSoakRun(
      { paths: { configDir: dir } },
      { id: "s1", token: "sk-abcdefghijklmnopqrstuvwxyz012345", ok: true }
    );
    const raw = await fs.readFile(soakPaths({ paths: { configDir: dir } }).runs, "utf8");
    assert.ok(!raw.includes("sk-abcdefghijklmnop"));
    await fs.rm(dir, { recursive: true, force: true });
  });
});

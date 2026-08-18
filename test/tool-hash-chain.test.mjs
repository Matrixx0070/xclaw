/**
 * Tool-result hash chain — stamp, verify, detect tamper.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GENESIS_HASH,
  HASH_CHAIN_VERSION,
  stableStringify,
  buildToolHashChain,
  verifyToolHashChain,
  createToolHashChain,
  hashToolEntry,
} from "../src/agent/tool-hash-chain.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("stableStringify", () => {
  it("sorts keys", () => {
    assert.equal(stableStringify({ b: 1, a: 2 }), '{"a":2,"b":1}');
  });
});

describe("tool hash chain", () => {
  it("builds tip from genesis", () => {
    const entries = [
      { id: "tt_1", name: "xclaw_bash", status: "ok", result: "hi", startedAt: "t0", endedAt: "t1" },
      { id: "tt_2", name: "xclaw_file_read", status: "ok", result: "data", startedAt: "t2", endedAt: "t3" },
    ];
    const chain = buildToolHashChain(entries);
    assert.equal(chain.version, HASH_CHAIN_VERSION);
    assert.equal(chain.entries[0].prevHash, GENESIS_HASH);
    assert.equal(chain.entries[1].prevHash, chain.entries[0].hash);
    assert.equal(chain.tip, chain.entries[1].hash);
    const v = verifyToolHashChain(chain.entries);
    assert.equal(v.ok, true, JSON.stringify(v.errors));
  });

  it("detects tamper", () => {
    const chain = buildToolHashChain([
      { id: "a", name: "t", status: "ok", result: "x" },
    ]);
    chain.entries[0].hash = "deadbeef".repeat(8);
    const v = verifyToolHashChain(chain.entries);
    assert.equal(v.ok, false);
  });

  it("createToolHashChain accumulator", () => {
    const c = createToolHashChain();
    c.append({ id: "1", name: "bash", status: "ok", result: "ok" });
    c.append({ id: "2", name: "read", status: "ok", result: "y" });
    assert.equal(c.length, 2);
    assert.equal(c.verify().ok, true);
    assert.equal(c.snapshot().tip, c.tip);
  });

  it("finalizeToolTraceEntry stamps hash when patch applied", async () => {
    spawnSync("git", ["apply", "--whitespace=nowarn", path.join(root, "patches/tool-trace-hash-chain.patch")], {
      cwd: root,
      encoding: "utf8",
    });
    const { beginToolTraceEntry, finalizeToolTraceEntry } = await import(
      "../src/agent/tool-trace.mjs"
    );
    const partial = beginToolTraceEntry({ name: "xclaw_bash", args: { command: "echo 1" } });
    const entry = finalizeToolTraceEntry(partial, {
      resultText: "1\n",
      prevHash: GENESIS_HASH,
    });
    assert.ok(entry.hash);
    assert.equal(entry.prevHash, GENESIS_HASH);
    assert.equal(entry.hashVersion, HASH_CHAIN_VERSION);
    const re = hashToolEntry(GENESIS_HASH, entry);
    assert.equal(re, entry.hash);
  });
});
